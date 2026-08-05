import { hostnameFor } from "./util.js";
import { typeFor } from "./snippetTypes.js";
import { ICON_LINK } from "./icons.js";
import { lazyLoadImage } from "./lazyImage.js";

// Builds one Pinterest-style grid tile from the shared <template id="tpl-pin-card">.
// A snippet's image is either a remote URL fetched via unfurl (a Link/Video
// snippet), or a local upload (an Image snippet, see snippetEditor.js) --
// lazyLoadImage handles both, deferring the actual lookup (async, an
// IndexedDB read for a local upload) until the card scrolls near the
// viewport instead of resolving every image in the grid at once. Most
// snippets have no image at all (this app is a register of links/quotes/
// notes, not a photo library), so there's no fixed-size placeholder box
// standing in for one -- the type icon sits inline next to the title
// instead, sized like a small badge rather than an empty photo.
export function createSnippetNode(snippet, onOpen) {
  const tpl = document.getElementById("tpl-pin-card");
  const node = tpl.content.cloneNode(true);
  const article = node.querySelector(".pin");
  const img = node.querySelector(".pin-media");
  const type = typeFor(snippet.type);

  if (snippet.image) {
    img.alt = "";
    lazyLoadImage(img, snippet.image);
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
