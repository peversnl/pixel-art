// Despeckle pass (CLAUDE.md §9 step 4 — "essential. Without this, output
// is confetti and unplayable"). Finds 4-connected regions of a flat
// label grid and merges any region smaller than minRegion cells into
// whichever neighboring label borders it most.
//
// Mutates and returns `grid` (a flat, row-major array of label ints,
// background 0 included as an ordinary label for this pass).

function despeckle(grid, width, height, minRegion) {
  const maxIterations = 25;
  let changed = true;
  let iterations = 0;

  while (changed && iterations < maxIterations) {
    changed = false;
    iterations++;
    const visited = new Uint8Array(width * height);

    for (let start = 0; start < grid.length; start++) {
      if (visited[start]) continue;

      const label = grid[start];
      const component = [start];
      visited[start] = 1;
      let head = 0;
      while (head < component.length) {
        const idx = component[head++];
        for (const n of neighbors(idx, width, height)) {
          if (!visited[n] && grid[n] === label) {
            visited[n] = 1;
            component.push(n);
          }
        }
      }

      if (component.length >= minRegion) continue;

      const freq = new Map();
      for (const idx of component) {
        for (const n of neighbors(idx, width, height)) {
          const nLabel = grid[n];
          if (nLabel !== label) freq.set(nLabel, (freq.get(nLabel) || 0) + 1);
        }
      }
      if (freq.size === 0) continue; // whole grid is one region — nothing to merge into

      let bestLabel = null, bestCount = -1;
      for (const [lbl, count] of freq) {
        if (count > bestCount || (count === bestCount && lbl < bestLabel)) {
          bestCount = count;
          bestLabel = lbl;
        }
      }

      for (const idx of component) grid[idx] = bestLabel;
      changed = true;
    }
  }

  return grid;
}

function neighbors(idx, width, height) {
  const x = idx % width;
  const y = (idx / width) | 0;
  const result = [];
  if (x > 0) result.push(idx - 1);
  if (x < width - 1) result.push(idx + 1);
  if (y > 0) result.push(idx - width);
  if (y < height - 1) result.push(idx + width);
  return result;
}

module.exports = { despeckle };
