// Bin-packs items into flex columns (always adding to the currently
// shortest column) so the grid behaves like real Pinterest masonry instead
// of the top-to-bottom-then-next-column fill plain CSS multi-columns give.
// Columns are attached to `container` before any card is added, so each
// column's real rendered height can be read back with offsetHeight right
// after an append and used for the next placement decision.
function columnCountFor(width) {
  // Favors 2 wider columns over 3 narrower ones up to a higher width than
  // before -- these cards are mostly text (links/quotes/notes), so more
  // width per card means more of that text is visible before it clamps.
  // On a wide screen, as many ~260px columns as fit (up to 5), so a desktop
  // window shows more at once rather than three stretched-out columns.
  return width >= 900 ? Math.min(5, Math.max(3, Math.floor(width / 260))) : width >= 560 ? 3 : 2;
}

function layout(container, nodes, columnCount) {
  const columns = Array.from({ length: columnCount }, () => {
    const col = document.createElement("div");
    col.className = "pin-col";
    return col;
  });
  container.replaceChildren(...columns);
  for (const node of nodes) {
    let shortest = 0;
    for (let i = 1; i < columnCount; i++) {
      if (columns[i].offsetHeight < columns[shortest].offsetHeight) shortest = i;
    }
    columns[shortest].appendChild(node);
  }
  container.dataset.columns = String(columnCount);
}

// One observer per grid: when the grid gets wide or narrow enough for a
// different number of columns (a resized window, the desktop side panel
// opening), the same cards are dealt out again -- moved, not rebuilt.
const observed = new WeakMap();

export function renderMasonry(container, items, createNode) {
  // A card template's clone is a DocumentFragment, which empties itself
  // when appended -- keep the element inside it, so a re-layout can move it.
  const nodes = items.map((item) => {
    const node = createNode(item);
    return node instanceof DocumentFragment && node.childElementCount === 1 ? node.firstElementChild : node;
  });
  // Placed one at a time so each column's real height is known for the next.
  layout(container, nodes, columnCountFor(container.clientWidth));

  if (!observed.has(container) && "ResizeObserver" in window) {
    const ro = new ResizeObserver(() => {
      if (!container.isConnected) {
        ro.disconnect();
        return;
      }
      const count = columnCountFor(container.clientWidth);
      if (String(count) !== container.dataset.columns) layout(container, observed.get(container).nodes, count);
    });
    observed.set(container, { ro, nodes });
    ro.observe(container);
  } else if (observed.has(container)) {
    observed.get(container).nodes = nodes;
  }
}
