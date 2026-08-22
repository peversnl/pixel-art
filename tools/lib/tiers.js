// Difficulty tiers from CLAUDE.md §6. width/height are a target cell
// COUNT (width*height), not a hard aspect ratio — actual output
// dimensions are derived per source image to preserve its aspect ratio.
// minColors/maxColors bound the generator's target palette size.

const TIERS = {
  easy: { width: 20, height: 24, minColors: 6, maxColors: 8 },
  medium: { width: 32, height: 40, minColors: 10, maxColors: 14 },
  hard: { width: 48, height: 60, minColors: 16, maxColors: 24 },
};

module.exports = { TIERS };
