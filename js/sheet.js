// Locks the underlying page in place while any sheet is open. Without this,
// focusing an input inside a sheet lets mobile Safari scroll the whole
// document to bring the keyboard-focused input into view, which visually
// "lifts" the sheet and reveals the scrollable page behind it. A counter
// supports stacked sheets (e.g. save flow -> tag/profile picker).
let openCount = 0;
let savedScrollY = 0;

function lockBodyScroll() {
  if (openCount === 0) {
    savedScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${savedScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
  }
  openCount++;
}

function unlockBodyScroll() {
  openCount = Math.max(0, openCount - 1);
  if (openCount === 0) {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    window.scrollTo(0, savedScrollY);
  }
}

// Wide screens (the same breakpoint as the desktop layout in style.css).
export const desktopQuery = window.matchMedia("(min-width: 1000px)");

// Every open sheet, oldest first, so Esc can close the one on top.
const stack = [];
// The one side panel, if open (see openSheet's `panel` option).
let currentPanel = null;

// `panel: true` asks for a side panel instead of a modal on a wide screen:
// it slides in from the right, leaves the page behind it scrollable and
// clickable, and opening another panel replaces it. On a phone it's an
// ordinary sheet. A panel closes when the page changes, unless
// `keepOnNavigate` (a half-written new snippet shouldn't vanish because
// you clicked over to a tag to check something).
export function openSheet(templateId, { panel = false, keepOnNavigate = false } = {}) {
  const asPanel = panel && desktopQuery.matches;
  if (asPanel && currentPanel) currentPanel.close({ instant: true });

  const tpl = document.getElementById(templateId);
  const backdrop = document.createElement("div");
  backdrop.className = asPanel ? "sheet-backdrop sheet-panel-host" : "sheet-backdrop";
  backdrop.appendChild(tpl.content.cloneNode(true));
  document.body.appendChild(backdrop);
  if (!asPanel) lockBodyScroll();

  let closed = false;
  const entry = { el: backdrop, close };
  function close({ instant = false } = {}) {
    if (closed) return;
    closed = true;
    const i = stack.indexOf(entry);
    if (i !== -1) stack.splice(i, 1);
    if (asPanel) {
      if (currentPanel === entry) {
        currentPanel = null;
        document.body.classList.remove("side-panel-open");
      }
      window.removeEventListener("hashchange", onNavigate);
      if (instant) backdrop.remove();
      else {
        backdrop.classList.add("closing");
        setTimeout(() => backdrop.remove(), 180);
      }
    } else {
      backdrop.remove();
      unlockBodyScroll();
    }
  }
  // A panel belongs to the page it was opened on.
  function onNavigate() {
    close({ instant: true });
  }
  if (asPanel) {
    currentPanel = entry;
    // Makes room for the panel, so the cards it would cover move over.
    document.body.classList.add("side-panel-open");
    if (!keepOnNavigate) window.addEventListener("hashchange", onNavigate);
  } else {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
  }
  stack.push(entry);
  return entry;
}

export function getOpenPanel() {
  return currentPanel;
}

export function hasOpenSheet() {
  return stack.length > 0;
}

// Esc: closes the sheet on top, through its own close button when it has
// one, so whatever that button does on the way out (saving a draft,
// refreshing the page) still happens.
export function closeTopSheet() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  const btn = top.el.querySelector(".sheet-header .close-btn, .close-btn");
  if (btn) btn.click();
  else top.close();
  return true;
}
