import { createEmptySnippet, saveSnippet } from "./storage.js";
import { openSheet } from "./sheet.js";
import { renderTagChips } from "./tagChips.js";
import { SNIPPET_TYPES, typeFor } from "./snippetTypes.js";
import { hostnameFor } from "./util.js";

// Linking a Snippet to a Profile only happens from that Profile's own "add
// snippet" button (presetProfileId, applied silently below) -- picking
// profiles here in the capture flow read as confusing next to Tags, so
// there's no "Profiles" section in this editor at all. To link an existing
// snippet to a profile later, add it from the Profile page.
export function openSnippetEditor(nav, { snippet, isNew, refresh, presetProfileId, presetTagId, autoFetch }) {
  const draft = { ...snippet, tagIds: [...(snippet.tagIds || [])], profileIds: [...(snippet.profileIds || [])] };
  if (presetProfileId && !draft.profileIds.includes(presetProfileId)) draft.profileIds.push(presetProfileId);
  if (presetTagId && presetTagId !== "uncategorized" && !draft.tagIds.includes(presetTagId)) draft.tagIds.push(presetTagId);

  const sheet = openSheet("tpl-snippet-editor");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
  el.querySelector("#editor-heading").textContent = isNew ? "Save something" : "Edit";

  const saveErrorEl = el.querySelector("#editor-save-error");
  el.querySelector("#editor-save-btn").addEventListener("click", async () => {
    const finalSnippet = {
      ...draft,
      content: draft.content?.trim() || "",
    };
    try {
      await saveSnippet(finalSnippet);
    } catch {
      saveErrorEl.textContent = "Couldn't save. Please try again.";
      saveErrorEl.classList.remove("hidden");
      return;
    }
    sheet.close();
    refresh();
  });

  // ---- Type ----
  const typeRow = el.querySelector("#editor-type-segmented");
  const contentInput = el.querySelector("#editor-content");
  function renderContentField() {
    const type = typeFor(draft.type);
    contentInput.placeholder = type.contentPlaceholder;
    contentInput.rows = type.long ? 5 : 2;
  }
  typeRow.replaceChildren(
    ...SNIPPET_TYPES.map((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "type-chip" + (draft.type === t.id ? " active" : "");
      btn.innerHTML = `${t.icon}<span>${t.label}</span>`;
      btn.addEventListener("click", () => {
        draft.type = t.id;
        typeRow.querySelectorAll(".type-chip").forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        renderContentField();
      });
      return btn;
    })
  );
  renderContentField();

  contentInput.value = draft.content || "";
  contentInput.addEventListener("input", () => {
    draft.content = contentInput.value;
  });

  // ---- Link + fetch ----
  const urlInput = el.querySelector("#editor-url-input");
  urlInput.value = draft.url || "";
  urlInput.addEventListener("input", () => {
    draft.url = urlInput.value.trim();
  });

  const imgPreviewWrap = el.querySelector("#editor-image-preview-wrap");
  const imgPreview = el.querySelector("#editor-image-preview");
  const imgClearBtn = el.querySelector("#editor-image-clear-btn");
  function renderImagePreview() {
    if (draft.image) {
      imgPreview.src = draft.image;
      imgPreviewWrap.classList.remove("hidden");
    } else {
      imgPreviewWrap.classList.add("hidden");
    }
  }
  renderImagePreview();
  imgClearBtn.addEventListener("click", () => {
    draft.image = "";
    renderImagePreview();
  });

  const fetchBtn = el.querySelector("#editor-fetch-btn");
  const msgEl = el.querySelector("#editor-fetch-message");
  async function runFetch() {
    const url = urlInput.value.trim();
    if (!url) return;
    msgEl.classList.remove("error", "hidden");
    msgEl.textContent = "Fetching…";
    fetchBtn.disabled = true;
    try {
      const res = await fetch(`/api/unfurl?url=${encodeURIComponent(url)}`);
      const data = await res.json();
      draft.url = url;
      if (data.title && !draft.content) {
        draft.content = data.title;
        contentInput.value = draft.content;
      }
      if (data.image) draft.image = data.image;
      draft.siteName = data.siteName || hostnameFor(url);
      renderImagePreview();
      if (data.error) {
        msgEl.textContent = `${data.error} You can still fill in the details yourself.`;
        msgEl.classList.add("error");
      } else if (data.notice) {
        msgEl.textContent = data.notice;
      } else {
        msgEl.textContent = "Got it — details filled in below.";
      }
    } catch {
      msgEl.textContent = "Couldn't fetch that link. You can still fill in the details yourself.";
      msgEl.classList.add("error");
    } finally {
      fetchBtn.disabled = false;
    }
  }
  fetchBtn.addEventListener("click", runFetch);
  // Lets an incoming share (from the iOS Shortcut capture flow — see app.js)
  // skip straight to "fetching" instead of making you tap Fetch yourself
  // right after sharing a link into the app.
  if (autoFetch && draft.url) runFetch();

  // ---- Comment ----
  const commentInput = el.querySelector("#editor-comment");
  commentInput.value = draft.comment || "";
  commentInput.addEventListener("input", () => {
    draft.comment = commentInput.value;
  });

  // ---- Tags ----
  renderTagChips(el.querySelector("#editor-tag-chips"), {
    selectedIds: draft.tagIds,
    onToggle: (tagId) => {
      const idx = draft.tagIds.indexOf(tagId);
      if (idx >= 0) draft.tagIds.splice(idx, 1);
      else draft.tagIds.push(tagId);
    },
  });
}
