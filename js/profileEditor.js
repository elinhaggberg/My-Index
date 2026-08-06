import { saveProfile, deleteProfile, createEmptyChannel } from "./storage.js";
import { openSheet } from "./sheet.js";
import { renderTagChips } from "./tagChips.js";
import { ICON_CLOSE_SMALL } from "./icons.js";
import { syncProfileChannels, unsubscribeChannel } from "./feedSync.js";
import { readAndResizeImage } from "./imageBlob.js";
import { resolveImageSrc } from "./imageStore.js";
import { CHANNEL_TYPES, CHANNEL_TYPE_LABELS } from "./channelTypes.js";
import { discoverFeed } from "./discoverFeed.js";

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
      resolveImageSrc(draft.image).then((src) => {
        if (src) avatarImg.src = src;
      });
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
  // Auto-discovery status per channel is transient UI state, never something
  // that belongs on the channel object itself (which gets spread verbatim
  // into what's actually saved) -- keeping it out-of-band here means the
  // save-time mapping never needs to know to strip it back out.
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

        const urlInput = document.createElement("input");
        urlInput.type = "url";
        urlInput.placeholder = "https://…";
        urlInput.autocomplete = "off";
        urlInput.value = channel.url || "";
        urlInput.addEventListener("input", () => {
          channel.url = urlInput.value;
        });

        // ---- RSS: auto-discovered on leaving the url field, manual field
        // as the fallback (and override) ----
        const checkingEl = document.createElement("p");
        checkingEl.className = "channel-rss-checking hidden";
        checkingEl.textContent = "Checking for an RSS feed…";

        const foundEl = document.createElement("p");
        foundEl.className = "channel-rss-found hidden";
        const foundChangeBtn = document.createElement("button");
        foundChangeBtn.type = "button";
        foundChangeBtn.className = "channel-rss-change-btn";
        foundChangeBtn.textContent = "Change";
        foundEl.append("✓ RSS feed found automatically ", foundChangeBtn);

        const manualBlock = document.createElement("div");
        manualBlock.className = "channel-rss-manual";

        const rssInput = document.createElement("input");
        rssInput.type = "url";
        rssInput.placeholder = "RSS feed URL (optional)";
        rssInput.autocomplete = "off";
        rssInput.value = channel.rssUrl || "";

        const manualMsgEl = document.createElement("p");
        manualMsgEl.className = "channel-rss-manual-msg hidden";

        function showChecking() {
          checkingEl.classList.remove("hidden");
          foundEl.classList.add("hidden");
          manualBlock.classList.add("hidden");
        }
        function showFound() {
          checkingEl.classList.add("hidden");
          foundEl.classList.remove("hidden");
          manualBlock.classList.add("hidden");
        }
        function showManual(value, hint) {
          checkingEl.classList.add("hidden");
          foundEl.classList.add("hidden");
          manualBlock.classList.remove("hidden");
          rssInput.value = value ?? channel.rssUrl ?? "";
          if (hint) {
            manualMsgEl.textContent = hint;
            manualMsgEl.classList.remove("hidden", "error");
          } else {
            manualMsgEl.classList.add("hidden");
          }
        }
        // Substack accounts that only ever post from their substack.com/@handle
        // page, without setting up an actual publication, have no separate
        // site and so no RSS feed to find -- worth explaining, since
        // otherwise this looks identical to "couldn't find one" for any
        // other reason and just as confusing as hitting it in the first
        // place (see js/discoverFeed.js's api/discover-feed.js, which is
        // what detects this shape and reports it back as `reason`).
        function hintFor(result) {
          if (result.reason === "substack-app-only") {
            return "This looks like a Substack account without its own publication (just posts made from the profile page) — those don't have an RSS feed. If they do have a separate publication, try that page's own address instead.";
          }
          return "";
        }
        // Neither found nor showing the manual field yet -- nothing's been
        // checked (a brand-new empty channel), so there's nothing to render
        // beyond the plain manual field, same as before auto-discovery
        // existed.
        if (channel.rssUrl) showFound();
        else showManual("");

        urlInput.addEventListener("blur", async () => {
          const url = urlInput.value.trim();
          // Only auto-runs for a channel that doesn't already have an RSS
          // url -- an existing one (auto-found or typed by hand) is left
          // alone rather than silently overwritten if the page url changes;
          // clearing the RSS field first re-opens the door to a fresh check.
          if (!url || channel.rssUrl) return;
          showChecking();
          const result = await discoverFeed(url);
          channel.rssUrl = result.ok ? result.feedUrl : "";
          if (result.ok) showFound();
          else showManual("", hintFor(result));
        });

        foundChangeBtn.addEventListener("click", () => showManual(channel.rssUrl));

        rssInput.addEventListener("input", () => {
          channel.rssUrl = rssInput.value;
        });
        rssInput.addEventListener("blur", async () => {
          const value = rssInput.value.trim();
          channel.rssUrl = value;
          manualMsgEl.classList.add("hidden");
          if (!value) return;
          manualMsgEl.textContent = "Checking…";
          manualMsgEl.classList.remove("hidden", "error");
          const result = await discoverFeed(value);
          if (result.ok) {
            channel.rssUrl = result.feedUrl;
            rssInput.value = result.feedUrl;
            manualMsgEl.textContent = "✓ Working RSS feed.";
            manualMsgEl.classList.remove("error");
          } else {
            manualMsgEl.textContent = hintFor(result) || "Couldn't verify this as an RSS feed — saved as entered anyway.";
            manualMsgEl.classList.add("error");
          }
        });

        manualBlock.append(rssInput, manualMsgEl);
        row.append(topRow, urlInput, checkingEl, foundEl, manualBlock);
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

  // ---- Delete (existing profiles only) -- Share moved to the Profile
  // preview page itself (js/views/profile.js), not this editor sheet.
  const deleteBtn = el.querySelector("#profile-editor-delete-btn");
  if (isNew) {
    deleteBtn.classList.add("hidden");
  } else {
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
