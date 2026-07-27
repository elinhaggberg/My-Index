import { getTags, getProfilesFilterPref, setProfilesFilterPref } from "./storage.js";
import { openSheet } from "./sheet.js";

const SORT_OPTIONS = [
  { id: "recent", label: "Recently added" },
  { id: "alpha", label: "Alphabetical" },
];

// Profiles don't have an Uncategorized concept -- that's a Snippet-only
// idea (see storage.js) -- so the tag filter here only ever lists real tags.
export function applyProfileFilter(profiles, pref) {
  let list = profiles;
  if (pref.tagIds?.length) {
    list = list.filter((p) => pref.tagIds.some((id) => (p.tagIds || []).includes(id)));
  }
  list = [...list];
  if (pref.sort === "alpha") list.sort((a, b) => a.name.localeCompare(b.name));
  else list.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return list;
}

export async function openProfileFilterSheet(onChange) {
  const sheet = openSheet("tpl-profiles-filter");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const pref = getProfilesFilterPref();

  const sortList = el.querySelector("#profiles-sort-list");
  function renderSort() {
    sortList.replaceChildren(
      ...SORT_OPTIONS.map((opt) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "sort-option" + (pref.sort === opt.id ? " active" : "");
        btn.textContent = opt.label;
        btn.addEventListener("click", () => {
          pref.sort = opt.id;
          setProfilesFilterPref(pref);
          renderSort();
          onChange();
        });
        return btn;
      })
    );
  }
  renderSort();

  const tagRow = el.querySelector("#profiles-filter-tag-row");
  const tags = await getTags();
  function renderTagRow() {
    tagRow.replaceChildren(
      ...tags.map((t) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "board-chip" + (pref.tagIds.includes(t.id) ? " active" : "");
        chip.textContent = t.name;
        chip.addEventListener("click", () => {
          const idx = pref.tagIds.indexOf(t.id);
          if (idx >= 0) pref.tagIds.splice(idx, 1);
          else pref.tagIds.push(t.id);
          setProfilesFilterPref(pref);
          renderTagRow();
          onChange();
        });
        return chip;
      })
    );
  }
  renderTagRow();

  el.querySelector("#profiles-filter-clear-btn").addEventListener("click", () => {
    setProfilesFilterPref({ sort: pref.sort, tagIds: [] });
    sheet.close();
    onChange();
  });
}
