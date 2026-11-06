import { getTags, getProfiles, getSnippets } from "../storage.js";
import { renderTabbar } from "../tabbar.js";
import { openSettingsMenu } from "../settingsMenu.js";
import { resolveImageSrc } from "../imageStore.js";

export async function renderTags(root, nav) {
  const tpl = document.getElementById("tpl-tags");
  root.replaceChildren(tpl.content.cloneNode(true));
  renderTabbar(root, nav, "tags");

  document.getElementById("settings-btn").addEventListener("click", () => openSettingsMenu(nav, () => renderTags(root, nav)));

  const [tags, profiles, snippets] = await Promise.all([getTags(), getProfiles(), getSnippets()]);

  function countFor(tagId) {
    const p = profiles.filter((x) => x.tagIds?.includes(tagId)).length;
    const s = snippets.filter((x) => x.tagIds?.includes(tagId)).length;
    return p + s;
  }

  const grid = document.getElementById("tags-grid");
  // Navigated away while the tags were loading.
  if (!grid) return;
  // The Inbox has its own tab now (see js/tabbar.js), so it isn't listed
  // here among the themes.
  const entries = tags.map((t) => ({ tag: t, count: countFor(t.id) }));

  if (tags.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No themes yet. Tag a profile or a snippet to start building your index.";
    grid.replaceChildren(empty);
    return;
  }

  grid.replaceChildren(
    ...entries.map(({ tag, count }) => {
      const tpl2 = document.getElementById("tpl-tag-tile");
      const node = tpl2.content.cloneNode(true);
      const iconBox = node.querySelector(".tag-tile-icon");
      if (tag.image) {
        iconBox.classList.add("has-image");
        resolveImageSrc(tag.image).then((src) => {
          if (src) iconBox.style.backgroundImage = `url("${src}")`;
        });
      }
      node.querySelector(".tag-tile-title").textContent = tag.name;
      node.querySelector(".tag-tile-meta").textContent = `${count} item${count !== 1 ? "s" : ""}`;
      node.querySelector(".tag-tile").addEventListener("click", () => nav.toTag(tag.id));
      return node;
    })
  );
}
