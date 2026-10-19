// Vercel serverless function: fetches a channel's RSS/Atom feed server-side
// for the in-app reader (js/views/feed.js) -- the browser can't read most
// feeds itself, since few sites send CORS headers on them. Deliberately a
// thin pass-through: it hands back the raw XML untouched and lets the
// client parse it with the browser's own XML parser (js/feedParse.js),
// rather than carrying a second, regex-based feed parser here.
//
// Same statelessness/no-data-collection premise as unfurl.js -- nothing
// here is stored or logged. Only ever returns a body that actually looks
// like a feed, so this can't be used as a general-purpose proxy for
// arbitrary web pages.

const { safeFetch, BlockedAddressError } = require("./_lib/safeFetch.js");

const TIMEOUT_MS = 10000;
// Feeds that carry each post's full text (Simon Willison's, most
// WordPress/Ghost blogs) run a lot larger than the HTML pages unfurl.js
// deals with -- a few hundred KB is normal, a couple of MB not unheard of.
const MAX_BODY_LENGTH = 4000000;
const USER_AGENT = "Mozilla/5.0 (compatible; MyIndexApp/1.0; +https://vercel.com)";
const ACCEPT_HEADER = "application/rss+xml, application/atom+xml, application/xml, text/xml, */*";

// Same check as api/discover-feed.js and supabase/functions/check-feeds.
function looksLikeFeed(body) {
  if (!body) return false;
  const head = body.slice(0, 2000);
  if (/<rss[\s>]/i.test(head) || /<feed[\s>]/i.test(head) || /<rdf:RDF[\s>]/i.test(head)) return true;
  return /<item\b[\s\S]*?<\/item>/i.test(body) || /<entry\b[\s\S]*?<\/entry>/i.test(body);
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
    res.status(400).json({ error: "That doesn't look like a valid URL." });
    return;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    res.status(400).json({ error: "Only http/https URLs are supported." });
    return;
  }

  try {
    // This hands a response body back verbatim, so it matters even more
    // than in unfurl.js that it can't be pointed at an internal address:
    // safeFetch refuses those on the first request and on every redirect
    // (see api/_lib/safeFetch.js).
    const response = await safeFetch(parsed.toString(), {
      timeoutMs: TIMEOUT_MS,
      maxBytes: MAX_BODY_LENGTH,
      headers: { "User-Agent": USER_AGENT, Accept: ACCEPT_HEADER },
    });

    if (!response.ok) {
      res.status(200).json({ error: `The feed couldn't be loaded (HTTP ${response.status}).` });
      return;
    }

    const body = await response.text();

    if (!looksLikeFeed(body)) {
      res.status(200).json({ error: "That address didn't return a feed — it may have moved." });
      return;
    }

    // A short shared cache is fine here -- a public feed is the same for
    // everyone, and nothing about the requester is part of the response.
    res.setHeader("Cache-Control", "public, s-maxage=120, stale-while-revalidate=600");
    res.status(200).json({ xml: body, finalUrl: response.url || parsed.toString() });
  } catch (err) {
    const message =
      err instanceof BlockedAddressError
        ? "That address isn't reachable from here."
        : err && err.name === "AbortError"
          ? "Timed out loading the feed."
          : "Couldn't load the feed.";
    res.status(200).json({ error: message });
  }
};
