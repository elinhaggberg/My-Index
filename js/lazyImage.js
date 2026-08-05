import { resolveImageSrc } from "./imageStore.js";

// Shared lazy-loading for the masonry grids used across Home, Tag detail,
// Profile detail, and Search (see snippetCard.js) -- defers the actual
// resolveImageSrc() work (an IndexedDB read + object-URL creation for a
// local upload) until a card's image scrolls near the viewport, instead of
// resolving every image in a grid eagerly the moment it's created. A grid
// of a few hundred snippets would otherwise open a few hundred IndexedDB
// reads and object URLs at once, almost all for cards nobody has scrolled
// to yet.
//
// Only one of these grids is ever mounted in the DOM at a time (route()
// replaces the whole view), and masonry.js's renderMasonry always does a
// full replaceChildren rebuild rather than an incremental append -- so a
// single module-level registry (reset before each rebuild) is enough,
// without needing to track which grid/container a given image belongs to.
let activeUrls = new Set();
let observedImages = new Set();
const pendingRefs = new WeakMap();

const observer = new IntersectionObserver(onIntersect, { rootMargin: "600px 0px" });

function onIntersect(entries) {
  for (const entry of entries) {
    if (!entry.isIntersecting) continue;
    const img = entry.target;
    observer.unobserve(img);
    observedImages.delete(img);
    const ref = pendingRefs.get(img);
    pendingRefs.delete(img);
    if (!ref) continue;
    resolveImageSrc(ref).then((src) => {
      if (src) {
        img.src = src;
        if (src.startsWith("blob:")) activeUrls.add(src);
      } else {
        img.classList.add("hidden");
      }
    });
  }
}

// Call at card-creation time in place of an eager
// resolveImageSrc(ref).then(...) call. Unhides `img` immediately, before
// it's anywhere near the viewport -- a `display: none` element has no
// layout box, so IntersectionObserver can never report it as intersecting
// and it would stay unresolved forever. With no `src` set yet an <img> has
// zero intrinsic size, so this doesn't affect layout before the real image
// resolves; if a card's CSS reserves a fixed box for it instead (an
// aspect-ratio), that box is what masonry.js's column-balancing pass
// measures right after the card is appended -- either way, lazy here only
// means deferring the *resolve*, never the *layout reservation*.
export function lazyLoadImage(img, ref) {
  if (!ref) return;
  img.classList.remove("hidden");
  pendingRefs.set(img, ref);
  observedImages.add(img);
  observer.observe(img);
}

// Call right before a grid is rebuilt (renderMasonry always replaces the
// whole container's children) -- revokes every object URL handed out for
// the previous card set and stops observing any that never scrolled into
// view, so neither leaks across repeated re-renders (filtering, navigating
// away and back, syncing in new data, etc).
export function resetLazyGrid() {
  for (const url of activeUrls) URL.revokeObjectURL(url);
  activeUrls = new Set();
  for (const img of observedImages) observer.unobserve(img);
  observedImages = new Set();
}

// Best-effort storage-quota read for a proactive warning, surfaced before a
// real QuotaExceededError hits mid-upload or mid-sync. Not supported in
// every browser, so callers should treat a null return as "unknown, say
// nothing" rather than an error.
export async function getStorageUsage() {
  if (!navigator.storage?.estimate) return null;
  const { usage, quota } = await navigator.storage.estimate();
  if (!quota) return null;
  return { usage, quota, ratio: usage / quota };
}
