// Home's top row is a horizontal strip of "app icon" style tiles, one per
// Profile — there's no photo field in the data model (this is a register of
// people/themes, not a photo library), so each tile is just a colored
// initial monogram plus a name label, like a contact's default avatar.
export function createProfileTileNode(profile, onOpen) {
  const tpl = document.getElementById("tpl-profile-tile");
  const node = tpl.content.cloneNode(true);
  const initial = (profile.name || "?").trim().charAt(0).toUpperCase() || "?";
  node.querySelector(".profile-tile-avatar").textContent = initial;
  node.querySelector(".profile-tile-name").textContent = profile.name || "Untitled";

  const badge = node.querySelector(".profile-tile-badge");
  if (profile.newCount) {
    badge.textContent = profile.newCount > 99 ? "99+" : String(profile.newCount);
    badge.classList.remove("hidden");
  }

  node.querySelector(".profile-tile").addEventListener("click", () => onOpen(profile));
  return node;
}
