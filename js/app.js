import { renderHome } from "./views/home.js";
import { renderProfiles } from "./views/profiles.js";
import { renderTags } from "./views/tags.js";
import { renderTag } from "./views/tag.js";
import { renderProfile } from "./views/profile.js";
import { renderFeed } from "./views/feed.js";
import { applyTheme } from "./theme.js";
import {
  createEmptySnippet,
  saveSnippet,
  migrateLegacyImages,
  migrateInlineImagesToIndexedDB,
  getProfiles,
  getTags,
  getSnippets,
  upsertRecords,
  getTombstones,
  clearTombstones,
  applyRemoteDeletion,
  getHomeTitle,
  getPrefsSnapshot,
  getPrefsUpdatedAt,
  applyPrefsSnapshot,
} from "./storage.js";
import { getOne, putOne } from "./db.js";
import { registerRemoteResolver } from "./imageStore.js";
import { createStorageResolver, STORAGE_PREFIX } from "./cloudImageSync.js";
import { openSnippetEditor } from "./snippetEditor.js";
import { checkWhatsNew } from "./whatsNew.js";
import { checkOnboarding } from "./onboarding.js";
import { consumeQueuedCaptures } from "./feedSync.js";
import { consumeOAuthRedirect } from "./supabaseOAuth.js";
import { openCloudSyncSheet } from "./settingsMenu.js";
import { startAutoSync } from "./cloudBackup.js";
import { checkFeedsIfDue } from "./feedCheck.js";

applyTheme();

// Wires Cloud Backup's Storage-based image sync (js/cloudImageSync.js) into
// every existing resolveImageSrc call site, with no call-site changes --
// see imageStore.js's registerRemoteResolver. patchRecordImage is the one
// piece cloudImageSync.js can't know generically: where this app's own
// records actually live (IndexedDB via js/db.js here; a differently-shaped
// local store in the sibling apps).
registerRemoteResolver(
  STORAGE_PREFIX,
  createStorageResolver({
    patchRecordImage: async (store, recordId, idbRef) => {
      const record = await getOne(store, recordId);
      if (record) await putOne(store, { ...record, image: idbRef });
    },
  })
);

// Remembers exactly which address the app was last opened with, shown at
// the bottom of Settings. A diagnostic for working out what iOS's webapp://
// scheme passes on from a Shortcut (path, query, fragment) -- stays on this
// device only.
try {
  localStorage.setItem("mi_last_launch_v1", JSON.stringify({ href: location.href, at: Date.now() }));
} catch {
  // Storage unavailable -- the diagnostic just shows nothing.
}

const root = document.getElementById("app");

// A back arrow (Tag/Profile detail) should return wherever the user actually
// came from -- a Tag reached from a Profile's tag chips, a Profile reached
// from a Tag's profile row, Home, etc. -- not a single hardcoded destination.
// This is a small in-app "where was I" stack, separate from the browser's
// own history: every nav.toX() push records the hash being left, and
// nav.back() pops the most recent one instead of pushing (skipPush), so
// back/forward chains through any number of Tag<->Profile hops unwind
// correctly. Capped since a long session that only ever navigates forward
// would otherwise grow it unbounded.
const navStack = [];
const NAV_STACK_LIMIT = 50;
let currentHash = null;
let skipPush = false;

const nav = {
  toHome: () => {
    location.hash = "#/home";
  },
  toProfiles: () => {
    location.hash = "#/profiles";
  },
  toTags: () => {
    location.hash = "#/tags";
  },
  toTag: (id) => {
    location.hash = `#/tag/${encodeURIComponent(id)}`;
  },
  toProfile: (id) => {
    location.hash = `#/profile/${encodeURIComponent(id)}`;
  },
  toFeed: (profileId, channelId) => {
    location.hash = `#/feed/${encodeURIComponent(profileId)}/${encodeURIComponent(channelId)}`;
  },
  // Moves sideways rather than deeper -- e.g. the reader's "Next post" --
  // so the back arrow still returns to where you came from (the post
  // list), not to every post read along the way.
  replace: (hash) => {
    skipPush = true;
    location.replace(hash);
  },
  // fallbackHash is used when there's nowhere in-app to go back to -- e.g. a
  // Profile/Tag opened directly from a fresh load or a shared link.
  back: (fallbackHash) => {
    const prev = navStack.pop();
    skipPush = true;
    location.hash = prev || fallbackHash;
  },
};

