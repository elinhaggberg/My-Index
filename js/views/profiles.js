import { getProfiles, getProfilesFilterPref, createEmptyProfile } from "../storage.js";
import { renderTabbar } from "../tabbar.js";
import { openSettingsMenu } from "../settingsMenu.js";
import { createProfileCardNode } from "../profileCard.js";
import { applyProfileFilter, openProfileFilterSheet } from "../profileFilter.js";
import { openProfileSearch } from "../profileSearch.js";
import { openProfileEditor } from "../profileEditor.js";

export async function renderProfiles(root, nav) {
  const tpl = document.getElementById("tpl-profiles");
  root.replaceChildren(tpl.content.cloneNode(true));
  renderTabbar(root, nav, "profiles");

  document.getElementById("settings-btn").addEventListener("click", () => openSettingsMenu(nav, renderList));
  document.getElementById("search-btn").addEventListener("click", () => openProfileSearch(nav, renderList));
  document.getElementById("filter-btn").addEventListener("click", () => openProfileFilterSheet(renderList));
  document.getElementById("add-profile-btn").addEventListener("click", () => {
    openProfileEditor(nav, { profile: createEmptyProfile(), isNew: true, refresh: renderList });
  });

  async function renderList() {
    const grid = document.getElementById("profiles-grid");
    const pref = getProfilesFilterPref();
    document.getElementById("filter-btn").classList.toggle("active", pref.tagIds.length > 0);

    const profiles = applyProfileFilter(await getProfiles(), pref);
    if (profiles.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = pref.tagIds.length
        ? "No profiles match this filter."
        : "No profiles yet. Tap + to add someone you're curious about.";
      grid.replaceChildren(empty);
      return;
    }
    grid.replaceChildren(...profiles.map((p) => createProfileCardNode(p, (profile) => nav.toProfile(profile.id))));
  }

  await renderList();
}
