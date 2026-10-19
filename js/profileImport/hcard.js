// Finds the h-card that represents a page's owner, and turns it into the
// same in-memory shape as an Oltra profile (see the Oltra spec, §3), so the
// import dialog and the mapping into My Index don't need to know which
// source a profile came from. Nothing here is published or sent anywhere.

const MAX_BIO_LENGTH = 1000;

export function normalizeUrl(value) {
  try {
    const u = new URL(value);
    u.hash = "";
    u.hostname = u.hostname.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    return `${u.protocol}//${u.host}${path}${u.search}`;
  } catch {
    return "";
  }
}

const sameUrl = (a, b) => !!a && normalizeUrl(a) === normalizeUrl(b);

// A property value is either a plain string or an object ({ value, alt }
// for photos, { value, html } for e-* properties, or a nested microformat).
function str(value) {
  if (value == null) return "";
  if (typeof value === "string") return value.trim();
  return typeof value.value === "string" ? value.value.trim() : "";
}

function first(card, name) {
  return str(card.properties?.[name]?.[0]);
}

function all(card, name) {
  return (card.properties?.[name] || []).map(str).filter(Boolean);
}

function isHCard(item) {
  return Array.isArray(item?.type) && item.type.includes("h-card");
}

// The microformats representative h-card algorithm
// (https://microformats.org/wiki/representative-h-card-parsing):
//   1. an h-card whose uid and url both match the page URL;
//   2. else an h-card whose url matches one of the page's rel=me links;
//   3. else, if the page has exactly one h-card and its url matches the
//      page URL, that one.
// Plus one deliberate, marked deviation (an OPEN question in the spec): if
// none of those match but the page has exactly one h-card, it's used with
// `fallback: true`, since simple personal sites often omit the url.
export function representativeHCard(doc, pageUrl) {
  const cards = (doc.items || []).filter(isHCard);
  const relMe = doc.rels?.me || [];

  const byUidAndUrl = cards.find((c) => all(c, "uid").some((u) => sameUrl(u, pageUrl)) && all(c, "url").some((u) => sameUrl(u, pageUrl)));
  if (byUidAndUrl) return { card: byUidAndUrl, fallback: false };

  const byRelMe = cards.find((c) => all(c, "url").some((u) => relMe.some((m) => sameUrl(u, m))));
  if (byRelMe) return { card: byRelMe, fallback: false };

  if (cards.length === 1) {
    const matches = all(cards[0], "url").some((u) => sameUrl(u, pageUrl));
    return { card: cards[0], fallback: !matches };
  }
  return null;
}

function isWebUrl(value) {
  return /^https?:\/\//i.test(value);
}

function originOf(value) {
  try {
    return new URL(value).origin;
  } catch {
    return "";
  }
}

// h-card → Oltra-shaped profile. Channels only carry a url here; whether
// each one is a feed or a door is worked out afterwards (resolve.js).
export function hcardToProfile(card, doc, pageUrl) {
  const urls = all(card, "url").filter(isWebUrl);
  const home = urls.find((u) => sameUrl(u, pageUrl)) || urls.find((u) => originOf(u) === originOf(pageUrl)) || new URL("/", pageUrl).toString();

  const photoValue = card.properties?.photo?.[0];
  const photoUrl = str(photoValue);
  const image = isWebUrl(photoUrl) ? { url: photoUrl, alt: typeof photoValue === "object" ? photoValue.alt || "" : "" } : null;

  // Every other url on the card plus every rel=me link on the page is a
  // place the person can be found. Only web links become channels:
  // mailto:, tel:, sms:, xmpp: and the like are left out, as the spec
  // excludes contact details (§3.5). Other pages on the person's own site
  // are left out too -- they're part of the home channel, not elsewhere.
  const seen = new Set([normalizeUrl(home)]);
  const channels = [{ url: home, isHome: true }];
  for (const url of [...urls, ...(doc.rels?.me || [])]) {
    if (!isWebUrl(url)) continue;
    const key = normalizeUrl(url);
    if (!key || seen.has(key)) continue;
    if (originOf(url) === originOf(home)) continue;
    seen.add(key);
    channels.push({ url });
  }

  const bio = first(card, "note").replace(/\s+/g, " ").slice(0, MAX_BIO_LENGTH);
  return {
    version: "oltra/v1",
    name: first(card, "name") || first(card, "nickname"),
    pronouns: first(card, "pronouns") || first(card, "pronoun"),
    bio,
    image,
    home,
    channels,
  };
}
