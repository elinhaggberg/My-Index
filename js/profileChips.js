import { getProfiles, createEmptyProfile, saveProfile } from "./storage.js";
import { openSheet } from "./sheet.js";

// Shared by the Snippet editor and detail sheet -- links a Snippet to one or
// more Profiles directly, independent of tags. "+ New profile" creates a
// bare-minimum profile (just a name) on the spot so capturing a snippet
// never has to pause on a full profile edit; the rest (note, channels,
// tags) can be filled in later from the Profile page itself.
export async function renderProfileChips(container, { selectedIds, onToggle }) {
  async function draw() {
    const profiles = (await getProfiles()).sort((a, b) => a.name.localeCompare(b.name));
    const chips = profiles.map((profile) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "board-chip" + (selectedIds.includes(profile.id) ? " active" : "");
      chip.textContent = profile.name || "Untitled";
      chip.addEventListener("click", () => {
        onToggle(profile.id);
        draw();
      });
      return chip;
    });

    const newChip = document.createElement("button");
    newChip.type = "button";
    newChip.className = "board-chip new-chip";
    newChip.textContent = "+ New profile";
    newChip.addEventListener("click", openCreate);

    container.replaceChildren(...chips, newChip);
  }

  function openCreate() {
    const sheet = openSheet("tpl-profile-create");
    sheet.el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
    const form = sheet.el.querySelector("#profile-create-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      const profile = await saveProfile({ ...createEmptyProfile(), name });
      onToggle(profile.id);
      sheet.close();
      draw();
    });
  }

  await draw();
}
