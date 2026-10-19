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

import {
  getProfile,
  clearChannelNewCount,
  createEmptySnippet,
  getLoadFeedImages,
  getReaderTextSize,
  setReaderTextSize,
} from "../storage.js";
import { resolveImageSrc } from "../imageStore.js";
import { clearChannelServerCount } from "../feedSync.js";
import { opensInReader } from "../channelTypes.js";
import { loadFeed } from "../feedLoader.js";
import { sanitizeFeedHtml, stripTrailingReadMore, revealImages } from "../feedSanitize.js";
import { getUnreadIds, markSeen, markNoticed, getAlwaysImages, setAlwaysImages } from "../feedState.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { formatDate, hostnameFor } from "../util.js";
import { ICON_EXTERNAL, ICON_IMAGE } from "../icons.js";

// channelId -> where the post list was scrolled to, so coming back from a
// post lands where you left off.
const listScroll = new Map();

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
    feed = await loadFeed(channel.rssUrl);
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
    await renderItem(root, nav, { profile, channel, feed, item, siteUrl, listHash });
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
  // Everything in the list has now been seen in passing, so the next
  // on-open check won't count it as new again -- unread dots stay until
  // each post is actually opened.
  markNoticed(channel.id, feed.items.map((item) => item.id));

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
      listScroll.set(channel.id, window.scrollY);
      location.hash = `${listHash}/${encodeURIComponent(item.id)}`;
    });
    list.appendChild(row);
  }

  body.replaceChildren(header, list);
  const scrollY = listScroll.get(channel.id);
  if (scrollY) window.scrollTo(0, scrollY);
}

// Average adult silent reading speed is ~230-260 words a minute; the lower
// end, since a post read on a phone is rarely skimmed at full speed.
const WORDS_PER_MINUTE = 230;

function readingMinutes(text) {
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
}

async function createByline(profile, item) {
  const byline = document.createElement("div");
  byline.className = "reader-byline";

  // The Profile's own photo from My Index, rather than the platform's --
  // it's already stored on the device, so it costs no outside request, and
  // it ties the post back to the person you chose to follow.
  const avatar = document.createElement("span");
  avatar.className = "reader-avatar";
  const src = profile.image ? await resolveImageSrc(profile.image).catch(() => "") : "";
  if (src) {
    avatar.style.backgroundImage = `url("${src}")`;
    avatar.classList.add("has-image");
  } else {
    avatar.textContent = (profile.name || "?").trim().charAt(0).toUpperCase() || "?";
  }

  const text = document.createElement("span");
  text.className = "reader-byline-text";
  const name = document.createElement("span");
  name.className = "reader-byline-name";
  name.textContent = item.author || profile.name || "";
  const meta = document.createElement("span");
  meta.className = "reader-byline-meta";
  meta.dataset.date = item.date ? formatDate(item.date) : "";
  text.append(name, meta);

  byline.append(avatar, text);
  return { byline, meta };
}

function createNextCard(nav, next, listHash) {
  const card = document.createElement("a");
  card.className = "reader-next";
  card.href = `${listHash}/${encodeURIComponent(next.id)}`;
  card.addEventListener("click", (e) => {
    e.preventDefault();
    nav.replace(card.getAttribute("href"));
  });
  const label = document.createElement("span");
  label.className = "reader-next-label";
  label.textContent = "Next post";
  const title = document.createElement("span");
  title.className = "reader-next-title";
  title.textContent = next.title;
  card.append(label, title);
  if (next.excerpt && next.excerpt !== next.title) {
    const excerpt = document.createElement("span");
    excerpt.className = "reader-next-excerpt";
    excerpt.textContent = next.excerpt;
    card.append(excerpt);
  }
  if (next.date) {
    const date = document.createElement("span");
    date.className = "reader-next-meta";
    date.textContent = formatDate(next.date);
    card.append(date);
  }
  return card;
}

