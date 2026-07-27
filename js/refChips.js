import { getTag, getProfile } from "./storage.js";

// Read-only, navigable chips -- used anywhere a Tag or Profile is shown as a
// cross-reference rather than something being edited (Snippet detail, a
// Profile's tag list, etc). Tapping one closes the current sheet and jumps
// straight to that Tag/Profile page, which is the whole point of the shared
// tag pool: any snippet or profile becomes a doorway to everything else that
// shares the same tag.
export async function renderTagRefChips(container, tagIds, nav, onNavigate) {
  const tags = await Promise.all((tagIds || []).map((id) => getTag(id)));
  container.replaceChildren(
    ...tags.filter(Boolean).map((tag) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "board-chip";
      chip.textContent = tag.name;
      chip.addEventListener("click", () => {
        if (onNavigate) onNavigate();
        nav.toTag(tag.id);
      });
      return chip;
    })
  );
}

export async function renderProfileRefChips(container, profileIds, nav, onNavigate) {
  const profiles = await Promise.all((profileIds || []).map((id) => getProfile(id)));
  container.replaceChildren(
    ...profiles.filter(Boolean).map((profile) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "board-chip";
      chip.textContent = profile.name || "Untitled";
      chip.addEventListener("click", () => {
        if (onNavigate) onNavigate();
        nav.toProfile(profile.id);
      });
      return chip;
    })
  );
}
