import { getProfiles } from "./storage.js";
import { openSheet } from "./sheet.js";
import { renderPickerSummary } from "./pickerField.js";
import { resolveImageSrc } from "./imageStore.js";
import { ICON_CHECK } from "./icons.js";

// Connects a Snippet to one or more Profiles from the capture/edit modal.
// Profiles are a searchable list rather than a chip cloud (unlike Tags) --
// there's no small fixed vocabulary to browse at a glance the way there is
// with tags, so a search-first dropdown-style list scales better as the
// number of profiles grows.
export async function renderProfileChips(container, { selectedIds, onToggle }) {
  async function drawSummary() {
    const profiles = await getProfiles();
    const byId = new Map(profiles.map((p) => [p.id, p]));
    const items = selectedIds
      .map((id) => byId.get(id))
      .filter(Boolean)
      .map((profile) => ({ id: profile.id, label: profile.name || "Untitled" }));
    renderPickerSummary(container, {
      items,
      onRemove: (id) => {
        onToggle(id);
        drawSummary();
      },
      addLabel: items.length ? "+ Edit profiles" : "+ Connect profile",
      onAdd: openPicker,
    });
  }

  function openPicker() {
    const sheet = openSheet("tpl-profile-picker");
    const el = sheet.el;
    el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
    el.querySelector("#profile-picker-done-btn").addEventListener("click", () => sheet.close());

    const searchInput = el.querySelector("#profile-picker-search");
    const listEl = el.querySelector("#profile-picker-list");
    const emptyEl = el.querySelector("#profile-picker-empty");

    async function drawList() {
      const q = searchInput.value.trim().toLowerCase();
      const profiles = await getProfiles();
      const matches = q ? profiles.filter((p) => (p.name || "").toLowerCase().includes(q)) : profiles;

      emptyEl.classList.toggle("hidden", matches.length > 0);

      listEl.replaceChildren(
        ...matches.map((profile) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "profile-picker-row" + (selectedIds.includes(profile.id) ? " active" : "");

          const avatar = document.createElement("span");
          avatar.className = "profile-picker-avatar";
          if (profile.image) {
            resolveImageSrc(profile.image).then((src) => {
              if (src) avatar.style.backgroundImage = `url("${src}")`;
            });
          } else {
            avatar.textContent = (profile.name || "?").trim().charAt(0).toUpperCase() || "?";
          }

          const name = document.createElement("span");
          name.className = "profile-picker-name";
          name.textContent = profile.name || "Untitled";

          const check = document.createElement("span");
          check.className = "profile-picker-check";
          check.innerHTML = ICON_CHECK;

          row.append(avatar, name, check);
          row.addEventListener("click", () => {
            onToggle(profile.id);
            drawList();
            drawSummary();
          });
          return row;
        })
      );
    }
    searchInput.addEventListener("input", drawList);
    drawList();
  }

  await drawSummary();
}