// Text size ("Aa"): three steps, applied as a CSS custom property on the
// article so every size in the post scales together.
function wireTextSize(root, article) {
  const btn = root.querySelector("#reader-size-btn");
  const panel = root.querySelector("#reader-size-panel");
  btn.classList.remove("hidden");
  function apply(size) {
    article.dataset.textSize = size;
    panel.querySelectorAll("button").forEach((b) => b.classList.toggle("active", b.dataset.size === size));
  }
  apply(getReaderTextSize());
  function setOpen(open) {
    panel.classList.toggle("hidden", !open);
    btn.classList.toggle("active", open);
    btn.setAttribute("aria-expanded", String(open));
  }
  btn.addEventListener("click", () => setOpen(panel.classList.contains("hidden")));
  panel.querySelectorAll("button").forEach((b) =>
    b.addEventListener("click", () => {
      setReaderTextSize(b.dataset.size);
      apply(b.dataset.size);
    })
  );
  // Closes on any tap outside it, the way a popover should.
  function onDocClick(e) {
    if (!document.body.contains(panel)) {
      document.removeEventListener("click", onDocClick, true);
      return;
    }
    if (!panel.contains(e.target) && !btn.contains(e.target)) setOpen(false);
  }
  document.addEventListener("click", onDocClick, true);
}

