import { getTags, findOrCreateTag } from "./storage.js";
import { openSheet } from "./sheet.js";
import { renderPickerSummary } from "./pickerField.js";

// Shared by the Profile and Snippet editors, so tag membership is edited the
// same way from either place -- tags are a shared taxonomy (like My
// Closet's boards) rather than free text, so picking one here is picking
// the same underlying tag record a Tag page cross-references from.
//
// The full tag list no longer sits inline in the editor -- as the taxonomy
// grows that becomes a wall of chips before you even reach Save. Instead the
// editor shows only what's attached (removable chips) plus an "Edit tags"
// button that opens a search + cloud picker sheet.
export async function renderTagChips(container, { selectedIds, onToggle }) {
  async function drawSummary() {
    const tags = await getTags();
    const byId = new Map(tags.map((t) => [t.id, t]));
    const items = selectedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((tag) => ({ id: tag.id, label: tag.name }));
    renderPickerSummary(container, {
      items,
      onRemove: (id) => {
        onToggle(id);
        drawSummary();
      },
      addLabel: items.length ? "+ Edit tags" : "+ Add tags",
      onAdd: openPicker,
    });
  }

  function openPicker() {
    const sheet = openSheet("tpl-tag-picker");
    const el = sheet.el;
    el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
    el.querySelector("#tag-picker-done-btn").addEventListener("click", () => sheet.close());

    const searchInput = el.querySelector("#tag-picker-search");
    const cloud = el.querySelector("#tag-picker-cloud");

    async function drawCloud() {
      const q = searchInput.value.trim().toLowerCase();
      const tags = await getTags();
      const matches = q ? tags.filter((t) => t.name.toLowerCase().includes(q)) : tags;

      const chips = matches.map((tag) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "board-chip" + (selectedIds.includes(tag.id) ? " active" : "");
        chip.textContent = tag.name;
        chip.addEventListener("click", () => {
          onToggle(tag.id);
          drawCloud();
          drawSummary();
        });
        return chip;
      });

      const exactMatch = q && tags.some((t) => t.name.toLowerCase() === q);
      const nodes = [...chips];
      if (q && !exactMatch) {
        const newChip = document.createElement("button");
        newChip.type = "button";
        newChip.className = "board-chip new-chip";
        newChip.textContent = `+ Create "${searchInput.value.trim()}"`;
        newChip.addEventListener("click", async () => {
          const tag = await findOrCreateTag(searchInput.value.trim());
          if (tag && !selectedIds.includes(tag.id)) onToggle(tag.id);
          searchInput.value = "";
          drawCloud();
          drawSummary();
        });
        nodes.push(newChip);
      }
      cloud.replaceChildren(...nodes);
    }
    searchInput.addEventListener("input", drawCloud);
    drawCloud();
  }

  await drawSummary();
}
