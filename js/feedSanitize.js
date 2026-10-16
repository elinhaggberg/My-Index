// Turns a feed item's untrusted HTML (see js/feedParse.js) into DOM nodes
// that are safe to put inside the app. A feed is someone else's markup
// running on our page, so this is an allowlist, not a blocklist: the input
// is parsed into an inert document (DOMParser never runs scripts or loads
// images), and only known-harmless elements are *rebuilt* fresh in the
// live document, each with only the few attributes it needs. Anything not
// on the list is either dropped with its contents (scripts, forms, styles)
// or unwrapped down to its text.
//
// It's also where the reader's media rules live, so nothing from a third
// party loads without being asked for:
//   - iframes/embeds/video/audio become a plain link card, never loaded
//   - tracking pixels (tiny or known-tracker images) are dropped outright
//   - every other image is a tap-to-show placeholder, unless the "Load
//     images in feeds automatically" preference is on -- and when one does
//     load, it's with no referrer, so the site can't see where it was read

import { ICON_IMAGE, ICON_EXTERNAL } from "./icons.js";
import { hostnameFor } from "./util.js";

// Rebuilt as-is (with their allowed attributes, below).
const KEEP = new Set([
  "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "pre", "code",
  "em", "strong", "b", "i", "u", "s", "del", "ins", "sub", "sup", "small", "mark", "abbr", "cite", "q",
  "a", "figure", "figcaption", "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
  "dl", "dt", "dd", "kbd", "samp", "var", "time",
]);

// Removed together with everything inside them.
const DROP = new Set([
  "script", "style", "noscript", "template", "form", "input", "button", "select", "textarea", "option",
  "object", "param", "svg", "math", "head", "title", "meta", "link", "base", "canvas", "map", "area",
  "dialog", "frameset", "frame", "applet", "portal",
]);

// Replaced with a link card pointing at whatever they would have loaded.
const EMBED = new Set(["iframe", "embed", "video", "audio"]);

const ALLOWED_ATTRS = {
  a: ["href", "title"],
  abbr: ["title"],
  ol: ["start", "reversed"],
  td: ["colspan", "rowspan"],
  th: ["colspan", "rowspan", "scope"],
  time: ["datetime"],
};

const TRACKER_HOSTS = [
  "pixel.wp.com",
  "stats.wordpress.com",
  "feeds.feedburner.com",
  "feedproxy.google.com",
  "list-manage.com",
  "mailchi.mp",
  "pixel.quantserve.com",
  "www.google-analytics.com",
  "ssl.google-analytics.com",
  "analytics.twitter.com",
  "www.facebook.com",
  "eotrx.substackcdn.com",
  "email.mg.substack.com",
];

function resolveUrl(href, base) {
  if (!href) return "";
  try {
    return new URL(href.trim(), base || undefined).toString();
  } catch {
    return "";
  }
}

function isSafeLink(url) {
  return /^(https?:|mailto:)/i.test(url);
}

function isTrackingPixel(img, src) {
  const w = Number(img.getAttribute("width"));
  const h = Number(img.getAttribute("height"));
  if ((w && w <= 2) || (h && h <= 2)) return true;
  const host = hostnameFor(src);
  return TRACKER_HOSTS.some((t) => host === t.replace(/^www\./, "") || host.endsWith("." + t));
}

// Lazy-loading markup (data-src etc.) is common in feeds copied straight
// from a site's own page -- without falling back to it, those images
// would have no src at all.
function imageSrc(img, base) {
  const raw = img.getAttribute("src") || img.getAttribute("data-src") || img.getAttribute("data-lazy-src") || "";
  if (/^data:image\//i.test(raw.trim())) return raw.trim();
  const url = resolveUrl(raw, base);
  return /^https?:/i.test(url) ? url : "";
}

function createImage(src, alt) {
  const img = document.createElement("img");
  img.className = "reader-img";
  img.referrerPolicy = "no-referrer";
  img.loading = "lazy";
  img.decoding = "async";
  img.alt = alt;
  img.src = src;
  return img;
}

function createImagePlaceholder(src, alt) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "reader-img-placeholder";
  btn.innerHTML = ICON_IMAGE;
  const label = document.createElement("span");
  label.className = "reader-img-placeholder-label";
  label.textContent = alt || "Image";
  const hint = document.createElement("span");
  hint.className = "reader-img-placeholder-hint";
  hint.textContent = `Tap to show · ${hostnameFor(src) || "embedded image"}`;
  btn.append(label, hint);
  btn.addEventListener("click", (e) => {
    // An image wrapped in a link shouldn't navigate on the tap that's
    // meant to reveal it.
    e.preventDefault();
    e.stopPropagation();
    btn.replaceWith(createImage(src, alt));
  });
  return btn;
}

// YouTube's /embed/ URLs open as a bare player outside an iframe -- the
// normal watch page is what someone tapping the card actually wants.
function embedTarget(src) {
  const m = src.match(/^https?:\/\/(?:www\.)?(?:youtube(?:-nocookie)?\.com)\/embed\/([\w-]{6,})/i);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : src;
}

