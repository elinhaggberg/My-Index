import {
  getProfiles,
  getSnippets,
  getTags,
  getHomeTitle,
  getHomeFilterPref,
  setHomeFilterPref,
  createEmptySnippet,
  saveProfile,
  exportBackupData,
  markBackedUp,
  dismissBackupBanner,
  shouldShowBackupBanner,
  shouldShowStorageWarning,
  dismissStorageWarningBanner,
  getShowProfileRow,
} from "../storage.js";
import { renderTabbar } from "../tabbar.js";
import { renderMasonry } from "../masonry.js";
import { resetLazyGrid } from "../lazyImage.js";
import { createSnippetNode } from "../snippetCard.js";
import { createProfileTileNode } from "../profileTile.js";
import { openSnippetDetail } from "../snippetDetail.js";
import { openSnippetEditor } from "../snippetEditor.js";
import { openSettingsMenu } from "../settingsMenu.js";
import { shareOrDownload } from "../share.js";
import { fetchAndMergeCounts } from "../feedSync.js";
import { isBackupConfigured } from "../cloudBackup.js";
import { applySnippetFilter, isSnippetFilterActive, describeSnippetFilter, openSnippetFilterSheet } from "../snippetFilter.js";
import { openSnippetSearch } from "../snippetSearch.js";

export async function renderHome(root, nav) {
  const tpl = document.getElementById("tpl-home");
  root.replaceChildren(tpl.content.cloneNode(true));
  renderTabbar(root, nav, "home");

  document.getElementById("home-title").textContent = getHomeTitle();
  document.getElementById("add-btn").addEventListener("click", () => {
    openSnippetEditor(nav, { snippet: createEmptySnippet(), isNew: true, refresh: renderAll });
  });
  document.getElementById("settings-btn").addEventListener("click", () => openSettingsMenu(nav, renderAll));
  document.getElementById("search-btn").addEventListener("click", () => openSnippetSearch(nav, renderAll));
  document.getElementById("filter-btn").addEventListener("click", () => openSnippetFilterSheet(renderSnippetGrid));
  document.getElementById("home-filter-clear-btn").addEventListener("click", () => {
    setHomeFilterPref({ tagIds: [], types: [], dateFrom: "", dateTo: "" });
    renderSnippetGrid();
  });

  async function renderProfileRow() {
    const row = document.getElementById("profile-row");
    // Opt-out in Settings -> Customize, on by default -- purely a display
    // preference, so this is the only thing that changes; the Profiles tab
    // (where the actual data lives) is unaffected either way.
    if (!getShowProfileRow()) {
      row.classList.add("hidden");
      return;
    }

    // Best-effort and inert unless the optional backend is configured (see
    // supabase/SETUP.md) -- merges any server-tracked badge counts in first.
    await fetchAndMergeCounts(getProfiles, saveProfile);

    // Home's row only -- profiles with unread RSS content float to the
    // front (most new items first), so this is the one place "what's
    // worth checking on" is visible at a glance. The Profiles tab keeps
    // its own separate, explicit sort (alphabetical/recent) untouched.
    const profiles = (await getProfiles()).sort(
      (a, b) => (b.newCount || 0) - (a.newCount || 0) || (b.createdAt || 0) - (a.createdAt || 0)
    );
    if (profiles.length === 0) {
      row.classList.add("hidden");
      return;
    }
    row.classList.remove("hidden");
    row.replaceChildren(...profiles.map((p) => createProfileTileNode(p, (profile) => nav.toProfile(profile.id))));
  }

  async function renderSnippetGrid() {
    const grid = document.getElementById("home-grid");
    const headlineEl = document.getElementById("home-headline");
    const clearBtn = document.getElementById("home-filter-clear-btn");
    const filterBtn = document.getElementById("filter-btn");

    const pref = getHomeFilterPref();
    const active = isSnippetFilterActive(pref);
    filterBtn.classList.toggle("active", active);
    clearBtn.classList.toggle("hidden", !active);
    headlineEl.classList.toggle("filtered-headline", active);

    const allSnippets = (await getSnippets()).sort((a, b) => b.createdAt - a.createdAt);
    const snippets = active ? applySnippetFilter(allSnippets, pref) : allSnippets;

    if (active) {
      const tagsById = new Map((await getTags()).map((t) => [t.id, t]));
      headlineEl.textContent = describeSnippetFilter(pref, tagsById);
    } else {
      headlineEl.textContent = "Recently saved";
    }

    if (snippets.length === 0) {
      resetLazyGrid();
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = active ? "Nothing matches this filter." : "Nothing saved yet. Tap + to save your first link, quote, or note.";
      grid.replaceChildren(empty);
      return;
    }
    resetLazyGrid();
    renderMasonry(grid, snippets, (snippet) => createSnippetNode(snippet, (s) => openSnippetDetail(nav, s, renderAll)));
  }

  async function renderAll() {
    await Promise.all([renderProfileRow(), renderSnippetGrid()]);
  }

  await renderAll();

  // Cloud Backup already keeps a live copy elsewhere, on its own schedule --
  // nagging for a manual export on top of that would be telling someone
  // who's already backed up that they aren't.
  const banner = document.getElementById("backup-banner");
  if (!isBackupConfigured() && (await shouldShowBackupBanner())) {
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

  const storageBanner = document.getElementById("storage-warning-banner");
  if (await shouldShowStorageWarning()) {
    storageBanner.classList.remove("hidden");
    storageBanner.querySelector("#storage-warning-dismiss-btn").addEventListener("click", () => {
      dismissStorageWarningBanner();
      storageBanner.classList.add("hidden");
    });
  }
}
