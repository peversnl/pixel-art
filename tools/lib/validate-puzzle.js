// Structural validation for a single puzzle object (CLAUDE.md §9). Shared
// by tools/create-puzzle.js (refuses to write on failure) and
// tools/validate-puzzles.js (checks every puzzle in the manifest).
//
// Repo-level checks that need more than one puzzle object — duplicate
// ids across files, manifest entries with no matching file, thumbnail
// files that don't exist on disk — are the caller's responsibility, since
// this function only sees one puzzle at a time.

const { hexToRgb, rgbToLab, deltaE76 } = require('./color');
const { computeContentHash } = require('./content-hash');

const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DIFFICULTIES = new Set(['easy', 'medium', 'hard']);

// 4-connected flood fill over the grid. Used to catch two kinds of
// "confetti" that neither quantization nor hand-authoring should produce:
// a palette color that barely exists (probably a stray pixel), and a grid
// that's mostly isolated single cells (probably a failed despeckle pass,
// or hand-authored art drawn too fine for the grid).
function analyzeRegions(grid, width, height) {
  const visited = new Array(width * height).fill(false);
  const cellCounts = new Map(); // n -> total cell count anywhere in the grid
  let totalFillable = 0;
  let isolatedSingleCell = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = grid[y][x];
      if (v === 0) continue;
      totalFillable++;
      cellCounts.set(v, (cellCounts.get(v) || 0) + 1);

      const idx = y * width + x;
      if (visited[idx]) continue;
      visited[idx] = true;
      const stack = [[x, y]];
      let size = 0;
      while (stack.length > 0) {
        const [cx, cy] = stack.pop();
        size++;
        const neighbors = [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]];
        for (const [nx, ny] of neighbors) {
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const nIdx = ny * width + nx;
          if (visited[nIdx] || grid[ny][nx] !== v) continue;
          visited[nIdx] = true;
          stack.push([nx, ny]);
        }
      }
      if (size === 1) isolatedSingleCell++;
    }
  }

  return { totalFillable, isolatedSingleCell, cellCounts };
}

function validatePuzzleStructure(puzzle) {
  const errors = [];
  const { width, height, grid, palette } = puzzle;

  if (puzzle.schemaVersion !== 1) {
    errors.push(`schemaVersion must be 1, got ${JSON.stringify(puzzle.schemaVersion)}`);
  }
  if (typeof puzzle.id !== 'string' || !KEBAB_CASE.test(puzzle.id)) {
    errors.push(`id must be a lowercase kebab-case string, got ${JSON.stringify(puzzle.id)}`);
  }
  if (typeof puzzle.title !== 'string' || puzzle.title.trim() === '') {
    errors.push('title is missing or empty');
  }
  if (!DIFFICULTIES.has(puzzle.difficulty)) {
    errors.push(`difficulty must be one of easy/medium/hard, got ${JSON.stringify(puzzle.difficulty)}`);
  }

  if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
    errors.push(`invalid width/height: ${width}x${height}`);
  }

  if (!Array.isArray(grid) || grid.length !== height) {
    errors.push(`grid has ${Array.isArray(grid) ? grid.length : 'invalid'} rows, expected height=${height}`);
  } else {
    for (let y = 0; y < grid.length; y++) {
      const row = grid[y];
      if (!Array.isArray(row) || row.length !== width) {
        errors.push(`grid row ${y} has ${Array.isArray(row) ? row.length : 'invalid'} cells, expected width=${width}`);
      }
    }
  }

  if (!puzzle.thumbnail || typeof puzzle.thumbnail !== 'string') {
    errors.push('missing thumbnail path');
  }

  if (!Array.isArray(palette) || palette.length === 0) {
    errors.push('palette is empty or missing');
    return errors; // nothing further can be checked without a palette
  }

  const paletteNumbers = new Set();
  const labs = [];
  for (const entry of palette) {
    if (typeof entry.n !== 'number' || entry.n <= 0) {
      errors.push(`palette entry has invalid n: ${JSON.stringify(entry)}`);
    }
    if (entry.n === 0) {
      errors.push('palette must not contain an entry for n=0 — 0 is reserved for background and is never fillable');
    }
    const rgb = hexToRgb(entry.hex || '');
    if (!rgb) {
      errors.push(`palette entry n=${entry.n} has invalid hex: ${entry.hex}`);
    } else {
      labs.push({ n: entry.n, lab: rgbToLab(rgb.r, rgb.g, rgb.b) });
    }
    if (!entry.name || typeof entry.name !== 'string') {
      errors.push(`palette entry n=${entry.n} is missing a name`);
    }
    if (paletteNumbers.has(entry.n)) {
      errors.push(`palette has duplicate entry n=${entry.n}`);
    }
    paletteNumbers.add(entry.n);
  }

  const used = new Set();
  if (Array.isArray(grid)) {
    for (const row of grid) {
      if (!Array.isArray(row)) continue;
      for (const cell of row) {
        if (cell === 0) continue;
        used.add(cell);
        if (!paletteNumbers.has(cell)) {
          errors.push(`grid contains number ${cell} that is not in the palette`);
        }
      }
    }
  }
  for (const n of paletteNumbers) {
    if (!used.has(n)) errors.push(`palette entry n=${n} never appears in the grid`);
  }

  const gridIsRectangular =
    Array.isArray(grid) && grid.length === height && grid.every((row) => Array.isArray(row) && row.length === width);
  if (gridIsRectangular && typeof width === 'number' && typeof height === 'number') {
    const { totalFillable, isolatedSingleCell, cellCounts } = analyzeRegions(grid, width, height);

    for (const n of paletteNumbers) {
      const count = cellCounts.get(n) || 0;
      if (count > 0 && count < 4) {
        errors.push(`palette entry n=${n} occupies only ${count} cell(s) total — likely an artifact (minimum 4)`);
      }
    }

    if (totalFillable > 0) {
      const pct = (isolatedSingleCell / totalFillable) * 100;
      if (pct > 15) {
        errors.push(
          `${isolatedSingleCell} of ${totalFillable} fillable cells (${pct.toFixed(1)}%) are isolated single-cell regions — looks like confetti (threshold 15%)`
        );
      }
    }
  }

  for (let i = 0; i < labs.length; i++) {
    for (let j = i + 1; j < labs.length; j++) {
      const d = deltaE76(labs[i].lab, labs[j].lab);
      if (d < 10) {
        errors.push(
          `palette entries n=${labs[i].n} and n=${labs[j].n} are too similar (dE=${d.toFixed(1)}, threshold 10)`
        );
      }
    }
  }

  if (typeof puzzle.contentHash !== 'string' || puzzle.contentHash === '') {
    errors.push('missing contentHash');
  } else if (Array.isArray(grid) && Array.isArray(palette)) {
    const expected = computeContentHash(palette, grid);
    if (expected !== puzzle.contentHash) {
      errors.push(
        `contentHash is stale: stored "${puzzle.contentHash}" but grid+palette hash to "${expected}" — regenerate this puzzle`
      );
    }
  }

  return errors;
}

module.exports = { validatePuzzleStructure };
