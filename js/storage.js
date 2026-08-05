import { getAll, getOne, putOne, putMany, deleteOne } from "./db.js";
import { IDB_PREFIX, putImage, getImage, deleteImage, dataUrlToBlob, blobToDataUrl } from "./imageStore.js";
import { getStorageUsage } from "./lazyImage.js";

const THEME_KEY = "mi_theme_v1";
const HOME_TITLE_KEY = "mi_home_title_v1";
const SHOW_PROFILE_ROW_KEY = "mi_show_profile_row_v1";
const LAST_SEEN_VERSION_KEY = "mi_last_seen_version_v1";
const LAST_BACKUP_KEY = "mi_last_backup_at_v1";
const BACKUP_BANNER_DISMISSED_KEY = "mi_backup_banner_dismissed_at_v1";
const STORAGE_WARNING_DISMISSED_KEY = "mi_storage_warning_dismissed_at_v1";
const FIRST_OPEN_KEY = "mi_first_open_at_v1";
const ONBOARDING_SEEN_KEY = "mi_onboarding_seen_v1";
const HOME_FILTER_KEY = "mi_home_filter_v1";
const PROFILES_FILTER_KEY = "mi_profiles_filter_v1";
const IMAGES_MIGRATED_KEY = "mi_images_migrated_v1";
const IMAGES_MIGRATED_TO_IDB_KEY = "mi_images_migrated_to_idb_v1";

export const UNCATEGORIZED_TAG_ID = "uncategorized";

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
}

// A fresh Camera/Library upload arrives as a Blob (see js/imageBlob.js) --
// moves it into the separate image store (js/imageStore.js) and returns
// just a reference, since a Blob can't be stored directly on a profile/tag/
// snippet record. Anything else (a remote URL, an existing idb: reference,
// or null/empty) passes through untouched. Profiles/tags/snippets each have
// at most one image, so the record's own id doubles as a stable image-store
// key -- no separate id needed.
async function storeImageIfBlob(recordId, image) {
  if (!(image instanceof Blob)) return image;
  await putImage(recordId, image);
  return IDB_PREFIX + recordId;
}

async function deleteStoredImageIfAny(image) {
  if (typeof image === "string" && image.startsWith(IDB_PREFIX)) {
    await deleteImage(image.slice(IDB_PREFIX.length)).catch(() => {});
  }
}

// Cleans up whatever was stored for the old image once a record's image
// field actually changes to something else on save -- otherwise a replaced
// or cleared photo would just leak forever in the image store.
async function cleanupOldImage(previousImage, nextImage) {
  if (previousImage !== nextImage) await deleteStoredImageIfAny(previousImage);
}

// A deleted record leaves no trace in its own store to ever tell another
// device it's gone -- this is that trace. Recorded on every delete
// regardless of whether Cloud Backup is even configured (storage.js has no
// business knowing that), consumed and cleared by js/cloudBackup.js's
// pushAll once it's actually been synced. Harmless dead weight otherwise:
// a handful of small {store, recordId, deletedAt} rows for anyone who
// never turns Cloud Backup on.
async function recordTombstone(store, recordId) {
  await putOne("tombstones", { id: `${store}:${recordId}`, store, recordId, deletedAt: Date.now() });
}

export async function getTombstones() {
  return getAll("tombstones");
}

export async function clearTombstones(ids) {
  for (const id of ids) await deleteOne("tombstones", id);
}

function readJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function writeJSON(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// ---- Tags ----
// "Uncategorized" is never actually stored — it's derived (any snippet with
// no real tags belongs to it), same idea as the Wishlist board in My Closet
// being an always-present entry, except here it's synthesized rather than a
// real row, since "no tags" is already exactly the condition that defines it.

export const UNCATEGORIZED_TAG = { id: UNCATEGORIZED_TAG_ID, name: "Uncategorized", isSystem: true, pinnedNote: "", image: null };

export async function getTags() {
  const tags = await getAll("tags");
  return tags.sort((a, b) => a.name.localeCompare(b.name));
}

export async function getTag(id) {
  if (id === UNCATEGORIZED_TAG_ID) return UNCATEGORIZED_TAG;
  return getOne("tags", id);
}

function normalizeTagName(name) {
  return (name || "").trim();
}

// Tags are a shared taxonomy (like My Closet's boards) rather than rich
// individual records, so creating one dedupes by name instead of allowing
// two tags that only differ in case, and the reserved "Uncategorized" name
// always resolves to the synthetic tag rather than a real duplicate row.
export async function findOrCreateTag(name) {
  const trimmed = normalizeTagName(name);
  if (!trimmed) return null;
  if (trimmed.toLowerCase() === UNCATEGORIZED_TAG_ID) return UNCATEGORIZED_TAG;

  const existing = (await getTags()).find((t) => t.name.toLowerCase() === trimmed.toLowerCase());
  if (existing) return existing;

  const tag = { id: uid(), name: trimmed, pinnedNote: "", image: null, createdAt: Date.now() };
  await putOne("tags", tag);
  return tag;
}

// Single write for everything editable about an existing tag -- name,
// pinned note, and cover image -- from the Tag page's edit sheet.
export async function saveTagDetails(id, { name, pinnedNote, image }) {
  const tag = await getOne("tags", id);
  if (!tag) return null;
  const trimmed = normalizeTagName(name);
  const resolvedImage = await storeImageIfBlob(id, image);
  await cleanupOldImage(tag.image, resolvedImage);
  const updated = { ...tag, name: trimmed || tag.name, pinnedNote, image: resolvedImage };
  await putOne("tags", updated);
  return updated;
}

// Deleting a tag just un-tags whatever referenced it (profiles fall back to
// their remaining tags; untagged snippets fall back into Uncategorized) —
// nothing referencing it is ever deleted outright.
//
// { tombstone: false } is for js/cloudBackup.js's applyRemoteDeletion only,
// replaying a deletion that already happened on another device -- recording
// a *new* tombstone for that would just re-push it right back with a
// fresher timestamp, and the row would never age out server-side (see
// backup-sync's GC comment).
export async function deleteTag(id, { tombstone = true } = {}) {
  const tag = await getOne("tags", id);
  await deleteOne("tags", id);
  if (tombstone) await recordTombstone("tags", id);
  await deleteStoredImageIfAny(tag?.image);
  const profiles = await getAll("profiles");
  for (const profile of profiles) {
    if (profile.tagIds?.includes(id)) {
      await putOne("profiles", { ...profile, tagIds: profile.tagIds.filter((t) => t !== id) });
    }
  }
  const snippets = await getAll("snippets");
  for (const snippet of snippets) {
    if (snippet.tagIds?.includes(id)) {
      await putOne("snippets", { ...snippet, tagIds: snippet.tagIds.filter((t) => t !== id) });
    }
  }
}

// ---- Profiles ----

export async function getProfiles() {
  return getAll("profiles");
}

export async function getProfile(id) {
  return getOne("profiles", id);
}

export function createEmptyProfile() {
  return {
    id: uid(),
    name: "",
    note: "",
    image: null,
    tagIds: [],
    channels: [],
    newCount: 0,
    createdAt: Date.now(),
  };
}

export function createEmptyChannel() {
  return { id: uid(), type: "blog", url: "", rssUrl: "", newCount: 0 };
}

export async function saveProfile(profile) {
  const previous = await getOne("profiles", profile.id);
  const image = await storeImageIfBlob(profile.id, profile.image);
  await cleanupOldImage(previous?.image, image);
  const withTimestamp = { ...profile, image, updatedAt: Date.now() };
  await putOne("profiles", withTimestamp);
  return withTimestamp;
}

export async function deleteProfile(id, { tombstone = true } = {}) {
  const profile = await getOne("profiles", id);
  await deleteOne("profiles", id);
  if (tombstone) await recordTombstone("profiles", id);
  await deleteStoredImageIfAny(profile?.image);
  const snippets = await getAll("snippets");
  for (const snippet of snippets) {
    if (snippet.profileIds?.includes(id)) {
      await putOne("snippets", { ...snippet, profileIds: snippet.profileIds.filter((p) => p !== id) });
    }
  }
}

// Clears the profile's own badge and every one of its channels' badges at
// once -- mirrors "unread mail" behavior: opening the profile page is what
// clears it, not any per-channel action. What's persisted is fully zeroed
// (so the badge is gone by the next visit), but the returned object keeps
// the pre-clear per-channel counts -- like an email staying visibly "was
// unread" for the one screen where you actually open it, rather than
// disappearing before you ever see which channel it came from.
export async function clearProfileNewCount(id) {
  const profile = await getOne("profiles", id);
  if (!profile || !profile.newCount) return profile;
  const cleared = {
    ...profile,
    newCount: 0,
    channels: (profile.channels || []).map((c) => ({ ...c, newCount: 0 })),
  };
  await putOne("profiles", cleared);
  return { ...cleared, channels: profile.channels || [] };
}

export async function getProfilesForTag(tagId) {
  const profiles = await getProfiles();
  return profiles.filter((p) => p.tagIds?.includes(tagId));
}

// ---- Snippets ----

export async function getSnippets() {
  return getAll("snippets");
}

export async function getSnippet(id) {
  return getOne("snippets", id);
}

export function createEmptySnippet() {
  return {
    id: uid(),
    type: "link",
    content: "",
    url: "",
    comment: "",
    image: "",
    siteName: "",
    tagIds: [],
    profileIds: [],
    createdAt: Date.now(),
  };
}

export async function saveSnippet(snippet) {
  const previous = await getOne("snippets", snippet.id);
  const image = await storeImageIfBlob(snippet.id, snippet.image);
  await cleanupOldImage(previous?.image, image);
  const withTimestamp = { ...snippet, image, updatedAt: Date.now() };
  await putOne("snippets", withTimestamp);
  return withTimestamp;
}

export async function deleteSnippet(id, { tombstone = true } = {}) {
  const snippet = await getOne("snippets", id);
  await deleteOne("snippets", id);
  if (tombstone) await recordTombstone("snippets", id);
  await deleteStoredImageIfAny(snippet?.image);
}

// The only caller of the { tombstone: false } option above -- js/cloudBackup.js's
// pullChanges routes a pulled deletion through here rather than calling
// deleteProfile/deleteTag/deleteSnippet directly, so the sync-only intent
// is explicit at the call site instead of a bare `{ tombstone: false }`
// showing up in the middle of feature code.
export async function applyRemoteDeletion(store, recordId) {
  if (store === "profiles") return deleteProfile(recordId, { tombstone: false });
  if (store === "tags") return deleteTag(recordId, { tombstone: false });
  if (store === "snippets") return deleteSnippet(recordId, { tombstone: false });
}

export async function getSnippetsForProfile(profileId) {
  const snippets = await getSnippets();
  return snippets.filter((s) => s.profileIds?.includes(profileId)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getSnippetsForTag(tagId) {
  const snippets = await getSnippets();
  if (tagId === UNCATEGORIZED_TAG_ID) {
    return snippets.filter((s) => !s.tagIds || s.tagIds.length === 0).sort((a, b) => b.createdAt - a.createdAt);
  }
  return snippets.filter((s) => s.tagIds?.includes(tagId)).sort((a, b) => b.createdAt - a.createdAt);
}

export async function getUncategorizedCount() {
  const snippets = await getSnippets();
  return snippets.filter((s) => !s.tagIds || s.tagIds.length === 0).length;
}

// Generic upsert-by-id, used only by Cloud Backup's pull/merge step
// (js/cloudBackup.js) -- writes each record exactly as given, matching by
// its own id, unlike importData() below whose always-new-id behavior is
// only correct for a one-time file import, never for ongoing sync where
// two devices need to agree on the same id for the same record. A pulled
// record's image (see pushAll's use of inlineRecordImage below) arrives as
// a portable data: URI or remote URL, never a device-local idb: reference
// -- revives it into this device's own image store the same way an
// imported backup file's image is, keyed by the record's own id so every
// device agrees on the same image-store key for the same record too.
export async function upsertRecords(store, records) {
  if (!["profiles", "tags", "snippets"].includes(store) || !records.length) return;
  const revived = await Promise.all(records.map(async (r) => ({ ...r, image: await reviveImage(r.image, r.id) })));
  await putMany(store, revived);
}

// ---- Export / import ----

// Exports inline each record's actual image bytes as a data: URI -- neither
// a Blob nor an idb: reference can survive a JSON.stringify, or means
// anything on another device -- so an exported file is fully self-contained
// and portable, not dependent on this device's image store. A remote URL
// (an unfurled link's image) or no image at all passes through untouched.
async function inlineImage(image) {
  if (image instanceof Blob) return blobToDataUrl(image);
  if (typeof image === "string" && image.startsWith(IDB_PREFIX)) {
    const blob = await getImage(image.slice(IDB_PREFIX.length));
    return blob ? blobToDataUrl(blob) : image;
  }
  return image;
}

async function inlineProfileImages(profiles) {
  return Promise.all(profiles.map(async (p) => ({ ...p, image: await inlineImage(p.image) })));
}

async function inlineTagImages(tags) {
  return Promise.all(tags.map(async (t) => ({ ...t, image: await inlineImage(t.image) })));
}

async function inlineSnippetImages(snippets) {
  return Promise.all(snippets.map(async (s) => ({ ...s, image: await inlineImage(s.image) })));
}

// Same idea as inlineProfileImages/inlineTagImages/inlineSnippetImages
// above, generalized to any single record -- used by js/cloudBackup.js's
// pushAll (passed in via DI, matching how every other storage.js function
// reaches cloudBackup.js) so a synced record's image is portable to
// whatever device pulls it, instead of a meaningless local idb: reference.
// This is a stopgap: it means Cloud Backup still resends full image bytes
// on every sync rather than uploading each image once to real object
// storage, which is planned as a separate, later piece of work -- but it's
// correct and doesn't regress, which matters more right now.
export async function inlineRecordImage(record) {
  return { ...record, image: await inlineImage(record.image) };
}

export async function exportBackupData() {
  return {
    type: "backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: await inlineProfileImages(await getProfiles()),
    tags: await inlineTagImages(await getTags()),
    snippets: await inlineSnippetImages(await getSnippets()),
    theme: getThemePref(),
    homeTitle: getHomeTitle(),
    showProfileRow: getShowProfileRow(),
  };
}

export async function exportProfileData(profile) {
  const snippets = await getSnippetsForProfile(profile.id);
  const tagIds = new Set(profile.tagIds || []);
  for (const s of snippets) for (const t of s.tagIds || []) tagIds.add(t);
  const tags = (await getTags()).filter((t) => tagIds.has(t.id));
  return {
    type: "profile",
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: await inlineProfileImages([profile]),
    tags: await inlineTagImages(tags),
    snippets: await inlineSnippetImages(snippets),
  };
}

export async function exportSnippetData(snippet) {
  const tags = (await getTags()).filter((t) => snippet.tagIds?.includes(t.id));
  const profiles = (await getProfiles()).filter((p) => snippet.profileIds?.includes(p.id));
  return {
    type: "snippet",
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: await inlineProfileImages(profiles),
    tags: await inlineTagImages(tags),
    snippets: await inlineSnippetImages([snippet]),
  };
}

// Always merges (adds new entries) rather than replacing anything, so a bad
// or repeated import can't destroy existing data. Tags dedupe by name (a
// shared taxonomy, like My Closet's boards); profiles and snippets are
// richer individual records so they always import as new, with their
// cross-references remapped to the freshly-created local ids.
// An imported image is either a data: URI (that's what export produces for
// anything that was locally uploaded) or a remote URL (an unfurled link's
// image, never inlined) -- a data: URI gets moved into the image store the
// same as a fresh upload, keyed by id (the record's own freshly-generated
// local id, so its image-store key matches). A remote URL passes through
// untouched; anything else (missing, or some unexpected shape) just means
// no image -- import still succeeds either way.
async function reviveImage(image, id) {
  if (typeof image !== "string" || !image.startsWith("data:")) return image || null;
  try {
    await putImage(id, await dataUrlToBlob(image));
    return IDB_PREFIX + id;
  } catch {
    return null;
  }
}

export async function importData(data) {
  if (!data || !["backup", "profile", "snippet"].includes(data.type)) {
    throw new Error("That doesn't look like a My Index export file.");
  }

  const importedTags = Array.isArray(data.tags) ? data.tags : [];
  const oldTagIdToLocalId = new Map();
  for (const tag of importedTags) {
    const local = await findOrCreateTag(tag.name);
    if (!local) continue;
    oldTagIdToLocalId.set(tag.id, local.id);

    // Fill in a pinned note / cover image only if the local tag doesn't
    // already have one -- findOrCreateTag may have resolved to an existing
    // tag by name (a dedupe, not a fresh row), so importing shouldn't
    // clobber what's already there.
    if (local.id !== UNCATEGORIZED_TAG_ID && (!local.pinnedNote || !local.image)) {
      const pinnedNote = local.pinnedNote || tag.pinnedNote || "";
      const image = local.image || (await reviveImage(tag.image, local.id));
      if (pinnedNote !== local.pinnedNote || image !== local.image) {
        await saveTagDetails(local.id, { name: local.name, pinnedNote, image });
      }
    }
  }
  const remapTagIds = (ids) => (ids || []).map((id) => oldTagIdToLocalId.get(id)).filter(Boolean);

  const importedProfiles = Array.isArray(data.profiles) ? data.profiles : [];
  const oldProfileIdToLocalId = new Map();
  const newProfiles = await Promise.all(
    importedProfiles.map(async (p) => {
      const id = uid();
      oldProfileIdToLocalId.set(p.id, id);
      return {
        ...createEmptyProfile(),
        ...p,
        id,
        image: await reviveImage(p.image, id),
        tagIds: remapTagIds(p.tagIds),
        channels: (p.channels || []).map((c) => ({ ...c, id: uid(), newCount: 0 })),
        newCount: 0,
        createdAt: Date.now(),
      };
    })
  );
  for (const profile of newProfiles) await putOne("profiles", profile);

  const importedSnippets = Array.isArray(data.snippets) ? data.snippets : [];
  const newSnippets = await Promise.all(
    importedSnippets.map(async (s) => {
      const id = uid();
      return {
        ...createEmptySnippet(),
        ...s,
        id,
        image: await reviveImage(s.image, id),
        tagIds: remapTagIds(s.tagIds),
        profileIds: (s.profileIds || []).map((pid) => oldProfileIdToLocalId.get(pid)).filter(Boolean),
        createdAt: Date.now(),
      };
    })
  );
  for (const snippet of newSnippets) await putOne("snippets", snippet);

  // Theme, home title, and the profile-row toggle are single current-state
  // settings, not a list, so a full backup restore applies them directly
  // rather than merging -- that's what "restore my backup" means for a
  // device's preferences.
  let preferencesApplied = false;
  if (data.type === "backup") {
    if (data.theme) setThemePref(data.theme);
    if (data.homeTitle) setHomeTitle(data.homeTitle);
    if (typeof data.showProfileRow === "boolean") setShowProfileRow(data.showProfileRow);
    preferencesApplied = Boolean(data.theme || data.homeTitle || typeof data.showProfileRow === "boolean");
  }

  return {
    profileCount: newProfiles.length,
    snippetCount: newSnippets.length,
    tagCount: importedTags.length,
    preferencesApplied,
  };
}

// One-time cleanup for anyone who saved a Profile avatar or Tag cover image
// before storage switched from raw Blobs to data: URI strings (Blobs stored
// in IndexedDB have a real WebKit/Safari readback bug -- see imageBlob.js).
// Converts each one in place and re-saves it. Runs once (gated by a flag)
// and just does nothing on every later run once there's nothing left with
// a Blob image.
export async function migrateLegacyImages() {
  if (localStorage.getItem(IMAGES_MIGRATED_KEY) === "true") return;

  const profiles = await getAll("profiles");
  for (const profile of profiles) {
    if (profile.image instanceof Blob) {
      await putOne("profiles", { ...profile, image: await blobToDataUrl(profile.image) });
    }
  }

  const tags = await getAll("tags");
  for (const tag of tags) {
    if (tag.image instanceof Blob) {
      await putOne("tags", { ...tag, image: await blobToDataUrl(tag.image) });
    }
  }

  localStorage.setItem(IMAGES_MIGRATED_KEY, "true");
}

// One-time cleanup for anyone who saved a Profile avatar, Tag cover, or
// Image-snippet photo before storage moved from inline data: URI strings to
// a separate image store (js/imageStore.js) -- keeping every image inlined
// directly on its record meant a plain "list all snippets" read pulled
// every image's bytes into memory too, even ones nowhere near the screen.
// Separate from migrateLegacyImages above (an older, different migration --
// Blob-on-record to inline string -- gated by its own flag): this one moves
// inline strings into the store instead. Converts each one in place and
// re-saves it. Runs once (gated by its own flag) and skips any record it
// can't process rather than letting one bad image block startup.
export async function migrateInlineImagesToIndexedDB() {
  if (localStorage.getItem(IMAGES_MIGRATED_TO_IDB_KEY) === "true") return;

  const profiles = await getAll("profiles");
  for (const profile of profiles) {
    if (typeof profile.image === "string" && profile.image.startsWith("data:")) {
      try {
        await putImage(profile.id, await dataUrlToBlob(profile.image));
        await putOne("profiles", { ...profile, image: IDB_PREFIX + profile.id });
      } catch {
        // Leave this one as-is and keep going with the rest.
      }
    }
  }

  const tags = await getAll("tags");
  for (const tag of tags) {
    if (typeof tag.image === "string" && tag.image.startsWith("data:")) {
      try {
        await putImage(tag.id, await dataUrlToBlob(tag.image));
        await putOne("tags", { ...tag, image: IDB_PREFIX + tag.id });
      } catch {
        // Leave this one as-is and keep going with the rest.
      }
    }
  }

  const snippets = await getAll("snippets");
  for (const snippet of snippets) {
    if (typeof snippet.image === "string" && snippet.image.startsWith("data:")) {
      try {
        await putImage(snippet.id, await dataUrlToBlob(snippet.image));
        await putOne("snippets", { ...snippet, image: IDB_PREFIX + snippet.id });
      } catch {
        // Leave this one as-is and keep going with the rest.
      }
    }
  }

  localStorage.setItem(IMAGES_MIGRATED_TO_IDB_KEY, "true");
}

// ---- Preferences ----

export function getThemePref() {
  return readJSON(THEME_KEY, {});
}

export function setThemePref(pref) {
  writeJSON(THEME_KEY, pref);
}

export function getHomeTitle() {
  return localStorage.getItem(HOME_TITLE_KEY) || "My Index";
}

export function setHomeTitle(value) {
  const trimmed = (value || "").trim();
  if (trimmed) localStorage.setItem(HOME_TITLE_KEY, trimmed);
  else localStorage.removeItem(HOME_TITLE_KEY);
}

// On by default -- absence of the key (never toggled, or a pre-existing
// install from before this setting existed) means "on," only an explicit
// "0" means someone opted out.
export function getShowProfileRow() {
  return localStorage.getItem(SHOW_PROFILE_ROW_KEY) !== "0";
}

export function setShowProfileRow(value) {
  localStorage.setItem(SHOW_PROFILE_ROW_KEY, value ? "1" : "0");
}

export function getLastSeenVersion() {
  return localStorage.getItem(LAST_SEEN_VERSION_KEY) || "";
}

export function setLastSeenVersion(version) {
  localStorage.setItem(LAST_SEEN_VERSION_KEY, version);
}

const BACKUP_REMIND_AFTER_MS = 14 * 24 * 60 * 60 * 1000; // 2 weeks
const BACKUP_SNOOZE_MS = 3 * 24 * 60 * 60 * 1000; // re-ask 3 days after "Later"

function getFirstOpenAt() {
  let v = Number(localStorage.getItem(FIRST_OPEN_KEY));
  if (!v) {
    v = Date.now();
    localStorage.setItem(FIRST_OPEN_KEY, String(v));
  }
  return v;
}

export function markBackedUp() {
  localStorage.setItem(LAST_BACKUP_KEY, String(Date.now()));
  localStorage.removeItem(BACKUP_BANNER_DISMISSED_KEY);
}

export function dismissBackupBanner() {
  localStorage.setItem(BACKUP_BANNER_DISMISSED_KEY, String(Date.now()));
}

// Nudges toward exporting a backup every ~2 weeks, since all data lives only
// on this device. Tied to the last time a real export happened (or, if
// never, since first open) -- not to when the banner was last shown -- so
// dismissing with "Later" doesn't quietly reset the clock without an actual
// backup having happened.
export async function shouldShowBackupBanner() {
  const [profiles, snippets] = await Promise.all([getProfiles(), getSnippets()]);
  if (profiles.length === 0 && snippets.length === 0) return false;

  const lastBackupAt = Number(localStorage.getItem(LAST_BACKUP_KEY)) || getFirstOpenAt();
  if (Date.now() - lastBackupAt < BACKUP_REMIND_AFTER_MS) return false;

  const dismissedAt = Number(localStorage.getItem(BACKUP_BANNER_DISMISSED_KEY));
  if (dismissedAt && Date.now() - dismissedAt < BACKUP_SNOOZE_MS) return false;

  return true;
}

const STORAGE_WARNING_SNOOZE_MS = 14 * 24 * 60 * 60 * 1000; // same 2-week cadence as the backup nudge

export function dismissStorageWarningBanner() {
  localStorage.setItem(STORAGE_WARNING_DISMISSED_KEY, String(Date.now()));
}

// Warns once local storage crosses 80% of the device's quota for this app,
// since finding out via a QuotaExceededError mid-upload or mid-sync is a
// much worse time than a quiet heads-up on Home. Best-effort: silently
// skipped wherever navigator.storage.estimate() isn't supported.
export async function shouldShowStorageWarning() {
  const usage = await getStorageUsage();
  if (!usage || usage.ratio < 0.8) return false;

  const dismissedAt = Number(localStorage.getItem(STORAGE_WARNING_DISMISSED_KEY));
  if (dismissedAt && Date.now() - dismissedAt < STORAGE_WARNING_SNOOZE_MS) return false;

  return true;
}

const DEFAULT_HOME_FILTER = { tagIds: [], types: [], dateFrom: "", dateTo: "" };

export function getHomeFilterPref() {
  return { ...DEFAULT_HOME_FILTER, ...readJSON(HOME_FILTER_KEY, {}) };
}

export function setHomeFilterPref(pref) {
  writeJSON(HOME_FILTER_KEY, pref);
}

const DEFAULT_PROFILES_FILTER = { sort: "recent", tagIds: [] };

export function getProfilesFilterPref() {
  return { ...DEFAULT_PROFILES_FILTER, ...readJSON(PROFILES_FILTER_KEY, {}) };
}

export function setProfilesFilterPref(pref) {
  writeJSON(PROFILES_FILTER_KEY, pref);
}

export function getOnboardingSeen() {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
}

export function setOnboardingSeen() {
  localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
}

export { uid };
