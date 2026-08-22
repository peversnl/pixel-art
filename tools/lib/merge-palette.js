// ΔE palette merge (CLAUDE.md §9 step 5 — "two near-identical pinks are
// indistinguishable to a child"). Repeatedly merges the closest pair of
// palette entries while their distance is under the threshold, folding
// the smaller region into the larger and re-averaging its color.
//
// `palette` is a Map<label, {lab, count}> (background label 0 excluded).
// Mutates `grid` in place and returns the (also mutated) palette map.

const { deltaE76 } = require('./color');

function mergeClosePalette(grid, palette, threshold) {
  let labels = [...palette.keys()];

  let merged = true;
  while (merged && labels.length > 1) {
    merged = false;
    let bestPair = null;
    let bestDist = Infinity;

    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const d = deltaE76(palette.get(labels[i]).lab, palette.get(labels[j]).lab);
        if (d < bestDist) {
          bestDist = d;
          bestPair = [labels[i], labels[j]];
        }
      }
    }

    if (bestPair && bestDist < threshold) {
      const [a, b] = bestPair;
      const pa = palette.get(a), pb = palette.get(b);
      const keep = pa.count >= pb.count ? a : b;
      const drop = keep === a ? b : a;
      const keepEntry = palette.get(keep), dropEntry = palette.get(drop);
      const totalCount = keepEntry.count + dropEntry.count;

      const newLab = {
        l: (keepEntry.lab.l * keepEntry.count + dropEntry.lab.l * dropEntry.count) / totalCount,
        a: (keepEntry.lab.a * keepEntry.count + dropEntry.lab.a * dropEntry.count) / totalCount,
        b: (keepEntry.lab.b * keepEntry.count + dropEntry.lab.b * dropEntry.count) / totalCount,
      };

      palette.set(keep, { lab: newLab, count: totalCount });
      palette.delete(drop);
      for (let i = 0; i < grid.length; i++) {
        if (grid[i] === drop) grid[i] = keep;
      }

      labels = [...palette.keys()];
      merged = true;
    }
  }

  return palette;
}

module.exports = { mergeClosePalette };
