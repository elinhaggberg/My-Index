import { ICON_HOME, ICON_PROFILE, ICON_TAG, ICON_INBOX } from "./icons.js";
import { getInboxNewCount, getShowInboxCount, UNCATEGORIZED_TAG_ID } from "./storage.js";

// Rendered fresh into #app after every route's replaceChildren() call, since
// #app's content is fully replaced on navigation. Position is fixed via CSS
// so DOM order relative to the page content underneath doesn't matter.
//
// The Inbox is a tab of its own rather than one tile among the Tags: it's
// where new, untagged things wait to be sorted, not a theme. Its count is
// optional and off by default (Customize), and counts only what's new since
// the Inbox was last marked as reviewed.
export function renderTabbar(root, nav, active) {
  const bar = document.createElement("div");
  bar.className = "tabbar";
  bar.innerHTML = `<div class="tabbar-inner">
    <button type="button" class="tab-btn" data-tab="home">${ICON_HOME}<span>Home</span></button>
    <button type="button" class="tab-btn" data-tab="profiles">${ICON_PROFILE}<span>Profiles</span></button>
    <button type="button" class="tab-btn" data-tab="tags">${ICON_TAG}<span>Tags</span></button>
    <button type="button" class="tab-btn" data-tab="inbox"><span class="tab-icon-wrap">${ICON_INBOX}<span class="tab-badge hidden"></span></span><span>Inbox</span></button>
  </div>`;
  bar.querySelectorAll(".tab-btn").forEach((btn) => {
    if (btn.dataset.tab === active) btn.classList.add("active");
    btn.addEventListener("click", () => {
      if (btn.dataset.tab === "home") nav.toHome();
      else if (btn.dataset.tab === "profiles") nav.toProfiles();
      else if (btn.dataset.tab === "inbox") nav.toTag(UNCATEGORIZED_TAG_ID);
      else nav.toTags();
    });
  });
  root.appendChild(bar);

  refreshInboxBadge(bar);
}

export async function refreshInboxBadge(scope = document) {
  const badge = scope.querySelector(".tab-badge");
  if (!badge) return;
  const count = getShowInboxCount() ? await getInboxNewCount() : 0;
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", !count);
}
