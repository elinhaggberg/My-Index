import {
  getTag,
  getProfilesForTag,
  getSnippetsForTag,
  saveTagDetails,
  deleteTag,
  createEmptySnippet,
  UNCATEGORIZED_TAG_ID,
} from "../storage.js";
import { renderMasonry } from "../masonry.js";
import { createSnippetNode } from "../snippetCard.js";
import { createProfileTileNode } from "../profileTile.js";
import { openSnippetDetail } from "../snippetDetail.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { openSheet } from "../sheet.js";
import { readAndResizeImage } from "../imageBlob.js";
import { resolveImageSrc } from "../imageStore.js";
import { ICON_TAG } from "../icons.js";

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

    const coverEl = document.getElementById("tag-cover-image");
    if (tag.image) {
      coverEl.style.backgroundImage = `url("${await resolveImageSrc(tag.image)}")`;
      coverEl.classList.remove("hidden");
    } else {
      coverEl.classList.add("hidden");
    }

    const pinBtn = document.getElementById("tag-pin-btn");
    const deleteBtn = document.getElementById("tag-delete-btn");
    const pinnedEl = document.getElementById("tag-pinned-note");
    if (tag.isSystem) {
      pinBtn.classList.add("hidden");
      deleteBtn.classList.add("hidden");
      pinnedEl.classList.add("hidden");
    } else {
      pinBtn.classList.remove("hidden");
      pinBtn.onclick = () => openTagEditor(tag, load);
      deleteBtn.classList.remove("hidden");
      deleteBtn.onclick = () => confirmDeleteTag(tag, nav);
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

// Only removes the tag itself -- any Profile or Snippet that had it just
// loses that one tag (falling back to Uncategorized if it was their only
// one), same as deleteTag's cascade in storage.js. Nothing referencing it
// is ever deleted outright, so this is safe to use to clean up an empty or
// unused tag.
function confirmDeleteTag(tag, nav) {
  const confirmSheet = openSheet("tpl-confirm-delete");
  confirmSheet.el.querySelector(".confirm-message").textContent =
    `Delete "${tag.name}"? Profiles and Snippets keep their other tags -- this only removes the tag itself. This can't be undone.`;
  confirmSheet.el.querySelector(".cancel-btn").addEventListener("click", () => confirmSheet.close());
  confirmSheet.el.querySelector(".confirm-btn").addEventListener("click", async () => {
    await deleteTag(tag.id);
    confirmSheet.close();
    nav.toTags();
  });
}

function openTagEditor(tag, refresh) {
  const sheet = openSheet("tpl-tag-editor");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  let image = tag.image || null;
  const coverImg = el.querySelector("#tag-editor-cover-img");
  const coverPlaceholder = el.querySelector("#tag-editor-cover-placeholder");
  const clearBtn = el.querySelector("#tag-editor-cover-clear-btn");
  coverPlaceholder.innerHTML = ICON_TAG;

  function renderCover() {
    if (image) {
      resolveImageSrc(image).then((src) => {
        if (src) coverImg.src = src;
      });
      coverImg.classList.remove("hidden");
      coverPlaceholder.classList.add("hidden");
      clearBtn.classList.remove("hidden");
    } else {
      coverImg.classList.add("hidden");
      coverPlaceholder.classList.remove("hidden");
      clearBtn.classList.add("hidden");
    }
  }
  renderCover();

  const cameraInput = el.querySelector("#tag-editor-cover-camera-input");
  const libraryInput = el.querySelector("#tag-editor-cover-library-input");
  el.querySelector("#tag-editor-cover-camera-btn").addEventListener("click", () => cameraInput.click());
  el.querySelector("#tag-editor-cover-library-btn").addEventListener("click", () => libraryInput.click());
  async function handleFile(input) {
    const file = input.files[0];
    if (!file) return;
    try {
      image = await readAndResizeImage(file);
      renderCover();
    } catch {
      // Unreadable file -- leave the picker as-is so they can retry.
    }
  }
  cameraInput.addEventListener("change", () => handleFile(cameraInput));
  libraryInput.addEventListener("change", () => handleFile(libraryInput));
  clearBtn.addEventListener("click", () => {
    image = null;
    renderCover();
  });

  const nameInput = el.querySelector("#tag-editor-name");
  nameInput.value = tag.name;
  const noteInput = el.querySelector("#tag-editor-pinned-note");
  noteInput.value = tag.pinnedNote || "";

  const errorEl = el.querySelector("#tag-editor-save-error");
  el.querySelector("#tag-editor-save-btn").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      errorEl.textContent = "Give this tag a name.";
      errorEl.classList.remove("hidden");
      return;
    }
    await saveTagDetails(tag.id, { name, pinnedNote: noteInput.value.trim(), image });
    sheet.close();
    refresh();
  });
}
