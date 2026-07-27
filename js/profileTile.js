import { resolveImageUrl } from "./imageBlob.js";

// Home's top row is a horizontal strip of "app icon" style tiles, one per
// Profile. Falls back to a colored initial monogram, like a contact's
// default avatar, when no photo has been set.
export function createProfileTileNode(profile, onOpen) {
  const tpl = document.getElementById("tpl-profile-tile");
  const node = tpl.content.cloneNode(true);
  const avatar = node.querySelector(".profile-tile-avatar");
  if (profile.image) {
    avatar.style.backgroundImage = `url("${resolveImageUrl(profile.image)}")`;
    avatar.classList.add("has-image");
  } else {
    avatar.textContent = (profile.name || "?").trim().charAt(0).toUpperCase() || "?";
  }
  node.querySelector(".profile-tile-name").textContent = profile.name || "Untitled";

  const badge = node.querySelector(".profile-tile-badge");
  if (profile.newCount) {
    badge.textContent = profile.newCount > 99 ? "99+" : String(profile.newCount);
    badge.classList.remove("hidden");
  }

  node.querySelector(".profile-tile").addEventListener("click", () => onOpen(profile));
  return node;
}
