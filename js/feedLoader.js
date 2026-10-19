// Fetches and parses a channel's feed through api/read-feed.js, with a
// short in-memory cache shared by the reader (js/views/feed.js) and the
// on-open check for new posts (js/feedCheck.js) -- so after the app has
// checked for new posts, opening a channel shows it straight away instead
// of downloading the same feed a second time.

import { parseFeed } from "./feedParse.js";

const FRESH_MS = 10 * 60 * 1000;
// rssUrl -> { feed, fetchedAt }
const cache = new Map();

export async function loadFeed(rssUrl, { force } = {}) {
  const cached = cache.get(rssUrl);
  if (cached && !force && Date.now() - cached.fetchedAt < FRESH_MS) return cached.feed;
  const res = await fetch(`/api/read-feed?url=${encodeURIComponent(rssUrl)}`);
  const data = await res.json().catch(() => ({ error: "Couldn't load the feed." }));
  if (data.error || !data.xml) throw new Error(data.error || "Couldn't load the feed.");
  const feed = parseFeed(data.xml, data.finalUrl || rssUrl);
  if (!feed) throw new Error("This feed couldn't be read.");
  cache.set(rssUrl, { feed, fetchedAt: Date.now() });
  return feed;
}
