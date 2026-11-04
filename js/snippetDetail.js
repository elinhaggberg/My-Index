import { getSnippet, getSnippets, deleteSnippet, exportSnippetData } from "./storage.js";
import { isExcerpt, isSource, findSource, findExcerpts, findSiblings, sourceTitle, pageLabel } from "./sources.js";
import { openSheet } from "./sheet.js";
import { shareOrDownload, filenameFor } from "./share.js";
import { safeLinkUrl, hostnameFor } from "./util.js";
import { typeFor } from "./snippetTypes.js";
import { COMPACT_CONTENT_THRESHOLD } from "./snippetCard.js";
import { openSnippetEditor } from "./snippetEditor.js";
import { renderTagRefChips, renderProfileRefChips } from "./refChips.js";
import { resolveImageSrc } from "./imageStore.js";

export async function openSnippetDetail(nav, snippetRef, refresh) {
  const snippet = (await getSnippet(snippetRef.id)) || snippetRef;
  const sheet = openSheet("tpl-snippet-detail");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const type = typeFor(snippet.type);
  const typeBadge = el.querySelector("#detail-type-badge");
  typeBadge.innerHTML = `${type.icon}<span>${type.label}</span>`;

  const img = el.querySelector("#detail-image");
  if (snippet.image) {
    img.alt = "";
    const src = await resolveImageSrc(snippet.image);
    if (src) {
      img.src = src;
      img.classList.remove("hidden");
    }
  }

  const titleEl = el.querySelector("#detail-title");
  if (type.hasTitle) {
    titleEl.textContent = snippet.title || (snippet.url ? hostnameFor(snippet.url) : "Untitled");
    if (snippet.content) {
      const bodyEl = el.querySelector("#detail-body");
      bodyEl.textContent = snippet.content;
      if (snippet.content.length > COMPACT_CONTENT_THRESHOLD) bodyEl.classList.add("card-detail-title-compact");
      bodyEl.classList.remove("hidden");
    }
  } else {
    titleEl.textContent = snippet.content || (snippet.url ? hostnameFor(snippet.url) : "Untitled");
    if (type.long) {
      titleEl.classList.add("card-detail-title-long");
      if ((snippet.content || "").length > COMPACT_CONTENT_THRESHOLD) titleEl.classList.add("card-detail-title-compact");
    }
  }

  const page = isExcerpt(snippet) ? pageLabel(snippet.page) : "";
  if ((type.hasAuthor && snippet.author) || page) {
    const authorEl = el.querySelector("#detail-author");
    authorEl.textContent = [type.hasAuthor && snippet.author ? `— ${snippet.author}` : "", page].filter(Boolean).join(", ");
    authorEl.classList.remove("hidden");
  }

  const linkEl = el.querySelector("#detail-link");
  if (safeLinkUrl(snippet.url)) {
    linkEl.href = safeLinkUrl(snippet.url);
    el.querySelector("#detail-link-text").textContent = snippet.siteName || hostnameFor(snippet.url);
    linkEl.classList.remove("hidden");
  }

  const commentEl = el.querySelector("#detail-comment");
  if (snippet.comment) {
    commentEl.textContent = snippet.comment;
    commentEl.classList.remove("hidden");
  }

  // ---- Source and excerpts (js/sources.js) ----
  // Opening another snippet from here swaps this sheet for that one's.
  const openOther = (other) => {
    sheet.close();
    openSnippetDetail(nav, other, refresh);
  };
  const all = await getSnippets();
  if (isExcerpt(snippet)) {
    const source = findSource(snippet, all);
    if (source) {
      el.querySelector("#detail-source").replaceChildren(sourceRow(source, () => openOther(source)));
      el.querySelector("#detail-source-section").classList.remove("hidden");
    }
    const siblings = findSiblings(snippet, all);
    if (siblings.length) {
      el.querySelector("#detail-excerpts-label").textContent = `${siblings.length} more from ${source ? "this source" : "this page"}`;
      el.querySelector("#detail-excerpts").replaceChildren(...siblings.map((s) => excerptRow(s, () => openOther(s))));
      el.querySelector("#detail-excerpts-section").classList.remove("hidden");
    }
  } else if (isSource(snippet)) {
    const excerpts = findExcerpts(snippet, all);
    if (excerpts.length) {
      el.querySelector("#detail-excerpts-label").textContent = `Excerpts (${excerpts.length})`;
      el.querySelector("#detail-excerpts").replaceChildren(...excerpts.map((s) => excerptRow(s, () => openOther(s))));
      el.querySelector("#detail-excerpts-section").classList.remove("hidden");
    }
  }

  const tagsSection = el.querySelector("#detail-tags-section");
  if (snippet.tagIds?.length) {
    await renderTagRefChips(el.querySelector("#detail-tag-chips"), snippet.tagIds, nav, () => sheet.close());
    tagsSection.classList.remove("hidden");
  }

  const profilesSection = el.querySelector("#detail-profiles-section");
  if (snippet.profileIds?.length) {
    await renderProfileRefChips(el.querySelector("#detail-profile-chips"), snippet.profileIds, nav, () => sheet.close());
    profilesSection.classList.remove("hidden");
  }

  el.querySelector("#detail-edit-btn").addEventListener("click", () => {
    sheet.close();
    openSnippetEditor(nav, { snippet, isNew: false, refresh });
  });

  el.querySelector("#detail-share-btn").addEventListener("click", async () => {
    const data = await exportSnippetData(snippet);
    await shareOrDownload(filenameFor(snippet.content || snippet.siteName), JSON.stringify(data, null, 2));
  });

  el.querySelector("#detail-delete-btn").addEventListener("click", () => {
    const confirmSheet = openSheet("tpl-confirm-delete");
    confirmSheet.el.querySelector(".confirm-message").textContent = "Delete this snippet? This can't be undone.";
    confirmSheet.el.querySelector(".cancel-btn").addEventListener("click", () => confirmSheet.close());
    confirmSheet.el.querySelector(".confirm-btn").addEventListener("click", async () => {
      await deleteSnippet(snippet.id);
      confirmSheet.close();
      sheet.close();
      refresh();
    });
  });
}

function sourceRow(source, onOpen) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "detail-source-row";
  row.innerHTML = typeFor(source.type).icon;
  const text = document.createElement("span");
  text.className = "detail-source-text";
  const title = document.createElement("span");
  title.className = "detail-source-title";
  title.textContent = sourceTitle(source);
  const meta = document.createElement("span");
  meta.className = "detail-source-meta";
  meta.textContent = [typeFor(source.type).label, source.author, source.siteName].filter(Boolean).join(" · ");
  text.append(title, meta);
  row.appendChild(text);
  row.addEventListener("click", onOpen);
  return row;
}

function excerptRow(excerpt, onOpen) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "excerpt-row";
  const page = document.createElement("span");
  page.className = "excerpt-row-page";
  page.textContent = pageLabel(excerpt.page);
  const text = document.createElement("span");
  text.className = "excerpt-row-text";
  const body = (excerpt.content || excerpt.title || "").replace(/\s+/g, " ").trim();
  text.textContent = body.length > 180 ? body.slice(0, 180).replace(/\s+\S*$/, "") + "…" : body;
  row.append(page, text);
  row.addEventListener("click", onOpen);
  return row;
}
