// Keyboard shortcuts, for when My Index is used with a keyboard (mostly on
// a computer): N saves something new, / searches, Esc closes whatever is
// on top. The reader adds j / k for moving between posts (js/views/feed.js).
// Letters are ignored while typing, and with Cmd/Ctrl/Alt held, so they
// never shadow the browser's own shortcuts.

import { hasOpenSheet, closeTopSheet } from "./sheet.js";

function isTyping(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable]"));
}

export function wireShortcuts({ onNew, onSearch }) {
  document.addEventListener("keydown", (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === "Escape") {
      if (closeTopSheet()) e.preventDefault();
      return;
    }
    if (isTyping(e.target) || hasOpenSheet()) return;
    if (e.key === "n" || e.key === "N") {
      e.preventDefault();
      onNew();
    } else if (e.key === "/") {
      e.preventDefault();
      onSearch();
    }
  });
}