function createEmbedCard(el, base) {
  const tag = el.localName;
  const source = el.querySelector?.("source[src]");
  const src = resolveUrl(el.getAttribute("src") || source?.getAttribute("src") || "", base);
  const kind = tag === "video" ? "Video" : tag === "audio" ? "Audio" : "Embedded content";
  if (!/^https?:/i.test(src)) {
    const span = document.createElement("p");
    span.className = "reader-embed-card reader-embed-card-empty";
    span.textContent = `${kind} not shown`;
    return span;
  }
  const a = document.createElement("a");
  a.className = "reader-embed-card";
  a.href = embedTarget(src);
  a.target = "_blank";
  a.rel = "noopener noreferrer";
  a.referrerPolicy = "no-referrer";
  const label = document.createElement("span");
  label.textContent = `${kind} from ${hostnameFor(src) || "another site"}`;
  a.append(label);
  a.insertAdjacentHTML("beforeend", ICON_EXTERNAL);
  return a;
}

function sanitizeChildren(sourceParent, targetParent, ctx) {
  for (const node of Array.from(sourceParent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      targetParent.appendChild(document.createTextNode(node.textContent));
      continue;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) continue;
    const out = sanitizeElement(node, ctx);
    if (out) targetParent.appendChild(out);
  }
}

function sanitizeElement(el, ctx) {
  const tag = el.localName;
  if (DROP.has(tag)) return null;
  if (EMBED.has(tag)) return createEmbedCard(el, ctx.base);

  if (tag === "picture") {
    const img = el.querySelector("img");
    return img ? sanitizeElement(img, ctx) : null;
  }

  if (tag === "img") {
    const src = imageSrc(el, ctx.base);
    if (!src || isTrackingPixel(el, src)) return null;
    const alt = (el.getAttribute("alt") || el.getAttribute("title") || "").trim();
    return ctx.loadImages ? createImage(src, alt) : createImagePlaceholder(src, alt);
  }

  if (!KEEP.has(tag)) {
    // Unknown / layout-only wrappers (div, span, section, article, font…):
    // keep their content, lose the element itself. Block-level ones still
    // need to break the text flow, or two divs' worth of text would run
    // together into one line.
    const frag = document.createDocumentFragment();
    sanitizeChildren(el, frag, ctx);
    if (/^(div|section|article|aside|header|footer|main|nav|center|details|summary)$/.test(tag)) {
      const block = document.createElement("div");
      block.appendChild(frag);
      return block;
    }
    return frag;
  }

  // Headings inside a post sit below the post's own title, so they're
  // shifted down to keep the page's outline (and type scale) sensible.
  const outTag = tag === "h1" || tag === "h2" ? "h3" : tag;
  const out = document.createElement(outTag);
  for (const attr of ALLOWED_ATTRS[tag] || []) {
    const value = el.getAttribute(attr);
    if (value == null) continue;
    if (attr === "href") {
      const url = resolveUrl(value, ctx.base);
      if (!isSafeLink(url)) continue;
      out.setAttribute("href", url);
    } else {
      out.setAttribute(attr, value);
    }
  }
  if (tag === "a" && out.hasAttribute("href")) {
    out.target = "_blank";
    out.rel = "noopener noreferrer";
    out.referrerPolicy = "no-referrer";
  }
  sanitizeChildren(el, out, ctx);

  // Wide tables and code blocks scroll on their own instead of pushing the
  // whole page sideways on a phone.
  if (tag === "table") {
    const wrap = document.createElement("div");
    wrap.className = "reader-table-wrap";
    wrap.appendChild(out);
    return wrap;
  }
  return out;
}

// base: the URL relative links/images in this item resolve against (the
// item's own link, falling back to the site's).
export function sanitizeFeedHtml(html, { base, loadImages }) {
  const doc = new DOMParser().parseFromString(html || "", "text/html");
  const frag = document.createDocumentFragment();
  sanitizeChildren(doc.body, frag, { base, loadImages });
  return frag;
}

// A teaser post (feedParse.js's isExcerpt) usually ends with the
// platform's own "Read more" button -- Substack's, WordPress's "Continue
// reading" -- which only repeats the reader's own preview note and
// full-post link right below it. Removes that one closing link line, and
// only when it's nothing but a link: a sentence in the author's own words
// ("…subscribe to read the rest") is part of the text and stays.
const READ_MORE_LINE = /^(read more|continue reading|keep reading|läs mer|läs hela|läs vidare)\b(?:[^.!?]|\.(?=\S)){0,60}$/i;

function lastElement(node) {
  for (let child = node.lastChild; child; child = child.previousSibling) {
    if (child.nodeType === Node.ELEMENT_NODE) return child;
    if (child.nodeType === Node.TEXT_NODE && child.textContent.trim()) return null;
  }
  return null;
}

export function stripTrailingReadMore(container) {
  let node = container;
  // Descends through wrapper elements (a post's content is often one big
  // <div>) to the last block actually on screen.
  for (let depth = 0; depth < 6; depth++) {
    const last = lastElement(node);
    if (!last) return;
    const isLinkLine = (last.localName === "a" || last.querySelector("a")) && READ_MORE_LINE.test(last.textContent.trim());
    if (isLinkLine) {
      const parent = last.parentNode;
      last.remove();
      if (parent !== container && !parent.textContent.trim() && !parent.querySelector("img, .reader-img-placeholder")) parent.remove();
      return;
    }
    node = last;
  }
}
