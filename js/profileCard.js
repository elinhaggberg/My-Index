import { resolveImageUrl } from "./imageBlob.js";

// The bigger grid-card version of a Profile, used on the Profiles view and
// in profile search results -- shows more than the Home row's small tile
// (a note/tag preview, not just a name).
export function createProfileCardNode(profile, onOpen) {
  const tpl = document.getElementById("tpl-profile-card");
  const node = tpl.content.cloneNode(true);
  const avatar = node.querySelector(".profile-card-avatar");
  if (profile.image) {
    avatar.style.backgroundImage = `url("${resolveImageUrl(profile.image)}")`;
    avatar.classList.add("has-image");
  } else {
    avatar.textContent = (profile.name || "?").trim().charAt(0).toUpperCase() || "?";
  }
  node.querySelector(".profile-card-name").textContent = profile.name || "Untitled";

  const metaEl = node.querySelector(".profile-card-meta");
  if (profile.note) {
    metaEl.textContent = profile.note;
  } else if (profile.tagIds?.length) {
    metaEl.textContent = `${profile.tagIds.length} tag${profile.tagIds.length !== 1 ? "s" : ""}`;
  } else {
    metaEl.textContent = "No tags yet";
  }

  const badge = node.querySelector(".profile-card-badge");
  if (profile.newCount) {
    badge.textContent = profile.newCount > 99 ? "99+" : String(profile.newCount);
    badge.classList.remove("hidden");
  }

  node.querySelector(".profile-card").addEventListener("click", () => onOpen(profile));
  return node;
}
