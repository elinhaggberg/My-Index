import { getSnippets } from "./storage.js";
import { openSheet } from "./sheet.js";
import { renderMasonry } from "./masonry.js";
import { createSnippetNode } from "./snippetCard.js";
import { openSnippetDetail } from "./snippetDetail.js";

// Live full-text search across every snippet, independent of Home's
// tag/type/date filter -- same pattern as My Bookshelf's search: a separate
// icon opening its own modal with live results, rather than folding a text
// query into the persisted filter state.
export function openSnippetSearch(nav, refresh) {
  const sheet = openSheet("tpl-search-snippets");
  const el = sheet.el;
  el.querySelector(".close-btn").addEventListener("click", () => sheet.close());

  const input = el.querySelector("#snippet-search-input");
  const resultsEl = el.querySelector("#snippet-search-results");
  const emptyEl = el.querySelector("#snippet-search-empty");

  async function runSearch() {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      resultsEl.replaceChildren();
      emptyEl.textContent = "Start typing to search your snippets.";
      emptyEl.classList.remove("hidden");
      return;
    }
    const snippets = await getSnippets();
    const matches = snippets.filter((s) => {
      return (
        (s.content || "").toLowerCase().includes(q) ||
        (s.comment || "").toLowerCase().includes(q) ||
        (s.siteName || "").toLowerCase().includes(q) ||
        (s.url || "").toLowerCase().includes(q)
      );
    });
    if (matches.length === 0) {
      resultsEl.replaceChildren();
      emptyEl.textContent = "No snippets match that search.";
      emptyEl.classList.remove("hidden");
      return;
    }
    emptyEl.classList.add("hidden");
    renderMasonry(resultsEl, matches, (snippet) =>
      createSnippetNode(snippet, (s) =>
        openSnippetDetail(nav, s, () => {
          runSearch();
          refresh();
        })
      )
    );
  }

  input.addEventListener("input", runSearch);
  runSearch();
  setTimeout(() => input.focus(), 50);
}
