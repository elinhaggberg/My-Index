import {
  getProfile,
  clearProfileNewCount,
  clearChannelNewCount,
  getSnippetsForProfile,
  exportProfileData,
} from "../storage.js";
import { renderMasonry } from "../masonry.js";
import { resetLazyGrid } from "../lazyImage.js";
import { createSnippetNode } from "../snippetCard.js";
import { openSnippetDetail } from "../snippetDetail.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { createEmptySnippet } from "../storage.js";
import { openProfileEditor } from "../profileEditor.js";
import { renderTagRefChips } from "../refChips.js";
import { hostnameFor } from "../util.js";
import { ICON_EXTERNAL, ICON_RSS, ICON_SEARCH } from "../icons.js";
import { clearServerCounts, clearChannelServerCount } from "../feedSync.js";
import { resolveImageSrc } from "../imageStore.js";
import { shareOrDownload, filenameFor } from "../share.js";
import { CHANNEL_TYPE_LABELS } from "../channelTypes.js";

export async function renderProfile(root, nav, id) {
  const tpl = document.getElementById("tpl-profile");
  root.replaceChildren(tpl.content.cloneNode(true));

  root.querySelector(".back-btn").addEventListener("click", () => nav.toHome());

  async function load() {
    // Just opening the profile page no longer clears anything on its own --
    // that used to silently discard a badge before it was ever consciously
    // seen (e.g. a browser tab resuming on a profile it had been left open
    // on). A badge now only clears one of two ways: tapping through to a
    // channel's actual feed link (see the row click handler below), or the
    // manual "Mark as read" button for the whole profile at once.
    const profile = await getProfile(id);
    if (!profile) {
      nav.toHome();
      return;
    }

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
    const markReadBtn = document.getElementById("profile-mark-read-btn");
    markReadBtn.classList.toggle("hidden", !profile.newCount);

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

          // Tapping through to the channel's actual feed is what marks it
          // read -- doesn't block the normal navigation (still opens in a
          // new tab), just also clears this one channel's badge, locally
          // and server-side, and drops it from view right away rather than
          // waiting for the next full reload. Re-queries the badge instead
          // of closing over the node created above -- the innerHTML += just
          // above re-serializes and re-parses right's whole contents,
          // silently detaching that reference from what's actually on
          // screen.
          if (channel.newCount) {
            row.addEventListener("click", () => {
              row.querySelector(".channel-new-badge")?.remove();
              channel.newCount = 0;
              clearChannelNewCount(id, channel.id);
              clearChannelServerCount(channel.id);
              if (!channels.some((c) => c.newCount)) markReadBtn.classList.add("hidden");
            });
          }

          return row;
        })
      );
    }

    markReadBtn.onclick = () => {
      channelsEl.querySelectorAll(".channel-new-badge").forEach((el) => el.remove());
      channels.forEach((c) => (c.newCount = 0));
      markReadBtn.classList.add("hidden");
      clearProfileNewCount(id);
      clearServerCounts(id);
    };

    await renderTagRefChips(document.getElementById("profile-tag-chips"), profile.tagIds, nav);

    const snippetsGrid = document.getElementById("profile-snippets-grid");
    const snippets = await getSnippetsForProfile(id);
    if (snippets.length === 0) {
      resetLazyGrid();
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No snippets linked to this profile yet.";
      snippetsGrid.replaceChildren(empty);
    } else {
      resetLazyGrid();
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
