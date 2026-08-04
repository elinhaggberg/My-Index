import { resolveImageSrc } from "./imageStore.js";

// Home's top row is a horizontal strip of "app icon" style tiles, one per
// Profile. Falls back to a colored initial monogram, like a contact's
// default avatar, when no photo has been set.
export function createProfileTileNode(profile, onOpen) {
  const tpl = document.getElementById("tpl-profile-tile");
  const node = tpl.content.cloneNode(true);
  const avatar = node.querySelector(".profile-tile-avatar");
  if (profile.image) {
    avatar.classList.add("has-image");
    // Resolved async (an idb: reference needs an IndexedDB lookup) --
    // returning the node synchronously here so the tile itself isn't
    // delayed, the image just fills in a beat later.
    resolveImageSrc(profile.image).then((src) => {
      if (src) avatar.style.backgroundImage = `url("${src}")`;
    });
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
