// The in-app RSS reader for a single channel: #/feed/<profileId>/<channelId>
// lists the feed's posts (title, date, a short excerpt, an unread dot for
// anything new since the last visit), and #/feed/<profileId>/<channelId>/
// <itemId> shows one post's text. Both are real routes, so the back arrow
// and iOS's swipe-back work the way they do everywhere else in the app.
//
// The feed is fetched through api/read-feed.js, parsed client-side
// (js/feedParse.js), and kept in memory for the session so moving between
// the list and a post doesn't re-download it each time. Nothing about
// what's been read leaves the device (js/feedState.js).

import { getProfile, clearChannelNewCount, createEmptySnippet, getLoadFeedImages } from "../storage.js";
import { clearChannelServerCount } from "../feedSync.js";
import { opensInReader } from "../channelTypes.js";
import { parseFeed } from "../feedParse.js";
import { sanitizeFeedHtml, stripTrailingReadMore } from "../feedSanitize.js";
import { getUnreadIds, markSeen } from "../feedState.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { formatDate, hostnameFor } from "../util.js";
import { ICON_EXTERNAL } from "../icons.js";

const FRESH_MS = 10 * 60 * 1000;
// channelId -> { feed, fetchedAt, listScrollY }
const cache = new Map();

async function loadFeed(channel, { force } = {}) {
  const cached = cache.get(channel.id);
  if (cached && !force && Date.now() - cached.fetchedAt < FRESH_MS) return cached.feed;
  const res = await fetch(`/api/read-feed?url=${encodeURIComponent(channel.rssUrl)}`);
  const data = await res.json().catch(() => ({ error: "Couldn't load the feed." }));
  if (data.error || !data.xml) throw new Error(data.error || "Couldn't load the feed.");
  const feed = parseFeed(data.xml, data.finalUrl || channel.rssUrl);
  if (!feed) throw new Error("This feed couldn't be read.");
  cache.set(channel.id, { feed, fetchedAt: Date.now(), listScrollY: cached?.listScrollY || 0 });
  return feed;
}

// A channel saved with its feed's own address as its URL (easy to do --
// it's what a "subscribe via RSS" link hands you) would otherwise send
// "Open in browser" straight to raw XML. The feed itself says where the
// site lives, so prefer that whenever the channel URL looks like a feed.
function looksLikeFeedUrl(url) {
  try {
    const path = new URL(url).pathname.toLowerCase();
    return /\.(xml|rss|atom)$/.test(path) || /(^|\/)(feed|rss|atom)(\/|$)/.test(path);
  } catch {
    return false;
  }
}

function siteUrlFor(channel, feed) {
  if (channel.url && channel.url !== channel.rssUrl && !looksLikeFeedUrl(channel.url)) return channel.url;
  return feed?.siteUrl || channel.url;
}

function setOpenInBrowser(root, url) {
  const link = root.querySelector("#feed-open-btn");
  if (url) {
    link.href = url;
    link.classList.remove("hidden");
  } else {
    link.classList.add("hidden");
  }
}

function showMessage(body, text, url) {
  const wrap = document.createElement("div");
  wrap.className = "empty-state";
  const p = document.createElement("p");
  p.textContent = text;
  wrap.appendChild(p);
  if (url) {
    const a = document.createElement("a");
    a.className = "text-btn secondary feed-message-link";
    a.href = url;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "Open in browser";
    wrap.appendChild(a);
  }
  body.replaceChildren(wrap);
}

function itemMeta(item) {
  return [item.date ? formatDate(item.date) : "", item.author].filter(Boolean).join(" · ");
}

