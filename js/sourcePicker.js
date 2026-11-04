// "From" in the snippet editor: which saved snippet an excerpt (quote,
// note, poem) comes from -- a book, an article, an episode. Searchable
// like the profile picker. A book that isn't in the register yet can be
// added from here in one step; it's saved as an ordinary Book snippet,
// with the excerpt's author if one has been filled in.

import { getSnippets, createEmptySnippet, saveSnippet } from "./storage.js";
import { openSheet } from "./sheet.js";
import { isSource, sourceTitle } from "./sources.js";
import { typeFor } from "./snippetTypes.js";

// openEditor: the snippet editor's own opener, passed in by it (rather than
// imported here, which would make the two modules import each other).
export async function renderSourceField(container, { draft, onChange, onAuthorFilled, openEditor }) {
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

    async function choose(id) {
      draft.sourceId = id;
      // An excerpt without an author takes its source's (a quote from a
      // book is by the book's author, more often than not).
      if (!(draft.author || "").trim()) {
        const source = (await getSnippets()).find((s) => s.id === id);
        if (source?.author) {
          draft.author = source.author;
          onAuthorFilled?.(source.author);
        }
      }
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
          meta.textContent = [typeFor(s.type).label, s.author, s.siteName].filter(Boolean).join(" · ");
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
      const book = {
        ...createEmptySnippet(),
        type: "book",
        content: title,
        author: (draft.author || "").trim(),
        tagIds: [...(draft.tagIds || [])],
        profileIds: [...(draft.profileIds || [])],
      };
      await saveSnippet(book);
      choose(book.id);
    });

    // "+" opens the full snippet editor on top, to save any kind of source
    // (book, article link, episode, video…) with every field. Whatever was
    // typed in the search becomes its title. Once saved, it's chosen as
    // this excerpt's source straight away.
    el.querySelector("#source-picker-new-btn").addEventListener("click", () => {
      if (!openEditor) return;
      const source = {
        ...createEmptySnippet(),
        type: "book",
        content: searchInput.value.trim(),
        tagIds: [...(draft.tagIds || [])],
        profileIds: [...(draft.profileIds || [])],
      };
      openEditor({
        snippet: source,
        isNew: true,
        refresh: async () => {
          const saved = (await getSnippets()).find((s) => s.id === source.id);
          if (saved && isSource(saved)) choose(saved.id);
          else drawList();
        },
      });
    });

    searchInput.addEventListener("input", drawList);
    drawList();
    setTimeout(() => searchInput.focus(), 50);
  }

  await drawSummary();
}
