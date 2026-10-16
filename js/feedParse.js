// Turns a raw RSS 2.0 / RSS 1.0 (RDF) / Atom document -- as handed back
// verbatim by api/read-feed.js -- into the plain shape the reader view
// (js/views/feed.js) renders. Uses the browser's own XML parser rather
// than regex like the server-side badge check (check-feeds), since the
// reader needs every field (title, body, author, date), not just an id.
//
// Item bodies come out as an untrusted HTML *string* -- it's js/
// feedSanitize.js's job to turn that into something safe to put on screen.

const MAX_ITEMS = 50;

// Only HTML's five XML-safe entities and numeric references are legal in
// XML -- a feed that uses &nbsp;, &mdash; etc. outside a CDATA block, or a
// bare "&" in a title, is technically broken and fails a strict parse
// outright. Escaping every other "&" lets the parse succeed; at worst a
// named entity in a title then shows literally instead of as its glyph.
function repairEntities(xml) {
  return xml.replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[0-9a-fA-F]+);)/g, "&amp;");
}

function parseXml(xml) {
  const parser = new DOMParser();
  let doc = parser.parseFromString(xml, "application/xml");
  if (doc.getElementsByTagName("parsererror").length) {
    doc = parser.parseFromString(repairEntities(xml), "application/xml");
    if (doc.getElementsByTagName("parsererror").length) return null;
  }
  return doc;
}

// Matches on the element's qualified name ("content:encoded", "dc:date")
// or its bare local name ("title") -- namespace prefixes vary between
// feeds far more than the URIs they're bound to, but in practice the
// conventional prefixes are what everyone uses.
function children(el, name) {
  return Array.from(el.children).filter((c) => c.nodeName === name || (!name.includes(":") && c.localName === name && !c.prefix));
}

function child(el, ...names) {
  for (const name of names) {
    const found = children(el, name)[0];
    if (found) return found;
  }
  return null;
}

function text(el) {
  return el ? el.textContent.trim() : "";
}

// Feed titles are meant to be plain text, but plenty carry escaped markup
// or entities anyway (Atom's type="html" makes it explicit) -- strip it
// down to the text a reader would actually see.
function plainText(str) {
  if (!str) return "";
  if (!/[<&]/.test(str)) return str.trim();
  // A space at every block boundary, or "…end of one paragraph.Start of
  // the next" runs together once the tags are gone.
  const spaced = str.replace(/<\/?(?:p|div|br|li|h[1-6]|blockquote|tr|td|th|figcaption|pre)\b[^>]*>/gi, " $&");
  const doc = new DOMParser().parseFromString(spaced, "text/html");
  return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
}

function escapeText(str) {
  return str.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
}

// Atom text constructs (title, summary, content) come in three flavors:
// type="html" (escaped HTML as text), type="xhtml" (real child elements
// inside a wrapping <div>), and plain text (the default).
function atomHtml(el) {
  if (!el) return "";
  const type = (el.getAttribute("type") || "text").toLowerCase();
  if (type === "xhtml") {
    const serializer = new XMLSerializer();
    return Array.from(el.childNodes).map((n) => serializer.serializeToString(n)).join("");
  }
  if (type === "html" || type === "text/html") return el.textContent;
  return `<p>${escapeText(el.textContent.trim()).replace(/\n\s*\n/g, "</p><p>")}</p>`;
}

function parseDate(str) {
  if (!str) return null;
  const d = new Date(str.trim());
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

function resolve(href, base) {
  if (!href) return "";
  try {
    return new URL(href.trim(), base || undefined).toString();
  } catch {
    return "";
  }
}

function atomLink(el, base) {
  const links = children(el, "link");
  const alternate = links.find((l) => !l.getAttribute("rel") || l.getAttribute("rel") === "alternate");
  return resolve((alternate || links[0])?.getAttribute("href") || "", base);
}

// A feed that only carries a teaser (most Substacks, many news sites)
// should say so, rather than ending abruptly as if that were the whole
// post. Only judged when the item has no dedicated full-content field --
// a short body in content:encoded / <content> is just a short post. Length
// alone isn't a signal: plenty of feeds (Simon Willison's among them) put
// the whole post in <summary>, and many posts are genuinely short, so only
// a trailing ellipsis / "read more" marks a teaser.
function looksLikeExcerpt(html) {
  const plain = plainText(html);
  return /(\.\.\.|…|\[…\]|\[\.\.\.\]|read more|continue reading|keep reading)\s*\]?\s*$/i.test(plain);
}

