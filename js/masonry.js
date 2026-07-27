// Bin-packs items into flex columns (always adding to the currently
// shortest column) so the grid behaves like real Pinterest masonry instead
// of the top-to-bottom-then-next-column fill plain CSS multi-columns give.
// Columns are attached to `container` before any card is added, so each
// column's real rendered height can be read back with offsetHeight right
// after an append and used for the next placement decision.
export function renderMasonry(container, items, createNode) {
  const columnCount = container.clientWidth >= 420 ? 3 : 2;
  const columns = Array.from({ length: columnCount }, () => {
    const col = document.createElement("div");
    col.className = "pin-col";
    return col;
  });
  container.replaceChildren(...columns);

  for (const item of items) {
    let shortest = 0;
    for (let i = 1; i < columnCount; i++) {
      if (columns[i].offsetHeight < columns[shortest].offsetHeight) shortest = i;
    }
    columns[shortest].appendChild(createNode(item));
  }
}
