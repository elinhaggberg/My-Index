import {
  getTag,
  getProfilesForTag,
  getSnippetsForTag,
  saveTagPinnedNote,
  createEmptySnippet,
  UNCATEGORIZED_TAG_ID,
} from "../storage.js";
import { renderMasonry } from "../masonry.js";
import { createSnippetNode } from "../snippetCard.js";
import { createProfileTileNode } from "../profileTile.js";
import { openSnippetDetail } from "../snippetDetail.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { openSheet } from "../sheet.js";

export async function renderTag(root, nav, id) {
  const tpl = document.getElementById("tpl-tag");
  root.replaceChildren(tpl.content.cloneNode(true));

  root.querySelector(".back-btn").addEventListener("click", () => nav.toTags());

  async function load() {
    const tag = await getTag(id);
    if (!tag) {
      nav.toTags();
      return;
    }

    document.getElementById("tag-title").textContent = tag.name;

    const pinBtn = document.getElementById("tag-pin-btn");
    const pinnedEl = document.getElementById("tag-pinned-note");
    if (tag.isSystem) {
      pinBtn.classList.add("hidden");
      pinnedEl.classList.add("hidden");
    } else {
      pinBtn.classList.remove("hidden");
      pinBtn.onclick = () => openPinnedNoteEditor(tag, load);
      if (tag.pinnedNote) {
        pinnedEl.textContent = tag.pinnedNote;
        pinnedEl.classList.remove("hidden");
      } else {
        pinnedEl.classList.add("hidden");
      }
    }

    const profileRow = document.getElementById("tag-profile-row");
    const profiles = tag.isSystem ? [] : await getProfilesForTag(id);
    if (profiles.length === 0) {
      profileRow.classList.add("hidden");
    } else {
      profileRow.classList.remove("hidden");
      profileRow.replaceChildren(...profiles.map((p) => createProfileTileNode(p, (profile) => nav.toProfile(profile.id))));
    }

    const grid = document.getElementById("tag-snippets-grid");
    const snippets = await getSnippetsForTag(id);
    if (snippets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "Nothing here yet.";
      grid.replaceChildren(empty);
    } else {
      renderMasonry(grid, snippets, (snippet) => createSnippetNode(snippet, (s) => openSnippetDetail(nav, s, load)));
    }

    document.getElementById("tag-add-snippet-btn").onclick = () => {
      openSnippetEditor(nav, {
        snippet: createEmptySnippet(),
        isNew: true,
        refresh: load,
        presetTagId: id === UNCATEGORIZED_TAG_ID ? null : id,
      });
    };
  }

  await load();
}

function openPinnedNoteEditor(tag, refresh) {
  const sheet = openSheet("tpl-tag-pinned-editor");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
  const textarea = el.querySelector("#tag-pinned-note-input");
  textarea.value = tag.pinnedNote || "";
  el.querySelector("#tag-pinned-note-save-btn").addEventListener("click", async () => {
    await saveTagPinnedNote(tag.id, textarea.value.trim());
    sheet.close();
    refresh();
  });
}
