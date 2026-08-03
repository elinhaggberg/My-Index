// Thin client for api/discover-feed.js -- given a channel's page URL, finds
// its RSS/Atom feed (or verifies a URL that's already a direct feed link).
// Best-effort: network errors/timeouts just resolve to not-found rather than
// throwing, since this is a nice-to-have auto-fill, never something that
// should block saving a profile.
export async function discoverFeed(url) {
  try {
    const res = await fetch(`/api/discover-feed?url=${encodeURIComponent(url)}`);
    if (!res.ok) return { ok: false };
    return await res.json();
  } catch {
    return { ok: false };
  }
}
