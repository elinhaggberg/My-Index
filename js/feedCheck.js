// Checks every channel that has a feed for new posts when the app is
// opened (and when it comes back to the foreground), at most every
// CHECK_INTERVAL_MS -- so the counts on profiles work for everyone, with no
// account and nothing running while the app isn't being looked at.
//
// Feeds are fetched through the same stateless api/read-feed.js the reader
// uses (via js/feedLoader.js, which also means a channel opened right
// after a check shows instantly), a few at a time, and compared on the
// device with what's already been read or noticed (js/feedState.js).
//
// This replaces the optional Supabase add-on's hourly server-side check as
// the source of the counts. The add-on still handles the iOS Shortcut
// capture flow; its counts are simply no longer read.

import { getProfiles, setChannelNewCounts } from "./storage.js";
import { loadFeed } from "./feedLoader.js";
import { recordCheck } from "./feedState.js";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CONCURRENCY = 4;
const LAST_CHECK_KEY = "mi_feed_check_at_v1";

let running = null;
const listeners = new Set();

// Views that show counts (Home's profile row, the Profiles list, a
// profile page) subscribe while they're on screen, and re-render the
// counts when a check finds something different.
export function onCountsChanged(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function lastCheckAt() {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY)) || 0;
  } catch {
    return 0;
  }
}

async function runPool(tasks, limit) {
  const queue = [...tasks];
  const workers = Array.from({ length: Math.min(limit, queue.length) }, async () => {
    while (queue.length) await queue.shift()();
  });
  await Promise.all(workers);
}

async function checkAll() {
  const profiles = await getProfiles();
  // profileId -> Map(channelId -> count)
  const results = new Map();
  const tasks = [];
  for (const profile of profiles) {
    for (const channel of profile.channels || []) {
      if (!channel.rssUrl) continue;
      tasks.push(async () => {
        try {
          // Always fetched fresh here -- a check is the one moment the
          // point is to see what's changed.
          const feed = await loadFeed(channel.rssUrl, { force: true });
          const count = await recordCheck(
            channel.id,
            feed.items.map((item) => item.id)
          );
          if (!results.has(profile.id)) results.set(profile.id, new Map());
          results.get(profile.id).set(channel.id, count);
        } catch {
          // A feed that's down or moved keeps its last count, quietly --
          // same as the reader, nothing here is worth an error message.
        }
      });
    }
  }
  if (tasks.length === 0) return false;
  await runPool(tasks, CONCURRENCY);

  let changed = false;
  for (const [profileId, counts] of results) {
    if (await setChannelNewCounts(profileId, counts)) changed = true;
  }
  return changed;
}

export function checkFeedsIfDue({ force = false } = {}) {
  if (running) return running;
  if (!force && Date.now() - lastCheckAt() < CHECK_INTERVAL_MS) return Promise.resolve(false);
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
  } catch {
    // Without storage the check just runs on every opening -- still correct.
  }
  running = checkAll()
    .then((changed) => {
      if (changed) listeners.forEach((fn) => fn());
      return changed;
    })
    .catch(() => false)
    .finally(() => {
      running = null;
    });
  return running;
}
