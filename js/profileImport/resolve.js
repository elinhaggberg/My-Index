// "Paste a link, get a whole profile." Tries the sources in the order the
// Oltra spec sets out (§8.1b): an Oltra link or published Oltra profile
// first, then the page's representative h-card, then plain feed discovery.
// The first source that finds something wins; nothing is merged.
//
// The two Oltra sources are placeholders for now -- the format is still
// being discussed -- but they sit in the chain already, so turning them on
// later changes nothing else: every source returns the same Oltra-shaped
// profile (see hcard.js), and the dialog and toMyIndex.js only ever see that.

import { loadMf2 } from "./mf2.js";
import { representativeHCard, hcardToProfile } from "./hcard.js";
import { discoverFeed } from "../discoverFeed.js";

const CONCURRENCY = 4;

export function normalizeInput(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    return /^https?:$/.test(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}

async function fetchPage(url) {
  const res = await fetch(`/api/profile-source?mode=page&url=${encodeURIComponent(url)}`);
  const data = await res.json().catch(() => ({ error: "Couldn't load that page." }));
  if (data.error || !data.html) throw new Error(data.error || "Couldn't load that page.");
  return data;
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

// ---- Sources ----

// An Oltra link (…/#oltra/v1/…) or pier link (…/@domain). Not supported
// yet, but recognised, so the message is honest instead of "nothing found".
async function oltraLinkSource(url) {
  if (/#oltra\/v\d+\//.test(url) || /^https?:\/\/[^/]+\/@[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(url)) {
    throw new Error("Oltra links can't be imported yet — paste the person's own website instead.");
  }
  return null;
}

// A profile published at /.well-known/oltra.json (or announced by the
// page's discovery link). Placeholder: always passes to the next source.
async function oltraPublishedSource() {
  return null;
}

async function hcardSource(url, ctx) {
  const page = await ctx.page();
  const mf2 = await loadMf2();
  let doc;
  try {
    doc = mf2(page.html, { baseUrl: page.finalUrl });
  } catch {
    // The parser refuses some pages (e.g. a body with no elements) -- that
    // just means no h-card here, so the next source gets its turn.
    return null;
  }
  const found = representativeHCard(doc, page.finalUrl);
  if (!found) return null;
  const profile = hcardToProfile(found.card, doc, page.finalUrl);
  if (!profile.name) return null;
  return { profile, provenance: { source: "h-card", url: page.finalUrl, domain: domainOf(page.finalUrl), fallback: found.fallback } };
}

// No profile markup at all: still useful if the page has a feed -- a
// profile with just a name (the page's title) and that one channel.
async function feedOnlySource(url, ctx) {
  const page = await ctx.page();
  const title = new DOMParser().parseFromString(page.html, "text/html").title.trim();
  const profile = { version: "oltra/v1", name: title || domainOf(page.finalUrl), bio: "", pronouns: "", image: null, home: page.finalUrl, channels: [{ url: page.finalUrl, isHome: true }] };
  return { profile, provenance: { source: "page", url: page.finalUrl, domain: domainOf(page.finalUrl), fallback: false } };
}

const SOURCES = [oltraLinkSource, oltraPublishedSource, hcardSource, feedOnlySource];

async function runPool(items, limit, fn) {
  const queue = items.map((item, i) => [item, i]);
  const out = new Array(items.length);
  await Promise.all(
    Array.from({ length: Math.min(limit, queue.length) }, async () => {
      while (queue.length) {
        const [item, i] = queue.shift();
        out[i] = await fn(item);
      }
    })
  );
  return out;
}

// Works out, for each channel, whether it has a feed (type "feed") or is a
// link only (type "door") -- the same discovery a manually added channel
// gets, run a few at a time.
async function detectFeeds(channels) {
  return runPool(channels, CONCURRENCY, async (channel) => {
    const result = await discoverFeed(channel.url);
    return result.ok ? { ...channel, type: "feed", feed: result.feedUrl } : { ...channel, type: "door" };
  });
}

export async function resolveProfile(input) {
  const url = normalizeInput(input);
  if (!url) throw new Error("That doesn't look like a web address.");
  let pagePromise = null;
  const ctx = { page: () => (pagePromise ||= fetchPage(url)) };

  for (const source of SOURCES) {
    const found = await source(url, ctx);
    if (found) {
      found.profile.channels = await detectFeeds(found.profile.channels);
      if (found.provenance.source === "page" && !found.profile.channels.some((c) => c.type === "feed")) {
        throw new Error("No profile or feed found on that page.");
      }
      return found;
    }
  }
  throw new Error("No profile found on that page.");
}

// The profile photo, fetched once through the server (so its host never
// sees this device) and returned as a Blob ready to be resized and stored.
export async function fetchProfileImage(imageUrl) {
  const res = await fetch(`/api/profile-source?mode=image&url=${encodeURIComponent(imageUrl)}`);
  if (!res.ok) throw new Error("Couldn't load the photo.");
  return res.blob();
}
