import { getSnippet, deleteSnippet, exportSnippetData } from "./storage.js";
import { openSheet } from "./sheet.js";
import { shareOrDownload, filenameFor } from "./share.js";
import { hostnameFor } from "./util.js";
import { typeFor } from "./snippetTypes.js";
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

  el.querySelector("#detail-title").textContent = snippet.content || (snippet.url ? hostnameFor(snippet.url) : "Untitled");

  const linkEl = el.querySelector("#detail-link");
  if (snippet.url) {
    linkEl.href = snippet.url;
    el.querySelector("#detail-link-text").textContent = snippet.siteName || hostnameFor(snippet.url);
    linkEl.classList.remove("hidden");
  }

  const commentEl = el.querySelector("#detail-comment");
  if (snippet.comment) {
    commentEl.textContent = snippet.comment;
    commentEl.classList.remove("hidden");
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
