export function formatDate(ts) {
  const d = new Date(ts);
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

export function hostnameFor(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[c]));
}

// The only kinds of address allowed to become a clickable link. A stored
// URL can come from outside -- a feed, an imported profile or snippet file
// someone shared, a pasted link -- and a "javascript:" (or "data:") address
// in a link would run as code inside the app when tapped, with access to
// everything the app stores. Anything else is returned as "", and callers
// show no link at all. See the Oltra spec, §10 ("Sanitise URLs").
const LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

export function safeLinkUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    return LINK_PROTOCOLS.has(url.protocol) ? url.toString() : "";
  } catch {
    return "";
  }
}
