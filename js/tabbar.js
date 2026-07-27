import { ICON_HOME, ICON_TAG } from "./icons.js";

// Rendered fresh into #app after every route's replaceChildren() call, since
// #app's content is fully replaced on navigation. Position is fixed via CSS
// so DOM order relative to the page content underneath doesn't matter.
export function renderTabbar(root, nav, active) {
  const bar = document.createElement("div");
  bar.className = "tabbar";
  bar.innerHTML = `<div class="tabbar-inner">
    <button type="button" class="tab-btn" data-tab="home">${ICON_HOME}<span>Home</span></button>
    <button type="button" class="tab-btn" data-tab="tags">${ICON_TAG}<span>Tags</span></button>
  </div>`;
  bar.querySelectorAll(".tab-btn").forEach((btn) => {
    if (btn.dataset.tab === active) btn.classList.add("active");
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "home") nav.toHome();
      else nav.toTags();
    });
  });
  root.appendChild(bar);
}
