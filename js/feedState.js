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

import { getOne, putOne } from "./db.js";

// Feeds only ever show their latest few dozen posts, so remembering far
// more ids than that just grows the row forever for nothing.
const MAX_SEEN_IDS = 1000;

async function readSeen(channelId) {
  const row = await getOne("feedState", channelId).catch(() => null);
  return row ? row.seenIds : null;
}

async function writeSeen(channelId, seenIds) {
  const trimmed = seenIds.length > MAX_SEEN_IDS ? seenIds.slice(seenIds.length - MAX_SEEN_IDS) : seenIds;
  await putOne("feedState", { id: channelId, seenIds: trimmed, updatedAt: Date.now() }).catch(() => {});
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