export async function renderFeed(root, nav, param) {
  // The router has already decoded the whole param, so an item id that is
  // itself a URL (most RSS guids are) still has its slashes -- only the
  // first two separators are ours.
  const [profileId, channelId, ...rest] = param.split("/");
  const itemId = rest.length ? rest.join("/") : null;

  const tpl = document.getElementById("tpl-feed");
  root.replaceChildren(tpl.content.cloneNode(true));
  const body = root.querySelector("#feed-body");
  const titleEl = root.querySelector("#feed-title");
  const listHash = `#/feed/${encodeURIComponent(profileId)}/${encodeURIComponent(channelId)}`;
  root.querySelector(".back-btn").addEventListener("click", () =>
    nav.back(itemId ? listHash : `#/profile/${encodeURIComponent(profileId)}`)
  );

  const profile = await getProfile(profileId);
  const channel = profile?.channels?.find((c) => c.id === channelId);
  if (!channel || !opensInReader(channel)) {
    if (profile) nav.toProfile(profileId);
    else nav.toHome();
    return;
  }

  titleEl.textContent = hostnameFor(siteUrlFor(channel, null)) || profile.name || "Feed";
  setOpenInBrowser(root, siteUrlFor(channel, null));
  showMessage(body, "Loading…");

  let feed;
  try {
    feed = await loadFeed(channel);
  } catch (err) {
    showMessage(body, `${err.message} You can still open the site itself.`, siteUrlFor(channel, null));
    return;
  }
  // The user may have navigated away while the fetch was in flight.
  if (!root.contains(body)) return;

  const siteUrl = siteUrlFor(channel, feed);
  titleEl.textContent = feed.title || hostnameFor(siteUrl) || profile.name;

  if (itemId) {
    const item = feed.items.find((i) => i.id === itemId);
    if (!item) {
      setOpenInBrowser(root, siteUrl);
      showMessage(body, "This post is no longer in the feed.", siteUrl);
      return;
    }
    renderItem(root, nav, { profile, channel, feed, item, siteUrl });
  } else {
    await renderList(root, nav, { profile, channel, feed, siteUrl, listHash });
  }
}

async function renderList(root, nav, { profile, channel, feed, siteUrl, listHash }) {
  const body = root.querySelector("#feed-body");
  setOpenInBrowser(root, siteUrl);

  // Opening the reader is what "having looked" at a channel's new posts
  // means now -- same as tapping through to the channel used to, so the
  // badge on the profile (and Home) clears here, locally and server-side.
  if (channel.newCount) {
    clearChannelNewCount(profile.id, channel.id);
    clearChannelServerCount(channel.id);
  }

  if (feed.items.length === 0) {
    showMessage(body, "This feed doesn't have any posts right now.", siteUrl);
    return;
  }

  const unread = await getUnreadIds(channel.id, feed.items);

  const header = document.createElement("div");
  header.className = "section-label-row feed-list-header";
  const label = document.createElement("p");
  label.className = "card-detail-section-label";
  const markAllBtn = document.createElement("button");
  markAllBtn.type = "button";
  markAllBtn.className = "mark-read-btn";
  markAllBtn.textContent = "Mark all as read";
  function renderHeader() {
    label.textContent = unread.size ? `${unread.size} unread` : "Latest posts";
    markAllBtn.classList.toggle("hidden", unread.size === 0);
  }
  markAllBtn.addEventListener("click", () => {
    markSeen(channel.id, [...unread]);
    unread.clear();
    list.querySelectorAll(".feed-unread-dot").forEach((d) => d.remove());
    list.querySelectorAll(".feed-item-row.unread").forEach((r) => r.classList.remove("unread"));
    renderHeader();
  });
  header.append(label, markAllBtn);
  renderHeader();

  const list = document.createElement("div");
  list.className = "feed-list";
  for (const item of feed.items) {
    const row = document.createElement("button");
    row.type = "button";
    row.className = "feed-item-row" + (unread.has(item.id) ? " unread" : "");

    const titleRow = document.createElement("span");
    titleRow.className = "feed-item-title";
    if (unread.has(item.id)) {
      const dot = document.createElement("span");
      dot.className = "feed-unread-dot";
      dot.setAttribute("aria-label", "Unread");
      titleRow.appendChild(dot);
    }
    titleRow.append(document.createTextNode(item.title));

    const meta = document.createElement("span");
    meta.className = "feed-item-meta";
    meta.textContent = itemMeta(item);

    row.append(titleRow);
    if (meta.textContent) row.append(meta);
    if (item.excerpt && item.excerpt !== item.title) {
      const excerpt = document.createElement("span");
      excerpt.className = "feed-item-excerpt";
      excerpt.textContent = item.excerpt;
      row.append(excerpt);
    }

    row.addEventListener("click", () => {
      const entry = cache.get(channel.id);
      if (entry) entry.listScrollY = window.scrollY;
      location.hash = `${listHash}/${encodeURIComponent(item.id)}`;
    });
    list.appendChild(row);
  }

  body.replaceChildren(header, list);
  const entry = cache.get(channel.id);
  if (entry?.listScrollY) window.scrollTo(0, entry.listScrollY);
}

