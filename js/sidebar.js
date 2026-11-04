// The desktop sidebar: on a wide screen it replaces the bottom tab bar with
// a permanent column on the left -- the same destinations (Home, Profiles,
// Tags, Inbox), plus search and settings, which are tucked into each page's
// top bar on a phone. "Save something" (the phone's +) goes top right. Rendered once, outside #app,
// so it survives every navigation; only which item is active changes.
// CSS decides when it's shown (see "Desktop" in css/style.css).

import { ICON_HOME, ICON_PROFILE, ICON_TAG, ICON_INBOX } from "./icons.js";
import { getInboxNewCount, getShowInboxCount, getHomeTitle, UNCATEGORIZED_TAG_ID } from "./storage.js";

let sidebar = null;

export function renderSidebar(nav, { onNew, onSearch, onSettings }) {
  if (sidebar) return sidebar;
  sidebar = document.createElement("nav");
  sidebar.className = "desktop-sidebar";
  sidebar.setAttribute("aria-label", "Main");
  sidebar.innerHTML = `
    <p class="sidebar-title" id="sidebar-title"></p>
    <div class="sidebar-nav">
      <button type="button" class="sidebar-item" data-tab="home">${ICON_HOME}<span>Home</span></button>
      <button type="button" class="sidebar-item" data-tab="profiles">${ICON_PROFILE}<span>Profiles</span></button>
      <button type="button" class="sidebar-item" data-tab="tags">${ICON_TAG}<span>Tags</span></button>
      <button type="button" class="sidebar-item" data-tab="inbox">${ICON_INBOX}<span>Inbox</span><span class="sidebar-count hidden"></span></button>
    </div>
    <div class="sidebar-footer">
      <button type="button" class="sidebar-item" data-action="search"><svg class="icon icon-line" viewBox="0 0 24 24" aria-hidden="true" stroke-width="2.2" stroke-linecap="round"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M20 20l-4.8-4.8"/></svg><span>Search</span></button>
      <button type="button" class="sidebar-item" data-action="settings"><svg class="icon icon-line" viewBox="0 0 24 24" aria-hidden="true" stroke-width="2.2" stroke-linecap="round"><path d="M3.5 6.5h17M3.5 12h17M3.5 17.5h17"/></svg><span>Settings</span></button>
    </div>`;
  sidebar.querySelector('[data-tab="home"]').addEventListener("click", () => nav.toHome());
  sidebar.querySelector('[data-tab="profiles"]').addEventListener("click", () => nav.toProfiles());
  sidebar.querySelector('[data-tab="tags"]').addEventListener("click", () => nav.toTags());
  sidebar.querySelector('[data-tab="inbox"]').addEventListener("click", () => nav.toTag(UNCATEGORIZED_TAG_ID));
  sidebar.querySelector('[data-action="search"]').addEventListener("click", onSearch);
  sidebar.querySelector('[data-action="settings"]').addEventListener("click", onSettings);
  document.body.appendChild(sidebar);

  // "Save something" sits top right on a wide screen, where its panel
  // slides in from.
  const newBtn = document.createElement("button");
  newBtn.type = "button";
  newBtn.className = "text-btn primary desktop-new-btn";
  newBtn.textContent = "+ Save something";
  newBtn.addEventListener("click", onNew);
  document.body.appendChild(newBtn);
  return sidebar;
}

// Called on every route change: highlights where you are (a profile page
// counts as Profiles, a tag page as Tags) and refreshes the title and count.
export async function updateSidebar(hash) {
  if (!sidebar) return;
  const view = (hash.match(/^#\/([a-z]+)/) || [])[1] || "home";
  const active =
    hash === `#/tag/${UNCATEGORIZED_TAG_ID}` ? "inbox" : view === "tag" ? "tags" : view === "profile" || view === "feed" ? "profiles" : view;
  sidebar.querySelectorAll("[data-tab]").forEach((b) => b.classList.toggle("active", b.dataset.tab === active));
  sidebar.querySelector("#sidebar-title").textContent = getHomeTitle();
  const countEl = sidebar.querySelector(".sidebar-count");
  const count = getShowInboxCount() ? await getInboxNewCount() : 0;
  countEl.textContent = String(count);
  countEl.classList.toggle("hidden", !count);
}
