import { getAll, getOne, putOne, deleteOne } from "./db.js";

const THEME_KEY = "mi_theme_v1";
const HOME_TITLE_KEY = "mi_home_title_v1";
const LAST_SEEN_VERSION_KEY = "mi_last_seen_version_v1";
const LAST_BACKUP_KEY = "mi_last_backup_at_v1";
const BACKUP_BANNER_DISMISSED_KEY = "mi_backup_banner_dismissed_at_v1";
const FIRST_OPEN_KEY = "mi_first_open_at_v1";
const ONBOARDING_SEEN_KEY = "mi_onboarding_seen_v1";
const HOME_TAG_FILTER_KEY = "mi_home_tag_filter_v1";

export const UNCATEGORIZED_TAG_ID = "uncategorized";

function uid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Date.now() + "-" + Math.random().toString(16).slice(2);
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

export const UNCATEGORIZED_TAG = { id: UNCATEGORIZED_TAG_ID, name: "Uncategorized", isSystem: true, pinnedNote: "" };

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

  const tag = { id: uid(), name: trimmed, pinnedNote: "", createdAt: Date.now() };
  await putOne("tags", tag);
  return tag;
}

export async function saveTagPinnedNote(id, pinnedNote) {
  const tag = await getOne("tags", id);
  if (!tag) return null;
  const updated = { ...tag, pinnedNote };
  await putOne("tags", updated);
  return updated;
}

export async function renameTag(id, name) {
  const trimmed = normalizeTagName(name);
  if (!trimmed) return null;
  const tag = await getOne("tags", id);
  if (!tag) return null;
  const updated = { ...tag, name: trimmed };
  await putOne("tags", updated);
  return updated;
}

// Deleting a tag just un-tags whatever referenced it (profiles fall back to
// their remaining tags; untagged snippets fall back into Uncategorized) —
// nothing referencing it is ever deleted outright.
export async function deleteTag(id) {
  await deleteOne("tags", id);
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

async function resolveTagNames(names) {
  const tags = [];
  for (const name of names) {
    const tag = await findOrCreateTag(name);
    if (tag && tag.id !== UNCATEGORIZED_TAG_ID) tags.push(tag);
  }
  return [...new Set(tags.map((t) => t.id))];
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
  const withTimestamp = { ...profile, updatedAt: Date.now() };
  await putOne("profiles", withTimestamp);
  return withTimestamp;
}

export async function deleteProfile(id) {
  await deleteOne("profiles", id);
  const snippets = await getAll("snippets");
  for (const snippet of snippets) {
    if (snippet.profileIds?.includes(id)) {
      await putOne("snippets", { ...snippet, profileIds: snippet.profileIds.filter((p) => p !== id) });
    }
  }
}

// Clears the profile's own badge and every one of its channels' badges at
// once -- mirrors "unread mail" behavior: opening the profile page is what
// clears it, not any per-channel action.
export async function clearProfileNewCount(id) {
  const profile = await getOne("profiles", id);
  if (!profile || !profile.newCount) return profile;
  const updated = {
    ...profile,
    newCount: 0,
    channels: (profile.channels || []).map((c) => ({ ...c, newCount: 0 })),
  };
  await putOne("profiles", updated);
  return updated;
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
  const withTimestamp = { ...snippet, updatedAt: Date.now() };
  await putOne("snippets", withTimestamp);
  return withTimestamp;
}

export async function deleteSnippet(id) {
  await deleteOne("snippets", id);
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

// ---- Export / import ----

export async function exportBackupData() {
  return {
    type: "backup",
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles: await getProfiles(),
    tags: await getTags(),
    snippets: await getSnippets(),
    theme: getThemePref(),
    homeTitle: getHomeTitle(),
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
    profiles: [profile],
    tags,
    snippets,
  };
}

export async function exportSnippetData(snippet) {
  const tags = (await getTags()).filter((t) => snippet.tagIds?.includes(t.id));
  const profiles = (await getProfiles()).filter((p) => snippet.profileIds?.includes(p.id));
  return {
    type: "snippet",
    version: 1,
    exportedAt: new Date().toISOString(),
    profiles,
    tags,
    snippets: [snippet],
  };
}

// Always merges (adds new entries) rather than replacing anything, so a bad
// or repeated import can't destroy existing data. Tags dedupe by name (a
// shared taxonomy, like My Closet's boards); profiles and snippets are
// richer individual records so they always import as new, with their
// cross-references remapped to the freshly-created local ids.
export async function importData(data) {
  if (!data || !["backup", "profile", "snippet"].includes(data.type)) {
    throw new Error("That doesn't look like a My Index export file.");
  }

  const importedTags = Array.isArray(data.tags) ? data.tags : [];
  const oldTagIdToLocalId = new Map();
  for (const tag of importedTags) {
    const local = await findOrCreateTag(tag.name);
    if (local) oldTagIdToLocalId.set(tag.id, local.id);
  }
  const remapTagIds = (ids) => (ids || []).map((id) => oldTagIdToLocalId.get(id)).filter(Boolean);

  const importedProfiles = Array.isArray(data.profiles) ? data.profiles : [];
  const oldProfileIdToLocalId = new Map();
  const newProfiles = importedProfiles.map((p) => {
    const id = uid();
    oldProfileIdToLocalId.set(p.id, id);
    return {
      ...createEmptyProfile(),
      ...p,
      id,
      tagIds: remapTagIds(p.tagIds),
      channels: (p.channels || []).map((c) => ({ ...c, id: uid(), newCount: 0 })),
      newCount: 0,
      createdAt: Date.now(),
    };
  });
  for (const profile of newProfiles) await putOne("profiles", profile);

  const importedSnippets = Array.isArray(data.snippets) ? data.snippets : [];
  const newSnippets = importedSnippets.map((s) => ({
    ...createEmptySnippet(),
    ...s,
    id: uid(),
    tagIds: remapTagIds(s.tagIds),
    profileIds: (s.profileIds || []).map((id) => oldProfileIdToLocalId.get(id)).filter(Boolean),
    createdAt: Date.now(),
  }));
  for (const snippet of newSnippets) await putOne("snippets", snippet);

  // Theme and home title are single current-state settings, not a list, so a
  // full backup restore applies them directly rather than merging -- that's
  // what "restore my backup" means for a device's preferences.
  let preferencesApplied = false;
  if (data.type === "backup") {
    if (data.theme) setThemePref(data.theme);
    if (data.homeTitle) setHomeTitle(data.homeTitle);
    preferencesApplied = Boolean(data.theme || data.homeTitle);
  }

  return {
    profileCount: newProfiles.length,
    snippetCount: newSnippets.length,
    tagCount: importedTags.length,
    preferencesApplied,
  };
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

export function getHomeTagFilter() {
  return localStorage.getItem(HOME_TAG_FILTER_KEY) || "";
}

export function setHomeTagFilter(tagId) {
  if (tagId) localStorage.setItem(HOME_TAG_FILTER_KEY, tagId);
  else localStorage.removeItem(HOME_TAG_FILTER_KEY);
}

export function getOnboardingSeen() {
  return localStorage.getItem(ONBOARDING_SEEN_KEY) === "true";
}

export function setOnboardingSeen() {
  localStorage.setItem(ONBOARDING_SEEN_KEY, "true");
}

export { uid };
