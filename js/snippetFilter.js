import { getTags, getHomeFilterPref, setHomeFilterPref, UNCATEGORIZED_TAG_ID } from "./storage.js";
import { openSheet } from "./sheet.js";
import { SNIPPET_TYPES, typeFor } from "./snippetTypes.js";

export function isSnippetFilterActive(pref) {
  return Boolean(pref.tagIds?.length || pref.types?.length || pref.dateFrom || pref.dateTo);
}

export function applySnippetFilter(snippets, pref) {
  let list = snippets;

  if (pref.tagIds?.length) {
    list = list.filter((s) => {
      const hasNoTags = !s.tagIds || s.tagIds.length === 0;
      return pref.tagIds.some((id) => (id === UNCATEGORIZED_TAG_ID ? hasNoTags : (s.tagIds || []).includes(id)));
    });
  }
  if (pref.types?.length) {
    list = list.filter((s) => pref.types.includes(s.type));
  }
  if (pref.dateFrom) {
    const fromTs = new Date(`${pref.dateFrom}T00:00:00`).getTime();
    list = list.filter((s) => s.createdAt >= fromTs);
  }
  if (pref.dateTo) {
    const toTs = new Date(`${pref.dateTo}T23:59:59.999`).getTime();
    list = list.filter((s) => s.createdAt <= toTs);
  }
  return list;
}

function formatDateRange(from, to) {
  const fmt = (d) => new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
  if (from && to) return `${fmt(from)} – ${fmt(to)}`;
  if (from) return `Since ${fmt(from)}`;
  return `Until ${fmt(to)}`;
}

// Builds the accent-colored headline that replaces "Recently saved" when a
// filter is active, summarizing every active dimension in one line.
export function describeSnippetFilter(pref, tagsById) {
  const clauses = [];
  if (pref.tagIds?.length) {
    const names = pref.tagIds
      .map((id) => (id === UNCATEGORIZED_TAG_ID ? "Uncategorized" : tagsById.get(id)?.name))
      .filter(Boolean);
    if (names.length) clauses.push(names.join(", "));
  }
  if (pref.types?.length) {
    clauses.push(pref.types.map((t) => typeFor(t).label).join(", "));
  }
  if (pref.dateFrom || pref.dateTo) {
    clauses.push(formatDateRange(pref.dateFrom, pref.dateTo));
  }
  return clauses.join(" · ") || "Filtered";
}

export async function openSnippetFilterSheet(onChange) {
  const sheet = openSheet("tpl-snippet-filter");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const pref = getHomeFilterPref();

  const tagRow = el.querySelector("#filter-tag-row");
  const tags = await getTags();
  const tagOptions = [{ id: UNCATEGORIZED_TAG_ID, name: "Uncategorized" }, ...tags];
  function renderTagRow() {
    tagRow.replaceChildren(
      ...tagOptions.map((t) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "board-chip" + (pref.tagIds.includes(t.id) ? " active" : "");
        chip.textContent = t.name;
        chip.addEventListener("click", () => {
          const idx = pref.tagIds.indexOf(t.id);
          if (idx >= 0) pref.tagIds.splice(idx, 1);
          else pref.tagIds.push(t.id);
          setHomeFilterPref(pref);
          renderTagRow();
          onChange();
        });
        return chip;
      })
    );
  }
  renderTagRow();

  const typeRow = el.querySelector("#filter-type-row");
  function renderTypeRow() {
    typeRow.replaceChildren(
      ...SNIPPET_TYPES.map((t) => {
        const chip = document.createElement("button");
        chip.type = "button";
        chip.className = "type-chip" + (pref.types.includes(t.id) ? " active" : "");
        chip.innerHTML = `${t.icon}<span>${t.label}</span>`;
        chip.addEventListener("click", () => {
          const idx = pref.types.indexOf(t.id);
          if (idx >= 0) pref.types.splice(idx, 1);
          else pref.types.push(t.id);
          setHomeFilterPref(pref);
          renderTypeRow();
          onChange();
        });
        return chip;
      })
    );
  }
  renderTypeRow();

  const fromInput = el.querySelector("#filter-date-from");
  const toInput = el.querySelector("#filter-date-to");
  fromInput.value = pref.dateFrom || "";
  toInput.value = pref.dateTo || "";
  fromInput.addEventListener("change", () => {
    pref.dateFrom = fromInput.value;
    setHomeFilterPref(pref);
    onChange();
  });
  toInput.addEventListener("change", () => {
    pref.dateTo = toInput.value;
    setHomeFilterPref(pref);
    onChange();
  });

  el.querySelector("#filter-clear-btn").addEventListener("click", () => {
    setHomeFilterPref({ tagIds: [], types: [], dateFrom: "", dateTo: "" });
    sheet.close();
    onChange();
  });
}
