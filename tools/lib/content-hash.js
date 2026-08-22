// contentHash (CLAUDE.md §8): "a short hash of grid + palette, written by
// the generator. Used to invalidate saved progress when a puzzle is
// regenerated." Shared by create-puzzle.js (writes it) and
// validate-puzzle.js (checks a puzzle file wasn't hand-edited without
// regenerating it) so both always agree on the same value for the same
// grid+palette.

const crypto = require('crypto');

function computeContentHash(palette, grid) {
  const canonical = JSON.stringify({
    palette: palette.map((p) => [p.n, p.hex, p.name]),
    grid,
  });
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 8);
}

module.exports = { computeContentHash };