function excerptFrom(html, length = 220) {
  const plain = plainText(html);
  return plain.length > length ? plain.slice(0, length).replace(/\s+\S*$/, "") + "…" : plain;
}

function parseAtom(root, feedUrl) {
  const siteUrl = atomLink(root, feedUrl);
  const feedAuthor = text(child(child(root, "author") || root, "name"));
  const items = children(root, "entry").map((entry) => {
    const link = atomLink(entry, siteUrl || feedUrl);
    const content = child(entry, "content");
    const summary = child(entry, "summary");
    const html = atomHtml(content && !content.getAttribute("src") ? content : summary);
    const author = text(child(child(entry, "author") || entry, "name")) || feedAuthor;
    return {
      id: text(child(entry, "id")) || link,
      title: plainText(child(entry, "title")?.textContent || ""),
      link,
      date: parseDate(text(child(entry, "published", "updated"))),
      author,
      html,
      isExcerpt: !content && looksLikeExcerpt(html),
    };
  });
  return { title: plainText(text(child(root, "title"))), siteUrl, items };
}

// RSS 2.0 and RSS 1.0 (RDF) differ mostly in where <item> lives -- inside
// <channel> for 2.0, as a sibling of it for 1.0.
function parseRss(root, feedUrl) {
  const channel = child(root, "channel") || root;
  const itemEls = children(channel, "item").length ? children(channel, "item") : children(root, "item");
  // <atom:link rel="self"> is common inside an RSS <channel> and would
  // otherwise match a bare "link" lookup on some parsers; only the
  // un-prefixed RSS <link> element holds the site's address.
  const siteUrl = resolve(text(children(channel, "link").find((l) => !l.prefix) || null), feedUrl);
  const items = itemEls.map((item) => {
    const link = resolve(text(children(item, "link").find((l) => !l.prefix) || null), siteUrl || feedUrl);
    const full = child(item, "content:encoded");
    const html = full ? full.textContent : child(item, "description")?.textContent || "";
    return {
      id: text(child(item, "guid")) || link || text(child(item, "title")),
      title: plainText(text(child(item, "title"))),
      link,
      date: parseDate(text(child(item, "pubDate", "dc:date"))),
      author: plainText(text(child(item, "dc:creator", "author"))),
      html,
      isExcerpt: !full && looksLikeExcerpt(html),
    };
  });
  return { title: plainText(text(child(channel, "title"))), siteUrl, items };
}

// Returns null if the document can't be read as a feed at all.
export function parseFeed(xml, feedUrl) {
  const doc = parseXml(xml);
  if (!doc) return null;
  const root = doc.documentElement;
  const name = root.localName.toLowerCase();
  let feed;
  if (name === "feed") feed = parseAtom(root, feedUrl);
  else if (name === "rss" || name === "rdf") feed = parseRss(root, feedUrl);
  else return null;

  // Same reasoning as check-feeds' orderNewestFirst: trust each item's own
  // date over document order when every item has one, since not every
  // feed lists newest-first.
  let items = feed.items.filter((item) => item.id);
  if (items.length && items.every((item) => item.date)) items = [...items].sort((a, b) => b.date - a.date);

  feed.items = items
    .slice(0, MAX_ITEMS)
    .map((item) => ({ ...item, title: item.title || excerptFrom(item.html, 80) || "Untitled", excerpt: excerptFrom(item.html) }));
  return feed;
}
