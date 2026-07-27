import { getProfiles } from "./storage.js";
import { openSheet } from "./sheet.js";
import { createProfileCardNode } from "./profileCard.js";

export function openProfileSearch(nav, refresh) {
  const sheet = openSheet("tpl-search-profiles");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const input = el.querySelector("#profile-search-input");
  const resultsEl = el.querySelector("#profile-search-results");
  const emptyEl = el.querySelector("#profile-search-empty");

  async function runSearch() {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      resultsEl.replaceChildren();
      emptyEl.textContent = "Start typing to search your profiles.";
      emptyEl.classList.remove("hidden");
      return;
    }
    const profiles = await getProfiles();
    const matches = profiles.filter((p) => (p.name || "").toLowerCase().includes(q) || (p.note || "").toLowerCase().includes(q));
    if (matches.length === 0) {
      resultsEl.replaceChildren();
      emptyEl.textContent = "No profiles match that search.";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    resultsEl.replaceChildren(
      ...matches.map((p) =>
        createProfileCardNode(p, (profile) => {
          sheet.close();
          nav.toProfile(profile.id);
        })
      )
    );
  }

  input.addEventListener("input", runSearch);
  runSearch();
  setTimeout(() => input.focus(), 50);
}
