// "From" in the snippet editor: which saved snippet an excerpt (quote,
// note, poem) comes from -- a book, an article, an episode. Searchable
// like the profile picker. A book that isn't in the register yet can be
// added from here in one step; it's saved as an ordinary Book snippet.

import { getSnippets, createEmptySnippet, saveSnippet } from "./storage.js";
import { openSheet } from "./sheet.js";
import { isSource, sourceTitle } from "./sources.js";
import { typeFor } from "./snippetTypes.js";

export async function renderSourceField(container, { draft, onChange }) {
  async function drawSummary() {
    const all = await getSnippets();
    const current = draft.sourceId ? all.find((s) => s.id === draft.sourceId) : null;
    container.replaceChildren();
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "source-field-btn" + (current ? " chosen" : "");
    if (current) {
      btn.innerHTML = typeFor(current.type).icon;
      const label = document.createElement("span");
      label.textContent = sourceTitle(current);
      btn.appendChild(label);
    } else {
      btn.textContent = "+ Choose a source";
    }
    btn.addEventListener("click", () => openPicker());
    container.appendChild(btn);
    if (current) {
      const clear = document.createElement("button");
      clear.type = "button";
      clear.className = "text-btn-inline source-field-clear";
      clear.textContent = "Remove";
      clear.addEventListener("click", () => {
        draft.sourceId = null;
        onChange?.();
        drawSummary();
      });
      container.appendChild(clear);
    }
  }

  function openPicker() {
    const sheet = openSheet("tpl-source-picker");
    const el = sheet.el;
    el.querySelector(".close-btn").addEventListener("click", () => sheet.close());
    const searchInput = el.querySelector("#source-picker-search");
    const listEl = el.querySelector("#source-picker-list");
    const createBtn = el.querySelector("#source-picker-create-btn");

    function choose(id) {
      draft.sourceId = id;
      onChange?.();
      drawSummary();
      sheet.close();
    }

    async function drawList() {
      const q = searchInput.value.trim();
      const ql = q.toLowerCase();
      const sources = (await getSnippets())
        .filter((s) => isSource(s) && s.id !== draft.id)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
      const matches = ql
        ? sources.filter((s) => [sourceTitle(s), s.author, s.siteName, s.url].some((v) => (v || "").toLowerCase().includes(ql)))
        : sources.slice(0, 50);

      listEl.replaceChildren(
        ...matches.map((s) => {
          const row = document.createElement("button");
          row.type = "button";
          row.className = "source-picker-row" + (s.id === draft.sourceId ? " active" : "");
          row.innerHTML = typeFor(s.type).icon;
          const text = document.createElement("span");
          text.className = "source-picker-text";
          const title = document.createElement("span");
          title.className = "source-picker-title";
          title.textContent = sourceTitle(s);
          const meta = document.createElement("span");
          meta.className = "source-picker-meta";
          meta.textContent = [typeFor(s.type).label, s.siteName].filter(Boolean).join(" · ");
          text.append(title, meta);
          row.appendChild(text);
          row.addEventListener("click", () => choose(s.id));
          return row;
        })
      );
      el.querySelector("#source-picker-empty").classList.toggle("hidden", matches.length > 0);
      createBtn.classList.toggle("hidden", !q);
      createBtn.textContent = `+ Add the book “${q}”`;
    }

    // A new book gets the excerpt's tags and profiles, so it lands next to
    // it rather than in the Inbox.
    createBtn.addEventListener("click", async () => {
      const title = searchInput.value.trim();
      if (!title) return;
      const book = { ...createEmptySnippet(), type: "book", content: title, tagIds: [...(draft.tagIds || [])], profileIds: [...(draft.profileIds || [])] };
      await saveSnippet(book);
      choose(book.id);
    });

    searchInput.addEventListener("input", drawList);
    drawList();
    setTimeout(() => searchInput.focus(), 50);
  }

  await drawSummary();
}
