// Picks a My Index channel type (and, where it's clear, an Oltra `kind`)
// for a channel found during import, from its address alone. A guess the
// user can change in the profile editor, never a judgement on the content.
// See the Oltra spec, §8.6, for how the two models map onto each other.

const RULES = [
  { test: (h) => h === "youtube.com" || h === "youtu.be" || h.endsWith(".youtube.com"), type: "youtube", kind: "video" },
  { test: (h) => h.endsWith(".substack.com") || h === "substack.com" || h === "buttondown.com" || h === "buttondown.email" || h.endsWith(".beehiiv.com") || h.endsWith(".ghost.io"), type: "newsletter", kind: "text" },
  { test: (h) => h === "podcasts.apple.com" || h === "anchor.fm" || h === "overcast.fm" || h === "pca.st" || h === "podcasters.spotify.com", type: "podcast", kind: "audio" },
  { test: (h, p) => h === "open.spotify.com" && /^\/show\//.test(p), type: "podcast", kind: "audio" },
  { test: (h) => h === "bsky.app" || h === "threads.net" || h === "x.com" || h === "twitter.com", type: "social", kind: "short" },
  { test: (h) => h === "instagram.com" || h === "pixelfed.social" || h === "flickr.com", type: "social", kind: "image" },
  { test: (h) => h === "linkedin.com" || h === "tiktok.com" || h === "facebook.com", type: "social" },
  { test: (h) => h === "github.com" || h === "gitlab.com" || h === "codeberg.org", type: "other", kind: "code" },
  { test: (h) => h === "ko-fi.com" || h === "patreon.com" || h === "liberapay.com" || h === "buymeacoffee.com", type: "other", kind: "support" },
  // Mastodon and other fediverse servers can live on any domain, but their
  // profile addresses share a shape: /@name.
  { test: (h, p) => /^\/@[^/]+\/?$/.test(p), type: "social", kind: "short" },
];

export function classifyChannel(url, { hasFeed, isHome }) {
  let host = "";
  let path = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase().replace(/^www\.|^m\./, "");
    path = u.pathname;
  } catch {
    // Unparseable -- falls through to the defaults below.
  }
  const rule = RULES.find((r) => r.test(host, path));
  if (rule) return { type: rule.type, kind: rule.kind || "" };
  if (hasFeed) return { type: "blog", kind: "text" };
  return { type: isHome ? "website" : "other", kind: "" };
}
