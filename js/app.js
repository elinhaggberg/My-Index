import { renderHome } from "./views/home.js";
import { renderProfiles } from "./views/profiles.js";
import { renderTags } from "./views/tags.js";
import { renderTag } from "./views/tag.js";
import { renderProfile } from "./views/profile.js";
import { applyTheme } from "./theme.js";
import {
  createEmptySnippet,
  saveSnippet,
  migrateLegacyImages,
  getProfiles,
  getTags,
  getSnippets,
  upsertRecords,
  getTombstones,
  clearTombstones,
  applyRemoteDeletion,
} from "./storage.js";
import { openSnippetEditor } from "./snippetEditor.js";
import { checkWhatsNew } from "./whatsNew.js";
import { checkOnboarding } from "./onboarding.js";
import { consumeQueuedCaptures } from "./feedSync.js";
import { consumeOAuthRedirect } from "./supabaseOAuth.js";
import { openCloudSyncSheet } from "./settingsMenu.js";
import { startAutoSync } from "./cloudBackup.js";

applyTheme();

const root = document.getElementById("app");

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
};

function route() {
  const hash = location.hash || "#/home";
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
    default:
      renderHome(root, nav);
  }
}

// Handles a link shared into the app from the OS Share Sheet — the Android
// share_target manifest entry and the iOS Shortcut workaround (there's no
// Web Share Target support in Safari) both land here the same way: a URL in
// the ?url= or ?text= query param on a plain page load, no hash. Opens
// straight into the save flow with a fetch already kicked off, landing as an
// untagged ("Uncategorized") snippet to sort later, per the capture flow.
function handleIncomingShare() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("url") || params.get("text") || "";
  const match = raw.match(/https?:\/\/\S+/);
  if (!match) return;

  history.replaceState(null, "", location.pathname + location.hash);

  const snippet = createEmptySnippet();
  snippet.type = "link";
  snippet.url = match[0];
  openSnippetEditor(nav, { snippet, isNew: true, refresh: route, autoFetch: true });
}

// Picks up anything shared via the iOS Shortcut capture flow while the app
// wasn't open (see supabase/SETUP.md) -- lands each as a plain untagged
// ("Uncategorized") Snippet, same as the manual share-sheet flow above, just
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

// Runs before the first render so anyone with a Profile/Tag image saved in
// the old (Blob-based) format sees it fixed immediately, not just after
// visiting that page a second time. A no-op after the first run.
migrateLegacyImages().finally(() => {
  route();
  handleIncomingShare();
  if (oauthResult) openCloudSyncSheet(oauthResult);
});
importQueuedCaptures();
checkOnboarding();
checkWhatsNew();

// Inert unless Cloud Backup has actually been installed and configured
// (see js/cloudBackup.js) -- a no-op otherwise. Runs a sync immediately,
// then periodically/on-visibility-change while the app stays open; a
// background pull doesn't re-render whatever view happens to be open
// right now, so anything it brings in shows up on the next navigation or
// reload rather than instantly -- a known limitation, not a bug.
startAutoSync({ getProfiles, getTags, getSnippets, upsertRecords, getTombstones, clearTombstones, applyRemoteDeletion });

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("service-worker.js").catch(() => {});
  });
}
