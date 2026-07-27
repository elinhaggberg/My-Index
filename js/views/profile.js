import {
  getProfile,
  clearProfileNewCount,
  getSnippetsForProfile,
} from "../storage.js";
import { renderMasonry } from "../masonry.js";
import { createSnippetNode } from "../snippetCard.js";
import { openSnippetDetail } from "../snippetDetail.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { createEmptySnippet } from "../storage.js";
import { openProfileEditor } from "../profileEditor.js";
import { renderTagRefChips } from "../refChips.js";
import { hostnameFor } from "../util.js";
import { ICON_EXTERNAL, ICON_RSS } from "../icons.js";
import { clearServerCounts } from "../feedSync.js";

const CHANNEL_TYPE_LABELS = { blog: "Blog", podcast: "Podcast", newsletter: "Newsletter", social: "Social", other: "Other" };

export async function renderProfile(root, nav, id) {
  const tpl = document.getElementById("tpl-profile");
  root.replaceChildren(tpl.content.cloneNode(true));

  root.querySelector(".back-btn").addEventListener("click", () => nav.toHome());

  async function load() {
    // Visiting the profile's page is what clears its badge, mirroring
    // "unread" mail behavior -- done before render so the cleared state is
    // what's actually shown.
    const profile = await clearProfileNewCount(id);
    if (!profile) {
      nav.toHome();
      return;
    }
    // Best-effort and inert unless the optional backend is configured.
    clearServerCounts(id);

    document.getElementById("profile-title").textContent = profile.name || "Untitled";

    const noteEl = document.getElementById("profile-note");
    if (profile.note) {
      noteEl.textContent = profile.note;
      noteEl.classList.remove("hidden");
    } else {
      noteEl.classList.add("hidden");
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
    document.getElementById("profile-add-snippet-btn").onclick = () => {
      openSnippetEditor(nav, { snippet: createEmptySnippet(), isNew: true, refresh: load, presetProfileId: id });
    };
  }

  await load();
}