// The thin progress line under the top bar, and the post's title fading
// into the bar once the big title has scrolled out of view.
function wireScrollChrome(root, article, title) {
  const topbar = root.querySelector("#feed-topbar");
  const progress = root.querySelector("#reader-progress");
  const bar = root.querySelector("#reader-progress-bar");
  progress.classList.remove("hidden");

  let frame = 0;
  function update() {
    frame = 0;
    if (!document.body.contains(article)) {
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      return;
    }
    const rect = article.getBoundingClientRect();
    const scrollable = rect.height - window.innerHeight + topbar.offsetHeight;
    const ratio = scrollable > 0 ? Math.min(1, Math.max(0, -rect.top / scrollable)) : 1;
    bar.style.transform = `scaleX(${ratio})`;
    const titleBottom = title.getBoundingClientRect().bottom;
    topbar.classList.toggle("show-post-title", titleBottom < topbar.getBoundingClientRect().bottom);
    topbar.classList.toggle("scrolled", window.scrollY > 4);
  }
  function onScroll() {
    if (!frame) frame = requestAnimationFrame(update);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  window.addEventListener("resize", onScroll, { passive: true });
  update();
}

function describeHosts(hosts) {
  if (hosts.length === 0) return "";
  if (hosts.length === 1) return ` from ${hosts[0]}`;
  if (hosts.length === 2) return ` from ${hosts[0]} and ${hosts[1]}`;
  return ` from ${hosts[0]} and ${hosts.length - 1} other sites`;
}

// Images are decided once per feed, at the moment it matters, rather than
// one tap per image or a single switch for everything: the first post
// with images asks, naming the site that would actually see the request
// (usually the platform's image server, not the writer), and "Always for
// <feed>" settles it for that feed from then on. Customize lists those
// feeds so the choice can be taken back.
function createImagePrompt(content, channel, feed, siteUrl) {
  const placeholders = [...content.querySelectorAll(".reader-img-placeholder")];
  if (placeholders.length === 0) return null;
  const hosts = [...new Set(placeholders.map((p) => p.dataset.host).filter(Boolean))];
  const count = placeholders.length;
  const feedName = feed.title || hostnameFor(siteUrl) || "this feed";

  const prompt = document.createElement("div");
  prompt.className = "reader-image-prompt";
  prompt.setAttribute("role", "note");
  prompt.insertAdjacentHTML("afterbegin", ICON_IMAGE);

  const text = document.createElement("div");
  text.className = "reader-image-prompt-text";
  const line = document.createElement("p");
  line.className = "reader-image-prompt-line";
  line.textContent = `This post has ${count === 1 ? "an image" : `${count} images`}${describeHosts(hosts)}.`;
  const why = document.createElement("p");
  why.className = "reader-image-prompt-why";
  why.textContent = `Showing ${count === 1 ? "it" : "them"} lets ${hosts.length > 1 ? "those sites" : "that site"} see that this device opened the post.`;

  const actions = document.createElement("div");
  actions.className = "reader-image-prompt-actions";
  const showBtn = document.createElement("button");
  showBtn.type = "button";
  showBtn.className = "text-btn secondary";
  showBtn.textContent = count === 1 ? "Show image" : "Show images";
  const alwaysBtn = document.createElement("button");
  alwaysBtn.type = "button";
  alwaysBtn.className = "text-btn primary reader-image-prompt-always";
  alwaysBtn.textContent = `Always for ${feedName}`;
  actions.append(showBtn, alwaysBtn);

  text.append(line, why, actions);
  prompt.append(text);

  // Set before revealing, so the reveal's own clicks on each placeholder
  // don't trip the "every image tapped in by hand" check below.
  let answered = false;
  showBtn.addEventListener("click", () => {
    answered = true;
    revealImages(content);
    prompt.remove();
  });
  alwaysBtn.addEventListener("click", async () => {
    answered = true;
    revealImages(content);
    await setAlwaysImages(channel.id, true);
    text.replaceChildren();
    const done = document.createElement("p");
    done.className = "reader-image-prompt-line";
    done.textContent = `Images will show automatically for ${feedName}. You can change this in Customize.`;
    text.append(done);
    prompt.classList.add("done");
    setTimeout(() => prompt.remove(), 4500);
  });
  // Tapping every image in one at a time also answers the question. Capture
  // phase, since a placeholder stops its own click from bubbling, and a
  // tick later, once that click has swapped the image in.
  content.addEventListener(
    "click",
    () =>
      setTimeout(() => {
        if (!answered && !content.querySelector(".reader-img-placeholder")) prompt.remove();
      }),
    true
  );
  return prompt;
}

async function renderItem(root, nav, { profile, channel, feed, item, siteUrl, listHash }) {
  const body = root.querySelector("#feed-body");
  const link = item.link || siteUrl;
  setOpenInBrowser(root, link);
  markSeen(channel.id, [item.id]);
  window.scrollTo(0, 0);
  root.querySelector("#feed-title-post").textContent = item.title;

  const article = document.createElement("article");
  article.className = "reader-article";
  if (feed.lang) article.lang = feed.lang;

  const header = document.createElement("header");
  header.className = "reader-header";
  if (feed.title) {
    const kicker = document.createElement("p");
    kicker.className = "reader-kicker";
    kicker.textContent = feed.title;
    header.appendChild(kicker);
  }
  const title = document.createElement("h2");
  title.className = "reader-title";
  title.textContent = item.title;
  header.appendChild(title);
  const { byline, meta } = await createByline(profile, item);
  header.appendChild(byline);
  article.appendChild(header);

  const content = document.createElement("div");
  content.className = "reader-body";
  const loadImages = getLoadFeedImages() || (await getAlwaysImages(channel.id));
  content.appendChild(sanitizeFeedHtml(item.html, { base: item.link || siteUrl, loadImages }));
  if (item.isExcerpt) stripTrailingReadMore(content);
  if (!loadImages) {
    const prompt = createImagePrompt(content, channel, feed, siteUrl);
    if (prompt) article.appendChild(prompt);
  }
  article.appendChild(content);

  const minutes = readingMinutes(content.textContent);
  meta.textContent = [meta.dataset.date, item.isExcerpt ? "" : `${minutes} min read`].filter(Boolean).join(" · ");

  const end = document.createElement("p");
  end.className = "reader-end";
  end.setAttribute("aria-hidden", "true");
  end.textContent = "· · ·";
  article.appendChild(end);

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

  // Feeds list newest first, so "next" reads on into the next-older post
  // -- the way you'd read on through a back catalogue.
  const index = feed.items.indexOf(item);
  const next = feed.items[index + 1];
  if (next) article.appendChild(createNextCard(nav, next, listHash));

  body.replaceChildren(article);
  wireTextSize(root, article);
  wireScrollChrome(root, article, title);
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
