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
// Past this length a quote/note reads better as smaller, denser body text
// than at the same size as a short one -- see the .pin-title-compact rule
// in css/style.css. Exported so snippetDetail.js's full-text preview uses
// the same cutoff, rather than the grid card and the detail view
// disagreeing about what counts as "long."
export const COMPACT_CONTENT_THRESHOLD = 240;

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
  if (type.hasTitle) {
    title.textContent = snippet.title || (snippet.url ? hostnameFor(snippet.url) : "Untitled");
    if (snippet.content) {
      const textEl = node.querySelector(".pin-text");
      textEl.textContent = snippet.content;
      if (snippet.content.length > COMPACT_CONTENT_THRESHOLD) textEl.classList.add("pin-title-compact");
      textEl.classList.remove("hidden");
    }
  } else {
    title.textContent = snippet.content || (snippet.url ? hostnameFor(snippet.url) : "Untitled");
    if (type.long) {
      title.classList.add("pin-title-long");
      if ((snippet.content || "").length > COMPACT_CONTENT_THRESHOLD) title.classList.add("pin-title-compact");
    }
  }

  if (type.hasAuthor && snippet.author) {
    const authorEl = node.querySelector(".pin-author");
    authorEl.textContent = `— ${snippet.author}`;
    authorEl.classList.remove("hidden");
  }

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
