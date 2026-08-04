import {
  getProfile,
  clearProfileNewCount,
  getSnippetsForProfile,
  exportProfileData,
} from "../storage.js";
import { renderMasonry } from "../masonry.js";
import { createSnippetNode } from "../snippetCard.js";
import { openSnippetDetail } from "../snippetDetail.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { createEmptySnippet } from "../storage.js";
import { openProfileEditor } from "../profileEditor.js";
import { renderTagRefChips } from "../refChips.js";
import { hostnameFor } from "../util.js";
import { ICON_EXTERNAL, ICON_RSS, ICON_SEARCH } from "../icons.js";
import { clearServerCounts } from "../feedSync.js";
import { resolveImageSrc } from "../imageStore.js";
import { shareOrDownload, filenameFor } from "../share.js";
import { CHANNEL_TYPE_LABELS } from "../channelTypes.js";

export async function renderProfile(root, nav, id) {
  const tpl = document.getElementById("tpl-profile");
  root.replaceChildren(tpl.content.cloneNode(true));

  root.querySelector(".back-btn").addEventListener("click", () => nav.toHome());

  async function load() {
    // Visiting the profile's page is what clears its badge, mirroring
    // "unread" mail behavior. The stored state is cleared immediately, but
    // clearProfileNewCount hands back the pre-clear per-channel counts for
    // this one render, so you can actually see which channel had something
    // new before the badge disappears on the next visit.
    const profile = await clearProfileNewCount(id);
    if (!profile) {
      nav.toHome();
      return;
    }
    // Best-effort and inert unless the optional backend is configured.
    clearServerCounts(id);

    document.getElementById("profile-title").textContent = profile.name || "Untitled";

    const avatarEl = document.getElementById("profile-avatar");
    const avatarInitialEl = document.getElementById("profile-avatar-initial");
    if (profile.image) {
      avatarEl.style.backgroundImage = `url("${await resolveImageSrc(profile.image)}")`;
      avatarEl.classList.add("has-image");
      avatarInitialEl.textContent = "";
    } else {
      avatarEl.style.backgroundImage = "";
      avatarEl.classList.remove("has-image");
      avatarInitialEl.textContent = (profile.name || "?").trim().charAt(0).toUpperCase() || "?";
    }

    const noteEl = document.getElementById("profile-note");
    if (profile.note) {
      noteEl.textContent = profile.note;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
    }

    const searchLink = document.getElementById("profile-search-mentions-link");
    const name = (profile.name || "").trim();
    if (name) {
      searchLink.href = `https://www.google.com/search?q=${encodeURIComponent(`"${name}"`)}&tbs=qdr:m`;
      document.getElementById("profile-search-mentions-icon").innerHTML = ICON_SEARCH + ICON_EXTERNAL;
      searchLink.classList.remove("hidden");
    } else {
      searchLink.classList.add("hidden");
    }

    const channelsEl = document.getElementById("profile-channels");
    const channels = profile.channels || [];
    if (channels.length === 0) {
      channelsEl.replaceChildren();
    } else {
      channelsEl.replaceChildren(
        ...channels.map((channel) => {
          const row = document.createElement("a");
          row.className = "channel-view-row";
          row.href = channel.url;
          row.target = "_blank";
          row.rel = "noopener noreferrer";

          const typeEl = document.createElement("span");
          typeEl.className = "channel-view-type";
          typeEl.textContent = CHANNEL_TYPE_LABELS[channel.type] || "Other";

          const urlEl = document.createElement("span");
          urlEl.className = "channel-view-url";
          urlEl.textContent = hostnameFor(channel.url) || channel.url;

          const meta = document.createElement("span");
          meta.className = "channel-view-meta";
          meta.append(typeEl, urlEl);

          const right = document.createElement("span");
          right.className = "channel-view-right";
          if (channel.rssUrl) right.innerHTML += ICON_RSS;
          if (channel.newCount) {
            const badge = document.createElement("span");
            badge.className = "channel-new-badge";
            badge.textContent = String(channel.newCount);
            right.appendChild(badge);
          }
          right.innerHTML += ICON_EXTERNAL;

          row.append(meta, right);
          return row;
        })
      );
    }

    await renderTagRefChips(document.getElementById("profile-tag-chips"), profile.tagIds, nav);

    const snippetsGrid = document.getElementById("profile-snippets-grid");
    const snippets = await getSnippetsForProfile(id);
    if (snippets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No snippets linked to this profile yet.";
      snippetsGrid.replaceChildren(empty);
    } else {
      renderMasonry(snippetsGrid, snippets, (snippet) => createSnippetNode(snippet, (s) => openSnippetDetail(nav, s, load)));
    }

    document.getElementById("profile-edit-btn").onclick = () => {
      openProfileEditor(nav, {
        profile,
        isNew: false,
        refresh: load,
        onDeleted: () => nav.toHome(),
      });
    };
    document.getElementById("profile-share-btn").onclick = async () => {
      const data = await exportProfileData(profile);
      await shareOrDownload(filenameFor(profile.name), JSON.stringify(data, null, 2));
    };
    document.getElementById("profile-add-snippet-btn").onclick = () => {
      openSnippetEditor(nav, { snippet: createEmptySnippet(), isNew: true, refresh: load, presetProfileId: id });
    };
  }

  await load();
}
