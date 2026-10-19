// The RSS reader's per-channel read state, kept in IndexedDB's "feedState"
// store (one row per channel: { id: channelId, seenIds: [...] }). Entirely
// local -- separate from the server-side new-content badge (feedSync.js /
// check-feeds), which only knows *how many* new posts there are; this is
// what marks *which* ones with an unread dot in the reader.
//
// The first time a channel is opened, every post already in its feed is
// recorded as seen (a baseline), so a feed you've just added doesn't greet
// you with thirty dots that mean nothing. From then on, anything new shows
// up unread until that post itself is opened.

import { getAll, getOne, putOne, deleteOne } from "./db.js";

// Feeds only ever show their latest few dozen posts, so remembering far
// more ids than that just grows the row forever for nothing.
const MAX_SEEN_IDS = 1000;

// One row per channel holds both its read state and its image choice, so
// every write merges into whatever's already there rather than replacing
// the row -- marking a post read mustn't forget "always show images".
async function readRow(channelId) {
  return getOne("feedState", channelId).catch(() => null);
}

async function updateRow(channelId, changes) {
  const row = (await readRow(channelId)) || { id: channelId };
  const next = { ...row, ...changes, id: channelId, updatedAt: Date.now() };
  // A row with nothing left in it (images turned back off, never visited)
  // is just removed, instead of lingering as an empty record.
  if (!next.seenIds && !next.alwaysImages) {
    await deleteOne("feedState", channelId).catch(() => {});
    return;
  }
  await putOne("feedState", next).catch(() => {});
}

async function readSeen(channelId) {
  const row = await readRow(channelId);
  return row?.seenIds || null;
}

async function writeSeen(channelId, seenIds) {
  const trimmed = seenIds.length > MAX_SEEN_IDS ? seenIds.slice(seenIds.length - MAX_SEEN_IDS) : seenIds;
  await updateRow(channelId, { seenIds: trimmed });
}

// Returns the set of item ids currently unread, establishing the baseline
// on a channel's first visit.
export async function getUnreadIds(channelId, items) {
  const seen = await readSeen(channelId);
  if (!seen) {
    await writeSeen(channelId, items.map((item) => item.id));
    return new Set();
  }
  const seenSet = new Set(seen);
  return new Set(items.filter((item) => !seenSet.has(item.id)).map((item) => item.id));
}

export async function markSeen(channelId, itemIds) {
  const seen = (await readSeen(channelId)) || [];
  const seenSet = new Set(seen);
  const added = itemIds.filter((id) => !seenSet.has(id));
  if (added.length) await writeSeen(channelId, [...seen, ...added]);
}

// ---- Images, decided once per feed ----
// The reader asks the first time a feed's post has images (see
// js/views/feed.js) instead of making every image a separate tap; "Always
// for this feed" is remembered here, and listed in Customize so it can be
// taken back.

export async function getAlwaysImages(channelId) {
  return !!(await readRow(channelId))?.alwaysImages;
}

export async function setAlwaysImages(channelId, value) {
  await updateRow(channelId, { alwaysImages: value ? true : undefined });
}

export async function getAlwaysImagesChannelIds() {
  const rows = await getAll("feedState").catch(() => []);
  return rows.filter((row) => row.alwaysImages).map((row) => row.id);
}

// ---- New-post counts (js/feedCheck.js) ----
// The count on a profile answers "anything new since I last looked at this
// channel?", while a post's unread dot (above) stays until that post itself
// is opened. So the count needs its own memory: "noticed" ids, set when a
// channel's post list is opened (or a channel is marked as read). A post is
// counted only if it's neither read nor noticed.

function trimIds(ids) {
  return ids.length > MAX_SEEN_IDS ? ids.slice(ids.length - MAX_SEEN_IDS) : ids;
}

// Records the ids just fetched for a channel and returns how many are new.
// The first check of a channel sets the same baseline the reader does, so
// a newly added channel starts at zero rather than "30 new".
export async function recordCheck(channelId, ids) {
  const row = await readRow(channelId);
  if (!row?.seenIds) {
    await updateRow(channelId, { seenIds: trimIds([...ids]), latestIds: ids });
    return 0;
  }
  const seen = new Set(row.seenIds);
  const noticed = new Set(row.noticedIds || []);
  await updateRow(channelId, { latestIds: ids });
  return ids.filter((id) => !seen.has(id) && !noticed.has(id)).length;
}

// With no ids given, marks whatever the last check found -- what "Mark all
// as read" on a profile, or tapping through to a channel outside the
// reader, means.
export async function markNoticed(channelId, ids) {
  const row = await readRow(channelId);
  const toAdd = ids || row?.latestIds || [];
  if (!toAdd.length) return;
  const noticed = row?.noticedIds || [];
  const known = new Set(noticed);
  const added = toAdd.filter((id) => !known.has(id));
  if (added.length) await updateRow(channelId, { noticedIds: trimIds([...noticed, ...added]) });
}
