import { hostnameFor } from "./util.js";
import { typeFor } from "./snippetTypes.js";
import { ICON_LINK } from "./icons.js";
import { lazyLoadImage } from "./lazyImage.js";
import { isExcerpt, isSource, pageLabel, getExcerptCount } from "./sources.js";

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

// Cards show a snippet's whole picture (a book cover, a photo) in its own
// proportions rather than cropped to one fixed shape. The grid is laid out
// before images load, so each image's proportions are remembered once
// known (on this device, by image) and reserved straight away the next
// time it's drawn -- keeping the columns even. Very tall images are capped
// so one phone screenshot can't take over a column.
const RATIO_KEY = "mi_image_ratios_v1";
const MAX_REMEMBERED = 500;
const TALLEST = 1.75; // height as a multiple of width

let ratios = null;
function readRatios() {
  if (!ratios) {
    try {
      ratios = JSON.parse(localStorage.getItem(RATIO_KEY) || "{}");
    } catch {
      ratios = {};
    }
  }
  return ratios;
}

function rememberRatio(ref, ratio) {
  const all = readRatios();
  if (all[ref] === ratio) return;
  delete all[ref];
  all[ref] = ratio;
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED))) delete all[k];
  try {
    localStorage.setItem(RATIO_KEY, JSON.stringify(all));
  } catch {
    // Storage full or unavailable -- the image still shows correctly.
  }
}

function applyRatio(img, ratio) {
  img.style.aspectRatio = String(Math.max(ratio, 1 / TALLEST));
}

export function createSnippetNode(snippet, onOpen) {
  const tpl = document.getElementById("tpl-pin-card");
  const node = tpl.content.cloneNode(true);
  const article = node.querySelector(".pin");
  const img = node.querySelector(".pin-media");
  const type = typeFor(snippet.type);

  if (snippet.image) {
    img.alt = "";
    const ref = String(snippet.image);
    const known = readRatios()[ref];
    if (known) applyRatio(img, known);
    img.addEventListener("load", () => {
      if (!img.naturalWidth || !img.naturalHeight) return;
      const ratio = Math.round((img.naturalWidth / img.naturalHeight) * 1000) / 1000;
      applyRatio(img, ratio);
      rememberRatio(ref, ratio);
    });
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

  const page = isExcerpt(snippet) || snippet.sourceId ? pageLabel(snippet.page) : "";
  if ((type.hasAuthor && snippet.author) || page) {
    const authorEl = node.querySelector(".pin-author");
    authorEl.textContent = [type.hasAuthor && snippet.author ? `— ${snippet.author}` : "", page].filter(Boolean).join(", ");
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

  // A source with excerpts says so, so it's visible from the grid that
  // there's more inside.
  if (isSource(snippet)) {
    getExcerptCount(snippet).then((count) => {
      if (!count) return;
      const tally = document.createElement("p");
      tally.className = "pin-excerpt-count";
      tally.textContent = `${count} excerpt${count === 1 ? "" : "s"}`;
      article.querySelector(".pin-body").appendChild(tally);
    });
  }

  article.addEventListener("click", () => onOpen(snippet));
  return node;
}