function route() {
  const hash = location.hash || "#/home";
  if (hash !== currentHash) {
    if (currentHash !== null && !skipPush) {
      navStack.push(currentHash);
      if (navStack.length > NAV_STACK_LIMIT) navStack.shift();
    }
    skipPush = false;
    currentHash = hash;
  }

  const match = hash.match(/^#\/([a-z]+)(?:\/(.+))?$/);
  const view = match ? match[1] : "home";
  const param = match && match[2] ? decodeURIComponent(match[2]) : null;

  switch (view) {
    case "profiles":
      renderProfiles(root, nav);
      break;
    case "tags":
      renderTags(root, nav);
      break;
    case "tag":
      if (!param) {
        nav.toTags();
        return;
      }
      renderTag(root, nav, param);
      break;
    case "profile":
      if (!param) {
        nav.toHome();
        return;
      }
      renderProfile(root, nav, param);
      break;
    case "feed":
      if (!param) {
        nav.toHome();
        return;
      }
      renderFeed(root, nav, param);
      break;
    default:
      renderHome(root, nav);
  }
}

// Handles something shared into the app from outside: the Android
// share_target manifest entry, or an iOS Shortcut that opens the installed
// app (there's no Web Share Target support in Safari). iOS's unofficial
// webapp:// scheme opens the installed app -- with its own storage, unlike
// a plain https:// link, which opens Safari's -- but it's not yet clear
// which parts of the address it passes on, so a share is accepted in either
// place:
//   ?url=…  /  ?text=…                (query string)
//   #/capture/<url-encoded url or text> (fragment)
// A link opens the save flow with a fetch already started; plain text (a
// topic to look into, a tip someone gave you) opens it as a Note. Either
// way it's saved untagged, so it lands in the Inbox to sort later.
function readIncomingShare() {
  const params = new URLSearchParams(location.search);
  const fromQuery = params.get("url") || params.get("text") || "";
  if (fromQuery) return { raw: fromQuery, source: "query" };
  const hashMatch = location.hash.match(/^#\/capture\/(.+)$/);
  if (hashMatch) {
    let raw = hashMatch[1];
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // Not encoded (or encoded oddly) -- use it as it came.
    }
    return { raw, source: "hash" };
  }
  return null;
}

function handleIncomingShare() {
  const incoming = readIncomingShare();
  if (!incoming) return;
  const raw = incoming.raw.trim();
  history.replaceState(null, "", location.pathname + (incoming.source === "hash" ? "#/home" : location.hash));
  if (!raw) return;

  const snippet = createEmptySnippet();
  const match = raw.match(/https?:\/\/\S+/);
  if (match) {
    snippet.type = "link";
    snippet.url = match[0];
    // Anything shared alongside the link (a page title, a few words of
    // context) is kept as the comment rather than thrown away.
    const rest = raw.replace(match[0], "").trim();
    if (rest) snippet.comment = rest;
    openSnippetEditor(nav, { snippet, isNew: true, refresh: route, autoFetch: true });
  } else {
    snippet.type = "note";
    snippet.content = raw;
    openSnippetEditor(nav, { snippet, isNew: true, refresh: route });
  }
}

// Picks up anything shared via the iOS Shortcut capture flow while the app
// wasn't open (see supabase/SETUP.md) -- lands each as a plain untagged
// Snippet in the Inbox, same as the manual share-sheet flow above, just
// without a fetch/editor step since there's no active save session to show
// it in. Best-effort and inert unless the optional backend is configured.
async function importQueuedCaptures() {
  const urls = await consumeQueuedCaptures();
  if (urls.length === 0) return;
  for (const url of urls) {
    const snippet = createEmptySnippet();
    snippet.type = "link";
    snippet.url = url;
    await saveSnippet(snippet);
  }
  route();
}

window.addEventListener("hashchange", route);

// Picks up the redirect back from Supabase's consent screen (see
// supabaseOAuth.js / api/oauth-callback.js) before anything else touches
// location.hash -- clears the token fragment out of the URL either way, and
// reopens the Cloud Sync sheet with the result if this load was one of
// those redirects.
const oauthResult = consumeOAuthRedirect();

// Runs before the first render so anyone with a Profile/Tag/Snippet image
// saved in an older format sees it fixed immediately, not just after
// visiting that page a second time -- migrateLegacyImages fixes up ancient
// Blob-on-record data first (a no-op for everyone else by now), then
// migrateInlineImagesToIndexedDB moves any still-inlined data: URI image
// into the separate image store (js/imageStore.js). Both are a no-op after
// their first run.
migrateLegacyImages()
  .then(migrateInlineImagesToIndexedDB)
  .finally(() => {
    route();
    handleIncomingShare();
    if (oauthResult) openCloudSyncSheet(oauthResult);
  });
importQueuedCaptures();
checkOnboarding();

// New-post counts: checked when the app is opened and when it comes back
// into view, at most every half hour (see js/feedCheck.js). Nothing runs
// while the app isn't being looked at.
checkFeedsIfDue();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") checkFeedsIfDue();
});
checkWhatsNew();

// Inert unless Cloud Backup has actually been installed and configured
// (see js/cloudBackup.js) -- a no-op otherwise. Runs a sync immediately,
// then periodically/on-visibility-change while the app stays open. Theme
// and title are re-applied live after every round via onSynced below; a
// background pull of profiles/tags/snippets still doesn't re-render
// whatever view happens to be open right now, so content shows up on the
// next navigation or reload rather than instantly -- a known limitation,
// not a bug.
startAutoSync(
  { getProfiles, getTags, getSnippets, upsertRecords, getTombstones, clearTombstones, applyRemoteDeletion, getPrefsSnapshot, getPrefsUpdatedAt, applyPrefsSnapshot },
  () => {
    applyTheme();
    const homeTitleEl = document.getElementById("home-title");
    if (homeTitleEl) homeTitleEl.textContent = getHomeTitle();
  }
);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
