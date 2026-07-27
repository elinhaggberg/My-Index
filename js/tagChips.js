import { getTags, findOrCreateTag } from "./storage.js";
import { openSheet } from "./sheet.js";

// Shared by the Profile and Snippet editors, so tag membership is edited the
// same way from either place -- tags are a shared taxonomy (like My
// Closet's boards) rather than free text, so picking one here is picking
// the same underlying tag record a Tag page cross-references from.
export async function renderTagChips(container, { selectedIds, onToggle }) {
  async function draw() {
    const tags = await getTags();
    const chips = tags.map((tag) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "board-chip" + (selectedIds.includes(tag.id) ? " active" : "");
      chip.textContent = tag.name;
      chip.addEventListener("click", () => {
        onToggle(tag.id);
        draw();
      });
      return chip;
    });

    const newChip = document.createElement("button");
    newChip.type = "button";
    newChip.className = "board-chip new-chip";
    newChip.textContent = "+ New tag";
    newChip.addEventListener("click", openCreate);

    container.replaceChildren(...chips, newChip);
  }

  function openCreate() {
    const sheet = openSheet("tpl-tag-create");
    sheet.el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
    const form = sheet.el.querySelector("#tag-create-form");
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = form.name.value.trim();
      if (!name) return;
      const tag = await findOrCreateTag(name);
      if (tag) onToggle(tag.id);
      sheet.close();
      draw();
    });
  }

  await draw();
}
