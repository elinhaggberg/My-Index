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

export function openSheet(templateId) {
  const tpl = document.getElementById(templateId);
  const backdrop = document.createElement("div");
  backdrop.className = "sheet-backdrop";
  backdrop.appendChild(tpl.content.cloneNode(true));
  document.body.appendChild(backdrop);
  lockBodyScroll();

  let closed = false;
  function close() {
    if (closed) return;
    closed = true;
    backdrop.remove();
    unlockBodyScroll();
  }
  backdrop.addEventListener("click", (e) => {
    if (e.target === backdrop) close();
  });
  return { el: backdrop, close };
}
