// Vercel serverless function: given a channel's page URL, finds its RSS/Atom
// feed automatically so adding a channel doesn't require knowing that
// Substack's feed lives at a different subdomain than its share link, or
// that YouTube's feed needs a channel id instead of the @handle in the URL.
// Also doubles as a plain verify-this-url check: if the given url is itself
// already a feed (someone pasted a direct feed link, or an already-known
// rssUrl needs re-checking on save), step 0 below finds that immediately
// without needing to fetch a second URL.
//
// Same statelessness/no-data-collection premise as unfurl.js — this is a
// read-only proxy, nothing here is stored or logged.

const TIMEOUT_MS = 8000;
const MAX_BODY_LENGTH = 700000;
const CANDIDATE_PATHS = ["/feed", "/feed.xml", "/rss", "/rss.xml", "/atom.xml", "/index.xml"];
const USER_AGENT = "Mozilla/5.0 (compatible; MyIndexApp/1.0; +https://vercel.com)";

// Same minimal, dependency-free check as supabase/functions/check-feeds —
// good enough to tell "this is a real feed" from "this is a webpage that 404
// dressed up as 200," not meant to be a full parser.
function looksLikeFeed(body) {
  if (!body) return false;
  const head = body.slice(0, 2000);
  if (/<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head)) return true;
  return /<item\b[\s\S]*?<\/item>/i.test(body) || /<entry\b[\s\S]*?<\/entry>/i.test(body);
}

function resolveUrl(maybeRelative, base) {
  if (!maybeRelative) return "";
  try {
    return new URL(maybeRelative, base).toString();
  } catch {
    return "";
  }
}

function getAlternateFeedLink(html, baseUrl) {
  const linkTags = html.match(/<link\b[^>]*>/gi) || [];
  for (const tag of linkTags) {
    if (!/rel=["']alternate["']/i.test(tag)) continue;
    if (!/type=["']application\/(rss|atom)\+xml["']/i.test(tag)) continue;
    const href = tag.match(/href=["']([^"']*)["']/i);
    if (href) return resolveUrl(href[1], baseUrl);
  }
  return "";
}

// YouTube pages embed their internal channel id in a few different spots
// depending on which URL shape was fetched (@handle, /channel/UC.., /c/name,
// /user/name) -- these two patterns cover all of them without needing to
// know which shape we got.
function getYouTubeChannelId(html) {
  const match = html.match(/"channelId":"(UC[\w-]{22})"/) || html.match(/<meta itemprop="channelId" content="(UC[\w-]{22})"/i);
  return match ? match[1] : "";
}

function isYouTubeHost(hostname) {
  const host = hostname.replace(/^www\./, "").replace(/^m\./, "");
  return host === "youtube.com" || host === "youtu.be" || host === "youtube-nocookie.com";
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timeout);
  }
}

// Fetches a candidate feed URL and confirms it actually parses as RSS/Atom
// before ever handing it back — a 200 response that's really an HTML error
// page (common on paths guessed blind, like /rss on a site with no feed)
// would otherwise look like a match.
async function verifyFeedCandidate(url) {
  try {
    const res = await fetchWithTimeout(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*" } });
    if (!res.ok) return null;
    const body = (await res.text()).slice(0, MAX_BODY_LENGTH);
    return looksLikeFeed(body) ? res.url || url : null;
  } catch {
    return null;
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  const target = req.query.url;
  if (!target || typeof target !== "string") {
    res.status(400).json({ error: "Missing url parameter." });
    return;
  }

  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    res.status(400).json({ ok: false, error: "That doesn't look like a valid URL." });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ ok: false, error: "Only http/https URLs are supported." });
    return;
  }

  try {
    // Step 0: the given URL might already be a direct feed link (a pasted
    // manual rssUrl being re-verified, or a candidate that happens to also
    // be the page itself) -- fetching it once here covers both that case
    // and, if it's HTML instead, doubles as the fetch autodiscovery (step 1)
    // needs anyway.
    const initial = await fetchWithTimeout(target, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/rss+xml,application/atom+xml,application/xml" } });
    if (!initial.ok) {
      res.status(200).json({ ok: false });
      return;
    }
    const finalUrl = initial.url || target;
    const body = (await initial.text()).slice(0, MAX_BODY_LENGTH);

    if (looksLikeFeed(body)) {
      res.status(200).json({ ok: true, feedUrl: finalUrl });
      return;
    }

    // Step 1: HTML page -- look for its own autodiscovery <link> tag first,
    // since a site that publishes one is telling us exactly where its feed
    // lives (this is also what makes a Substack /@name share link work: it
    // redirects to the name.substack.com homepage, whose HTML has this tag
    // pointing at /feed, with no Substack-specific code needed here).
    const declared = getAlternateFeedLink(body, finalUrl);
    if (declared) {
      const verified = await verifyFeedCandidate(declared);
      if (verified) {
        res.status(200).json({ ok: true, feedUrl: verified });
        return;
      }
    }

    // Step 2: YouTube channel id lookup -- the feed URL needs the internal
    // channel id, not whatever URL shape (@handle, /c/, /user/) the page
    // was given as.
    if (isYouTubeHost(parsed.hostname)) {
      const channelId = getYouTubeChannelId(body);
      if (channelId) {
        const candidate = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
        const verified = await verifyFeedCandidate(candidate);
        if (verified) {
          res.status(200).json({ ok: true, feedUrl: verified });
          return;
        }
      }
    }

    // Step 3: common path guesses against the final URL's origin, for sites
    // that don't declare an autodiscovery link at all.
    const origin = new URL(finalUrl).origin;
    for (const path of CANDIDATE_PATHS) {
      const verified = await verifyFeedCandidate(origin + path);
      if (verified) {
        res.status(200).json({ ok: true, feedUrl: verified });
        return;
      }
    }

    res.status(200).json({ ok: false });
  } catch (err) {
    const message = err && err.name === "AbortError" ? "Timed out." : "Couldn't fetch that page.";
    res.status(200).json({ ok: false, error: message });
  }
};
