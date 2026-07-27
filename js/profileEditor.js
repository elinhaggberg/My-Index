import { saveProfile, deleteProfile, createEmptyChannel, exportProfileData } from "./storage.js";
import { openSheet } from "./sheet.js";
import { renderTagChips } from "./tagChips.js";
import { shareOrDownload, filenameFor } from "./share.js";
import { ICON_CLOSE_SMALL } from "./icons.js";
import { syncProfileChannels, unsubscribeChannel } from "./feedSync.js";
import { readAndResizeImage, resolveImageUrl } from "./imageBlob.js";
import { CHANNEL_TYPES, CHANNEL_TYPE_LABELS } from "./channelTypes.js";

export function openProfileEditor(nav, { profile, isNew, refresh, onDeleted }) {
  const draft = {
    ...profile,
    tagIds: [...(profile.tagIds || [])],
    channels: (profile.channels || []).map((c) => ({ ...c })),
  };

  const sheet = openSheet("tpl-profile-editor");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
  el.querySelector("#profile-editor-heading").textContent = isNew ? "New profile" : "Edit profile";

  const saveErrorEl = el.querySelector("#profile-editor-save-error");
  el.querySelector("#profile-editor-save-btn").addEventListener("click", async () => {
    const name = nameInput.value.trim();
    if (!name) {
      saveErrorEl.textContent = "Give this profile a name first.";
      saveErrorEl.classList.remove("hidden");
      return;
    }
    const finalProfile = {
      ...draft,
      name,
      note: noteInput.value.trim(),
      channels: draft.channels.filter((c) => c.url.trim()).map((c) => ({ ...c, url: c.url.trim(), rssUrl: c.rssUrl.trim() })),
    };
    try {
      await saveProfile(finalProfile);
    } catch {
      saveErrorEl.textContent = "Couldn't save. Please try again.";
      saveErrorEl.classList.remove("hidden");
      return;
    }
    // Best-effort and inert unless the optional backend is configured (see
    // supabase/SETUP.md) -- never blocks or fails the save above.
    syncProfileChannels(finalProfile.id, profile.channels || [], finalProfile.channels);
    sheet.close();
    refresh(finalProfile);
  });

  // ---- Avatar ----
  const avatarImg = el.querySelector("#profile-editor-avatar-img");
  const avatarInitial = el.querySelector("#profile-editor-avatar-initial");
  const avatarClearBtn = el.querySelector("#profile-editor-avatar-clear-btn");
  function renderAvatar() {
    if (draft.image) {
      avatarImg.src = resolveImageUrl(draft.image);
      avatarImg.classList.remove("hidden");
      avatarInitial.classList.add("hidden");
      avatarClearBtn.classList.remove("hidden");
    } else {
      avatarImg.classList.add("hidden");
      avatarInitial.textContent = (nameInput.value || "?").trim().charAt(0).toUpperCase() || "?";
      avatarInitial.classList.remove("hidden");
      avatarClearBtn.classList.add("hidden");
    }
  }

  const avatarCameraInput = el.querySelector("#profile-editor-avatar-camera-input");
  const avatarLibraryInput = el.querySelector("#profile-editor-avatar-library-input");
  el.querySelector("#profile-editor-avatar-camera-btn").addEventListener("click", () => avatarCameraInput.click());
  el.querySelector("#profile-editor-avatar-library-btn").addEventListener("click", () => avatarLibraryInput.click());
  async function handleAvatarFile(input) {
    const file = input.files[0];
    if (!file) return;
    try {
      draft.image = await readAndResizeImage(file);
      renderAvatar();
    } catch {
      // Unreadable file -- leave the picker as-is so they can retry.
    }
  }
  avatarCameraInput.addEventListener("change", () => handleAvatarFile(avatarCameraInput));
  avatarLibraryInput.addEventListener("change", () => handleAvatarFile(avatarLibraryInput));
  avatarClearBtn.addEventListener("click", () => {
    draft.image = null;
    renderAvatar();
  });

  const nameInput = el.querySelector("#profile-editor-name");
  nameInput.value = draft.name || "";
  nameInput.addEventListener("input", () => {
    if (!draft.image) renderAvatar();
  });
  renderAvatar();

  const noteInput = el.querySelector("#profile-editor-note");
  noteInput.value = draft.note || "";

  // ---- Channels ----
  const channelsEl = el.querySelector("#profile-editor-channels");
  function renderChannels() {
    channelsEl.replaceChildren(
      ...draft.channels.map((channel, i) => {
        const row = document.createElement("div");
        row.className = "channel-row";

        const select = document.createElement("select");
        CHANNEL_TYPES.forEach((t) => {
          const opt = document.createElement("option");
          opt.value = t;
          opt.textContent = CHANNEL_TYPE_LABELS[t];
          if (channel.type === t) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener("change", () => {
          channel.type = select.value;
        });

        const urlInput = document.createElement("input");
        urlInput.type = "url";
        urlInput.placeholder = "https://…";
        urlInput.autocomplete = "off";
        urlInput.value = channel.url || "";
        urlInput.addEventListener("input", () => {
          channel.url = urlInput.value;
        });

        const rssInput = document.createElement("input");
        rssInput.type = "url";
        rssInput.placeholder = "RSS feed URL (optional)";
        rssInput.autocomplete = "off";
        rssInput.value = channel.rssUrl || "";
        rssInput.addEventListener("input", () => {
          channel.rssUrl = rssInput.value;
        });

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.className = "icon-btn channel-remove-btn";
        removeBtn.setAttribute("aria-label", "Remove channel");
        removeBtn.innerHTML = ICON_CLOSE_SMALL;
        removeBtn.addEventListener("click", () => {
          draft.channels.splice(i, 1);
          renderChannels();
        });

        const topRow = document.createElement("div");
        topRow.className = "channel-row-top";
        topRow.append(select, removeBtn);
        row.append(topRow, urlInput, rssInput);
        return row;
      })
    );
  }
  renderChannels();

  el.querySelector("#profile-editor-add-channel-btn").addEventListener("click", () => {
    draft.channels.push(createEmptyChannel());
    renderChannels();
  });

  // ---- Tags ----
  renderTagChips(el.querySelector("#profile-editor-tag-chips"), {
    selectedIds: draft.tagIds,
    onToggle: (tagId) => {
      const idx = draft.tagIds.indexOf(tagId);
      if (idx >= 0) draft.tagIds.splice(idx, 1);
      else draft.tagIds.push(tagId);
    },
  });

  // ---- Share / delete (existing profiles only) ----
  const shareBtn = el.querySelector("#profile-editor-share-btn");
  const deleteBtn = el.querySelector("#profile-editor-delete-btn");
  if (isNew) {
    shareBtn.classList.add("hidden");
    deleteBtn.classList.add("hidden");
  } else {
    shareBtn.addEventListener("click", async () => {
      const data = await exportProfileData(draft);
      await shareOrDownload(filenameFor(draft.name), JSON.stringify(data, null, 2));
    });
    deleteBtn.addEventListener("click", () => {
      const confirmSheet = openSheet("tpl-confirm-delete");
      confirmSheet.el.querySelector(".confirm-message").textContent = `Delete "${draft.name || "this profile"}"? Its snippets stay, unlinked. This can't be undone.`;
      confirmSheet.el.querySelector(".cancel-btn").addEventListener("click", () => confirmSheet.close());
      confirmSheet.el.querySelector(".confirm-btn").addEventListener("click", async () => {
        await deleteProfile(draft.id);
        for (const channel of draft.channels) unsubscribeChannel(channel.id);
        confirmSheet.close();
        sheet.close();
        if (onDeleted) onDeleted();
      });
    });
  }
}
