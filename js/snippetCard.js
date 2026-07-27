import { hostnameFor } from "./util.js";
import { typeFor } from "./snippetTypes.js";
import { ICON_LINK } from "./icons.js";

// Builds one Pinterest-style grid tile from the shared <template id="tpl-pin-card">.
// Unlike My Closet's cards, a snippet's image (when it has one at all) is
// always a remote URL fetched via unfurl -- never a local upload -- so
// there's no IndexedDB blob to resolve async here; the <img> can just be
// set directly. Most snippets have no image at all (this app is a register
// of links/quotes/notes, not a photo library), so there's no fixed-size
// placeholder box standing in for one -- the type icon sits inline next to
// the title instead, sized like a small badge rather than an empty photo.
export function createSnippetNode(snippet, onOpen) {
  const tpl = document.getElementById("tpl-pin-card");
  const node = tpl.content.cloneNode(true);
  const article = node.querySelector(".pin");
  const img = node.querySelector(".pin-media");
  const type = typeFor(snippet.type);

  if (snippet.image) {
    img.src = snippet.image;
    img.alt = "";
    img.classList.remove("hidden");
  }

  node.querySelector(".pin-type-icon").innerHTML = type.icon;

  const title = node.querySelector(".pin-title");
  title.textContent = snippet.content || (snippet.url ? hostnameFor(snippet.url) : "Untitled");

  const sourceEl = node.querySelector(".pin-source");
  const source = snippet.siteName || hostnameFor(snippet.url);
  if (source) {
    sourceEl.innerHTML = `${ICON_LINK}<span>${source}</span>`;
    sourceEl.classList.remove("hidden");
  }

  if (snippet.comment) {
    const comment = document.createElement("p");
    comment.className = "pin-comment";
    comment.textContent = snippet.comment;
    node.querySelector(".pin-body").appendChild(comment);
  }

  article.addEventListener("click", () => onOpen(snippet));
  return node;
}