function renderItem(root, nav, { profile, channel, feed, item, siteUrl }) {
  const body = root.querySelector("#feed-body");
  const link = item.link || siteUrl;
  setOpenInBrowser(root, link);
  markSeen(channel.id, [item.id]);
  window.scrollTo(0, 0);

  const article = document.createElement("article");
  article.className = "reader-article";

  const title = document.createElement("h2");
  title.className = "reader-title";
  title.textContent = item.title;
  article.appendChild(title);

  const metaText = itemMeta(item);
  if (metaText) {
    const meta = document.createElement("p");
    meta.className = "reader-meta";
    meta.textContent = metaText;
    article.appendChild(meta);
  }

  const content = document.createElement("div");
  content.className = "reader-body";
  content.appendChild(sanitizeFeedHtml(item.html, { base: item.link || siteUrl, loadImages: getLoadFeedImages() }));
  if (item.isExcerpt) stripTrailingReadMore(content);
  article.appendChild(content);

  if (item.isExcerpt) {
    const note = document.createElement("p");
    note.className = "reader-excerpt-note";
    note.textContent = "This feed only includes a preview of the post.";
    article.appendChild(note);
  }

  if (link) {
    const out = document.createElement("a");
    out.className = "card-detail-link reader-out-link";
    out.href = link;
    out.target = "_blank";
    out.rel = "noopener noreferrer";
    const span = document.createElement("span");
    span.textContent = item.isExcerpt ? `Read the full post on ${hostnameFor(link)}` : `Open on ${hostnameFor(link)}`;
    out.append(span);
    out.insertAdjacentHTML("beforeend", ICON_EXTERNAL);
    article.appendChild(out);
  }

  body.replaceChildren(article);
  wireSaveButton(root, nav, { profile, feed, item, content, siteUrl });
}

// "Save as snippet" -- or, with text selected in the post, "Save quote":
// the excerpting move a commonplace book is for. The selection has to be
// captured on pointerdown, before the tap on the button itself collapses
// it (which mobile Safari does before the click event ever fires).
function wireSaveButton(root, nav, { profile, feed, item, content, siteUrl }) {
  const bar = root.querySelector("#reader-actions");
  const btn = root.querySelector("#reader-save-btn");
  bar.classList.remove("hidden");

  function selectedText() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return "";
    const range = sel.getRangeAt(0);
    if (!content.contains(range.commonAncestorContainer)) return "";
    return sel.toString().replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  const DEFAULT_LABEL = "Save as snippet";
  function updateLabel() {
    btn.textContent = selectedText() ? "Save quote" : DEFAULT_LABEL;
  }
  function onSelectionChange() {
    // The view's been replaced (navigated away) -- stop listening.
    if (!document.body.contains(content)) {
      document.removeEventListener("selectionchange", onSelectionChange);
      return;
    }
    updateLabel();
  }
  document.addEventListener("selectionchange", onSelectionChange);
  updateLabel();

  let captured = "";
  btn.addEventListener("pointerdown", () => {
    captured = selectedText();
  });
  // Desktop browsers clear the selection on mousedown of a button unless
  // that default is prevented.
  btn.addEventListener("mousedown", (e) => e.preventDefault());

  btn.addEventListener("click", () => {
    const quote = captured || selectedText();
    captured = "";
    const snippet = createEmptySnippet();
    snippet.url = item.link || siteUrl;
    snippet.siteName = feed.title || hostnameFor(snippet.url);
    if (quote) {
      snippet.type = "quote";
      snippet.content = quote;
      snippet.author = item.author || profile.name || "";
    } else {
      snippet.type = "link";
      snippet.content = item.title;
    }
    openSnippetEditor(nav, {
      snippet,
      isNew: true,
      presetProfileId: profile.id,
      // A link snippet picks up the post's preview image the same way a
      // pasted link does; a quote is about the words, so it doesn't.
      autoFetch: !quote,
      refresh: () => {
        btn.textContent = "Saved ✓";
        setTimeout(updateLabel, 1800);
      },
    });
  });
}
