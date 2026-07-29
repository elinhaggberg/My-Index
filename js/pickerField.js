import { ICON_CLOSE_SMALL } from "./icons.js";

// Shared "selected chips + add button" summary row used by the Tag and
// Profile pickers in the Snippet/Profile editors. As either list grows,
// showing every option inline stops working -- so the editor only shows
// what's already attached (as small removable chips) and opens a dedicated
// search sheet to add more, rather than cramming the whole list in place.
export function renderPickerSummary(container, { items, onRemove, addLabel, onAdd }) {
  const chips = items.map(({ id, label }) => {
    const chip = document.createElement("span");
    chip.className = "board-chip removable-chip";
    const text = document.createElement("span");
    text.textContent = label;
    const remove = document.createElement("button");
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove ${label}`);
    remove.innerHTML = ICON_CLOSE_SMALL;
    remove.addEventListener("click", () => onRemove(id));
    chip.append(text, remove);
    return chip;
  });

  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.className = "board-chip new-chip";
  addBtn.textContent = addLabel;
  addBtn.addEventListener("click", onAdd);

  container.replaceChildren(...chips, addBtn);
}
