import {
  getProfiles,
  getSnippets,
  getSnippetsForTag,
  getTags,
  getHomeTitle,
  getHomeTagFilter,
  setHomeTagFilter,
  createEmptySnippet,
  saveProfile,
  exportBackupData,
  markBackedUp,
  dismissBackupBanner,
  shouldShowBackupBanner,
  UNCATEGORIZED_TAG_ID,
} from "../storage.js";
import { renderTabbar } from "../tabbar.js";
import { renderMasonry } from "../masonry.js";
import { createSnippetNode } from "../snippetCard.js";
import { createProfileTileNode } from "../profileTile.js";
import { openSnippetDetail } from "../snippetDetail.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { openSettingsMenu } from "../settingsMenu.js";
import { openSheet } from "../sheet.js";
import { shareOrDownload } from "../share.js";
import { fetchAndMergeCounts } from "../feedSync.js";

export async function renderHome(root, nav) {
  const tpl = document.getElementById("tpl-home");
  root.replaceChildren(tpl.content.cloneNode(true));
  renderTabbar(root, nav, "home");

  document.getElementById("home-title").textContent = getHomeTitle();
  document.getElementById("add-btn").addEventListener("click", () => {
    openSnippetEditor(nav, { snippet: createEmptySnippet(), isNew: true, refresh: renderAll });
  });
  document.getElementById("settings-btn").addEventListener("click", () => openSettingsMenu(nav, renderAll));
  document.getElementById("filter-btn").addEventListener("click", () => openTagFilter(renderSnippetGrid));

  async function renderProfileRow() {
    // Best-effort and inert unless the optional backend is configured (see
    // supabase/SETUP.md) -- merges any server-tracked badge counts in first.
    await fetchAndMergeCounts(getProfiles, saveProfile);

    const row = document.getElementById("profile-row");
    const profiles = (await getProfiles()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    if (profiles.length === 0) {
      row.classList.add("hidden");
      return;
    }
    row.classList.remove("hidden");
    row.replaceChildren(...profiles.map((p) => createProfileTileNode(p, (profile) => nav.toProfile(profile.id))));
  }

  async function renderSnippetGrid() {
    const grid = document.getElementById("home-grid");
    const filterTagId = getHomeTagFilter();
    updateFilterButtonState(filterTagId);

    const snippets = filterTagId ? await getSnippetsForTag(filterTagId) : (await getSnippets()).sort((a, b) => b.createdAt - a.createdAt);
    if (snippets.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = filterTagId
        ? "Nothing saved under this tag yet."
        : "Nothing saved yet. Tap + to save your first link, quote, or note.";
      grid.replaceChildren(empty);
      return;
    }
    renderMasonry(grid, snippets, (snippet) => createSnippetNode(snippet, (s) => openSnippetDetail(nav, s, renderAll)));
  }

  function updateFilterButtonState(filterTagId) {
    document.getElementById("filter-btn").classList.toggle("active", !!filterTagId);
  }

  async function renderAll() {
    await Promise.all([renderProfileRow(), renderSnippetGrid()]);
  }

  await renderAll();

  const banner = document.getElementById("backup-banner");
  if (await shouldShowBackupBanner()) {
    banner.classList.remove("hidden");
    banner.querySelector("#backup-now-btn").addEventListener("click", async () => {
      const data = await exportBackupData();
      const stamp = new Date().toISOString().slice(0, 10);
      await shareOrDownload(`my-index-backup-${stamp}.json`, JSON.stringify(data, null, 2));
      markBackedUp();
      banner.classList.add("hidden");
    });
    banner.querySelector("#backup-dismiss-btn").addEventListener("click", () => {
      dismissBackupBanner();
      banner.classList.add("hidden");
    });
  }
}

async function openTagFilter(onChange) {
  const sheet = openSheet("tpl-tag-filter");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const current = getHomeTagFilter();
  const tags = await getTags();
  const list = el.querySelector("#tag-filter-list");

  function select(tagId) {
    setHomeTagFilter(tagId);
    sheet.close();
    onChange();
  }

  const options = [{ id: "", name: "All" }, { id: UNCATEGORIZED_TAG_ID, name: "Uncategorized" }, ...tags];
  list.replaceChildren(
    ...options.map((opt) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "sort-option" + (current === opt.id ? " active" : "");
      btn.textContent = opt.name;
      btn.addEventListener("click", () => select(opt.id));
      return btn;
    })
  );
}
