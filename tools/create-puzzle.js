#!/usr/bin/env node
// PixelKleur puzzle generator (CLAUDE.md §9).
//
//   node tools/create-puzzle.js input.png --difficulty medium --id poes-wolbol --title "Poes met wolbol"
//   node tools/create-puzzle.js art.png --native --palette art-palette.json --id poes-wolbol --title "Poes met wolbol"
//
// Two modes:
//   - photo (default): downsample (box average) -> background detection ->
//     Lab-space median-cut quantization -> despeckle -> ΔE palette merge ->
//     Dutch color names -> validate -> write.
//   - native (--native): the PNG is already exactly the tier's grid size
//     and uses only the exact hex values in --palette. Read 1:1 — no
//     resampling, no quantization, no despeckle. An unmatched color or a
//     dimension mismatch is an error, never silently coerced.
//
// Both modes end the same way: validate -> write puzzle JSON + thumbnail +
// manifest entry.

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline/promises');
const { spawn } = require('child_process');
const { PNG } = require('pngjs');

const { loadImage } = require('./lib/image');
const { rgbToLab, labToRgb, deltaE76, hexToRgb, rgbToHex } = require('./lib/color');
const { NAMED_COLORS } = require('./lib/color-names');
const { TIERS } = require('./lib/tiers');
const { medianCut } = require('./lib/median-cut');
const { despeckle } = require('./lib/despeckle');
const { mergeClosePalette } = require('./lib/merge-palette');
const { validatePuzzleStructure } = require('./lib/validate-puzzle');
const { computeContentHash } = require('./lib/content-hash');

const ROOT = path.join(__dirname, '..');
const PUZZLES_DIR = path.join(ROOT, 'puzzles');
const THUMBS_DIR = path.join(ROOT, 'thumbs');
const MANIFEST_PATH = path.join(PUZZLES_DIR, 'manifest.json');
const SW_PATH = path.join(ROOT, 'sw.js');

const USAGE = `Usage:
  node tools/create-puzzle.js <input.png|input.jpg> --id <slug> --title "<Title>" [options]
  node tools/create-puzzle.js <input.png> --native --palette <file.json> --id <slug> --title "<Title>" [options]

Options:
  --difficulty <easy|medium|hard>  Grid size / color count tier (default: medium)
  --force                          Overwrite an existing puzzle with the same id
  --preview                        Open a preview in the browser before writing
  --help                           Show this help

Photo mode (default) options:
  --bg <#hex>                      Background color to key out — only used when
                                    the source has no meaningful alpha channel
  --colors <n>                     Override the tier's target color count
  --min-region <n>                 Despeckle threshold in cells (default: 3)

Native mode options:
  --native                         Read the input PNG 1:1 — no resampling,
                                    quantization, or despeckle. The PNG must
                                    already be exactly the tier's grid size
                                    and use only the palette's exact hex
                                    values. --bg/--colors/--min-region don't
                                    apply and are rejected in this mode.
  --palette <file.json>            Required with --native. A JSON array of
                                    { "n": 1, "hex": "#RRGGBB", "name": "blauw" }
`;

function fail(msg) {
  console.error(`Error: ${msg}`);
  process.exit(1);
}

function parseArgs(argv) {
  const opts = { difficulty: 'medium', minRegion: 3, force: false, preview: false };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case '--difficulty': opts.difficulty = argv[++i]; break;
      case '--id': opts.id = argv[++i]; break;
      case '--title': opts.title = argv[++i]; break;
      case '--bg': opts.bg = argv[++i]; break;
      case '--min-region': opts.minRegion = parseInt(argv[++i], 10); opts.minRegionGiven = true; break;
      case '--colors': opts.colors = parseInt(argv[++i], 10); opts.colorsGiven = true; break;
      case '--native': opts.native = true; break;
      case '--palette': opts.palette = argv[++i]; break;
      case '--force': opts.force = true; break;
      case '--preview': opts.preview = true; break;
      case '--help': case '-h': opts.help = true; break;
      default:
        if (a.startsWith('--')) throw new Error(`Unknown flag: ${a}`);
        positional.push(a);
    }
  }
  opts.input = positional[0];
  return opts;
}

// ---- grid sizing -----------------------------------------------------
// Tier width/height is a target cell COUNT; actual output dimensions
// preserve the source image's aspect ratio (CLAUDE.md §9 step 1).
function computeGridSize(srcW, srcH, tier) {
  const targetArea = tier.width * tier.height;
  const aspect = srcW / srcH;
  let h = Math.round(Math.sqrt(targetArea / aspect));
  let w = Math.round(h * aspect);
  w = Math.max(4, w);
  h = Math.max(4, h);
  return { width: w, height: h };
}

// ---- downsample + background detection --------------------------------
function downsample(source, width, height, bgHex) {
  const { width: srcW, height: srcH, data } = source;

  let hasAlpha = false;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 250) { hasAlpha = true; break; }
  }

  let bgLab = null;
  if (!hasAlpha && bgHex) {
    const rgb = hexToRgb(bgHex);
    bgLab = rgbToLab(rgb.r, rgb.g, rgb.b);
  }

  const cells = new Array(width * height);
  for (let oy = 0; oy < height; oy++) {
    const y0 = Math.floor((oy * srcH) / height);
    const y1 = Math.max(y0 + 1, Math.floor(((oy + 1) * srcH) / height));
    for (let ox = 0; ox < width; ox++) {
      const x0 = Math.floor((ox * srcW) / width);
      const x1 = Math.max(x0 + 1, Math.floor(((ox + 1) * srcW) / width));

      let sumR = 0, sumG = 0, sumB = 0, sumA = 0, count = 0;
      for (let y = y0; y < y1 && y < srcH; y++) {
        for (let x = x0; x < x1 && x < srcW; x++) {
          const idx = (y * srcW + x) * 4;
          const a = data[idx + 3];
          sumR += data[idx] * a;
          sumG += data[idx + 1] * a;
          sumB += data[idx + 2] * a;
          sumA += a;
          count++;
        }
      }

      const avgAlpha = count > 0 ? sumA / count : 0;
      let r = 0, g = 0, b = 0;
      if (sumA > 0) { r = sumR / sumA; g = sumG / sumA; b = sumB / sumA; }
      const lab = rgbToLab(r, g, b);

      let background;
      if (hasAlpha) {
        background = avgAlpha < 255 * 0.12;
      } else if (bgLab) {
        background = deltaE76(lab, bgLab) < 12;
      } else {
        background = false;
      }

      cells[oy * width + ox] = { lab, background };
    }
  }

  return cells;
}

// ---- native mode (CLAUDE.md §9 "Native mode") --------------------------
function loadNativePalette(paletteFilePath) {
  if (!fs.existsSync(paletteFilePath)) fail(`palette file not found: ${paletteFilePath}`);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(paletteFilePath, 'utf8'));
  } catch (err) {
    fail(`palette file is not valid JSON: ${err.message}`);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail('palette file must be a non-empty JSON array of { "n": 1, "hex": "#RRGGBB", "name": "blauw" }');
  }

  const seenN = new Set();
  const seenHex = new Set();
  return parsed.map((entry, idx) => {
    if (typeof entry.n !== 'number' || !Number.isInteger(entry.n) || entry.n <= 0) {
      fail(`palette file entry ${idx}: "n" must be a positive integer, got ${JSON.stringify(entry.n)}`);
    }
    if (seenN.has(entry.n)) fail(`palette file has duplicate n=${entry.n}`);
    seenN.add(entry.n);

    const rgb = hexToRgb(entry.hex);
    if (!rgb) fail(`palette file entry n=${entry.n}: invalid hex "${entry.hex}"`);
    const hex = rgbToHex(rgb.r, rgb.g, rgb.b);
    if (seenHex.has(hex)) fail(`palette file has duplicate color ${hex} (n=${entry.n})`);
    seenHex.add(hex);

    if (!entry.name || typeof entry.name !== 'string') fail(`palette file entry n=${entry.n}: missing "name"`);

    return { n: entry.n, hex, name: entry.name };
  });
}

// Reads the source 1:1 and maps each pixel to a palette number by exact
// hex match. Fully transparent -> 0. Anything else that doesn't match
// exactly is collected and reported as an error — never snapped to the
// nearest color, per CLAUDE.md §9.
function buildNativeGrid(source, width, height, palette) {
  const hexToN = new Map(palette.map((p) => [p.hex, p.n]));
  const { data } = source;
  const grid = new Array(width * height).fill(0);
  const unmatched = new Map(); // hex -> { count, x, y } of first occurrence

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const a = data[idx + 3];
      if (a === 0) continue; // stays 0 (background)
      if (a !== 255) {
        fail(
          `pixel at (${x}, ${y}) has partial transparency (alpha=${a}) — native mode requires every ` +
            'pixel to be either fully transparent or fully opaque'
        );
      }
      const hex = rgbToHex(data[idx], data[idx + 1], data[idx + 2]);
      const n = hexToN.get(hex);
      if (n === undefined) {
        if (!unmatched.has(hex)) unmatched.set(hex, { count: 0, x, y });
        unmatched.get(hex).count++;
        continue;
      }
      grid[y * width + x] = n;
    }
  }

  if (unmatched.size > 0) {
    console.error('\nError: source image contains colors that are not in the palette file:');
    for (const [hex, info] of unmatched) {
      console.error(`  ${hex} — ${info.count} pixel(s), first at (${info.x}, ${info.y})`);
    }
    console.error(
      '\nEvery pixel must be fully transparent or an exact match to a --palette hex value.\n' +
        'Fix the art or the palette file — this tool will not snap to the nearest color.'
    );
    process.exit(1);
  }

  return grid;
}

function buildNativePuzzle(opts, tier) {
  const palette = loadNativePalette(opts.palette);

  console.log(`Loading ${opts.input} (native, 1:1)...`);
  const source = loadImage(opts.input);
  if (source.width !== tier.width || source.height !== tier.height) {
    fail(
      `native mode requires the source PNG to be exactly ${tier.width}x${tier.height} for ` +
        `difficulty "${opts.difficulty}" (got ${source.width}x${source.height}). Native art is read 1:1 — no resizing.`
    );
  }
  const { width, height } = tier;

  console.log(`Mapping ${width * height} pixels to ${palette.length} palette colors by exact hex match...`);
  const flatGrid = buildNativeGrid(source, width, height, palette);

  const puzzle = {
    schemaVersion: 1,
    id: opts.id,
    title: opts.title,
    difficulty: opts.difficulty,
    width,
    height,
    contentHash: '',
    thumbnail: `thumbs/${opts.id}.png`,
    palette,
    grid: toRows(flatGrid, width, height),
  };
  puzzle.contentHash = computeContentHash(puzzle.palette, puzzle.grid);

  const thumbBuffer = renderThumbnail(flatGrid, width, height, palette);
  return { puzzle, thumbBuffer };
}

// ---- palette bookkeeping ----------------------------------------------
function buildPaletteStats(grid, cells) {
  const sums = new Map(); // label -> {sumL,sumA,sumB,count}
  for (let i = 0; i < grid.length; i++) {
    const label = grid[i];
    if (label === 0) continue;
    const lab = cells[i].lab;
    if (!sums.has(label)) sums.set(label, { sumL: 0, sumA: 0, sumB: 0, count: 0 });
    const s = sums.get(label);
    s.sumL += lab.l; s.sumA += lab.a; s.sumB += lab.b; s.count++;
  }
  const stats = new Map();
  for (const [label, s] of sums) {
    stats.set(label, { lab: { l: s.sumL / s.count, a: s.sumA / s.count, b: s.sumB / s.count }, count: s.count });
  }
  return stats;
}

function relabel(grid, palette) {
  const entries = [...palette.entries()].map(([oldLabel, stat]) => ({ oldLabel, ...stat }));
  entries.sort((a, b) => b.count - a.count || a.oldLabel - b.oldLabel);
  const mapping = new Map();
  entries.forEach((e, idx) => mapping.set(e.oldLabel, idx + 1));
  const finalGrid = grid.map((label) => (label === 0 ? 0 : mapping.get(label)));
  const finalPalette = entries.map((e, idx) => ({ n: idx + 1, lab: e.lab }));
  return { finalGrid, finalPalette };
}

// ---- Dutch color names --------------------------------------------------
let namedColorsLab = null;
function nearestColorName(lab) {
  if (!namedColorsLab) {
    namedColorsLab = NAMED_COLORS.map((c) => {
      const rgb = hexToRgb(c.hex);
      return { name: c.name, lab: rgbToLab(rgb.r, rgb.g, rgb.b) };
    });
  }
  let best = namedColorsLab[0], bestDist = Infinity;
  for (const c of namedColorsLab) {
    const d = deltaE76(lab, c.lab);
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best.name;
}

// ---- misc helpers ---------------------------------------------------------
function toRows(flatGrid, width, height) {
  const rows = [];
  for (let y = 0; y < height; y++) rows.push(flatGrid.slice(y * width, (y + 1) * width));
  return rows;
}

function renderThumbnail(finalGrid, width, height, namedPalette) {
  const cellSize = Math.max(2, Math.min(16, Math.round(320 / Math.max(width, height))));
  const thumbW = width * cellSize, thumbH = height * cellSize;
  const png = new PNG({ width: thumbW, height: thumbH });
  const colorByN = new Map(namedPalette.map((p) => [p.n, hexToRgb(p.hex)]));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const label = finalGrid[y * width + x];
      const rgb = label === 0 ? null : colorByN.get(label);
      for (let dy = 0; dy < cellSize; dy++) {
        for (let dx = 0; dx < cellSize; dx++) {
          const px = x * cellSize + dx, py = y * cellSize + dy;
          const idx = (py * thumbW + px) * 4;
          if (rgb) {
            png.data[idx] = rgb.r; png.data[idx + 1] = rgb.g; png.data[idx + 2] = rgb.b; png.data[idx + 3] = 255;
          } else {
            png.data[idx] = 0; png.data[idx + 1] = 0; png.data[idx + 2] = 0; png.data[idx + 3] = 0;
          }
        }
      }
    }
  }

  return PNG.sync.write(png);
}

function readManifest() {
  if (!fs.existsSync(MANIFEST_PATH)) return { schemaVersion: 1, puzzles: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
    if (!Array.isArray(parsed.puzzles)) throw new Error('"puzzles" is not an array');
    return parsed;
  } catch (err) {
    fail(`could not read puzzles/manifest.json: ${err.message}`);
  }
}

// ---- service worker bookkeeping (CLAUDE.md §12) ------------------------
// sw.js has no static list of puzzle files — precachePuzzles() reads
// puzzles/manifest.json at install time and dynamically fetches every
// listed puzzle + its thumbnail. So a new puzzle is precached automatically
// as long as (a) it's in the manifest and (b) its thumbnail exists on disk.
// What does NOT happen automatically is already-installed clients noticing
// there's anything new to install — that only happens when CACHE_VERSION
// changes, so this bumps it on every successful puzzle add.
function bumpCacheVersion() {
  const src = fs.readFileSync(SW_PATH, 'utf8');
  const match = src.match(/const CACHE_VERSION = "v(\d+)";/);
  if (!match) fail(`could not find CACHE_VERSION in ${SW_PATH} — bump it by hand`);
  const next = parseInt(match[1], 10) + 1;
  const updated = src.replace(/const CACHE_VERSION = "v\d+";/, `const CACHE_VERSION = "v${next}";`);
  fs.writeFileSync(SW_PATH, updated);
  console.log(`Bumped sw.js CACHE_VERSION: v${match[1]} -> v${next}.`);
}

function confirmPrecached(puzzleFilename, puzzle) {
  const manifest = readManifest();
  if (!manifest.puzzles.includes(puzzleFilename)) {
    fail(`puzzles/manifest.json does not list ${puzzleFilename} — sw.js will not precache it`);
  }
  const thumbPath = path.join(ROOT, puzzle.thumbnail);
  if (!fs.existsSync(thumbPath)) {
    fail(`${puzzle.thumbnail} is missing — sw.js precachePuzzles() will skip this puzzle's thumbnail`);
  }
  console.log(
    `Confirmed: sw.js will precache puzzles/${puzzleFilename} and ${puzzle.thumbnail} ` +
      '(discovered dynamically via manifest.json, no static list to edit).'
  );
}

// ---- preview (optional) ---------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function buildPreviewHtml(puzzle) {
  const dataJson = JSON.stringify(puzzle).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Preview: ${escapeHtml(puzzle.title)}</title>
<style>
  body { font-family: sans-serif; background: #222; color: #eee; padding: 16px; }
  canvas { border: 1px solid #555; image-rendering: pixelated; }
  .row { display: flex; flex-wrap: wrap; gap: 24px; }
  .legend { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; max-width: 900px; }
  .swatch { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: #333; border-radius: 4px; }
  .swatch .dot { width: 18px; height: 18px; border-radius: 3px; border: 1px solid #000; flex: none; }
</style>
</head>
<body>
  <h1>${escapeHtml(puzzle.title)} <small>(${puzzle.id}, ${puzzle.width}x${puzzle.height}, ${puzzle.palette.length} colors)</small></h1>
  <div class="row">
    <div><h3>Filled</h3><canvas id="filled"></canvas></div>
    <div><h3>Numbered (start state)</h3><canvas id="numbered"></canvas></div>
  </div>
  <div class="legend" id="legend"></div>
<script>
const puzzle = ${dataJson};
const CELL = 20;

function drawFilled() {
  const c = document.getElementById('filled');
  c.width = puzzle.width * CELL;
  c.height = puzzle.height * CELL;
  const ctx = c.getContext('2d');
  const byN = new Map(puzzle.palette.map(p => [p.n, p.hex]));
  for (let y = 0; y < puzzle.height; y++) {
    for (let x = 0; x < puzzle.width; x++) {
      const n = puzzle.grid[y][x];
      ctx.fillStyle = n === 0 ? '#ffffff' : byN.get(n);
      ctx.fillRect(x * CELL, y * CELL, CELL, CELL);
    }
  }
}

function drawNumbered() {
  const c = document.getElementById('numbered');
  c.width = puzzle.width * CELL;
  c.height = puzzle.height * CELL;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = '#ccc';
  ctx.font = (CELL * 0.55) + 'px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let y = 0; y < puzzle.height; y++) {
    for (let x = 0; x < puzzle.width; x++) {
      const n = puzzle.grid[y][x];
      ctx.strokeRect(x * CELL, y * CELL, CELL, CELL);
      if (n !== 0) {
        ctx.fillStyle = '#333';
        ctx.fillText(String(n), x * CELL + CELL / 2, y * CELL + CELL / 2);
      }
    }
  }
}

function drawLegend() {
  const legend = document.getElementById('legend');
  for (const p of puzzle.palette) {
    const el = document.createElement('div');
    el.className = 'swatch';
    el.innerHTML = '<span class="dot" style="background:' + p.hex + '"></span>' + p.n + ' - ' + p.name + ' (' + p.hex + ')';
    legend.appendChild(el);
  }
}

drawFilled();
drawNumbered();
drawLegend();
</script>
</body>
</html>`;
}

function openInBrowser(filePath) {
  const url = `file://${filePath.replace(/\\/g, '/')}`;
  try {
    if (process.platform === 'win32') {
      spawn('cmd.exe', ['/c', 'start', '""', url], { stdio: 'ignore', detached: true }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { stdio: 'ignore', detached: true }).unref();
    } else {
      spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).unref();
    }
  } catch {
    console.warn(`Could not open a browser automatically. Open this file manually:\n  ${filePath}`);
  }
}

async function showPreviewAndConfirm(puzzle) {
  const html = buildPreviewHtml(puzzle);
  const tmpPath = path.join(os.tmpdir(), `pixelkleur-preview-${puzzle.id}-${Date.now()}.html`);
  fs.writeFileSync(tmpPath, html);
  openInBrowser(tmpPath);

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`\nPreview opened in your browser (${tmpPath}).\nWrite puzzle files? [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

// ---- photo mode (CLAUDE.md §9 "Photo mode") -----------------------------
function buildPhotoPuzzle(opts, tier) {
  const targetColors = opts.colors && opts.colors > 0 ? opts.colors : tier.maxColors;

  // 1+2. load, downsample, background detection
  console.log(`Loading ${opts.input}...`);
  const source = loadImage(opts.input);
  const { width, height } = computeGridSize(source.width, source.height, tier);
  console.log(`Downsampling ${source.width}x${source.height} -> ${width}x${height}...`);
  const cells = downsample(source, width, height, opts.bg);

  // 3. quantize in Lab space
  console.log(`Quantizing to ~${targetColors} colors (Lab space, median cut)...`);
  const foregroundLabs = cells.filter((c) => !c.background).map((c) => c.lab);
  if (foregroundLabs.length === 0) {
    fail('every cell was detected as background — check --bg or the source image alpha channel');
  }
  const buckets = medianCut(foregroundLabs, Math.min(targetColors, foregroundLabs.length));

  const grid = new Array(width * height).fill(0);
  for (let i = 0; i < cells.length; i++) {
    if (cells[i].background) continue;
    let best = 0, bestDist = Infinity;
    for (let b = 0; b < buckets.length; b++) {
      const d = deltaE76(cells[i].lab, buckets[b]);
      if (d < bestDist) { bestDist = d; best = b; }
    }
    grid[i] = best + 1;
  }

  // 4. despeckle
  console.log(`Despeckling (min region = ${opts.minRegion} cells)...`);
  despeckle(grid, width, height, opts.minRegion);

  // 5. merge palette entries within dE < 10
  console.log('Merging near-identical colors (dE < 10)...');
  const paletteStats = buildPaletteStats(grid, cells);
  mergeClosePalette(grid, paletteStats, 10);

  const { finalGrid, finalPalette } = relabel(grid, paletteStats);
  if (finalPalette.length === 0) fail('no colors survived quantization/merging — try a different source image');

  // 6. Dutch color names
  const namedPalette = finalPalette.map((entry) => {
    const rgb = labToRgb(entry.lab.l, entry.lab.a, entry.lab.b);
    return { n: entry.n, hex: rgbToHex(rgb.r, rgb.g, rgb.b), name: nearestColorName(entry.lab) };
  });

  const puzzle = {
    schemaVersion: 1,
    id: opts.id,
    title: opts.title,
    difficulty: opts.difficulty,
    width,
    height,
    contentHash: '',
    thumbnail: `thumbs/${opts.id}.png`,
    palette: namedPalette,
    grid: toRows(finalGrid, width, height),
  };
  puzzle.contentHash = computeContentHash(puzzle.palette, puzzle.grid);

  // 7. thumbnail
  const thumbBuffer = renderThumbnail(finalGrid, width, height, namedPalette);
  return { puzzle, thumbBuffer };
}

// ---- main -----------------------------------------------------------------
async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    console.error(USAGE);
    process.exit(1);
  }

  if (opts.help || !opts.input) {
    console.log(USAGE);
    process.exit(opts.help ? 0 : 1);
  }
  if (!opts.id) fail('--id is required');
  if (!opts.title) fail('--title is required');
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(opts.id)) {
    fail(`--id "${opts.id}" must be lowercase kebab-case (letters, digits, hyphens)`);
  }
  const tier = TIERS[opts.difficulty];
  if (!tier) fail(`--difficulty must be one of: ${Object.keys(TIERS).join(', ')}`);
  if (!fs.existsSync(opts.input)) fail(`input file not found: ${opts.input}`);

  if (opts.native) {
    if (!opts.palette) fail('--native requires --palette <file.json>');
    if (opts.bg) fail('--bg is not used in --native mode (transparency determines background)');
    if (opts.colorsGiven) fail('--colors is not used in --native mode (the palette file determines colors)');
    if (opts.minRegionGiven) fail('--min-region is not used in --native mode (no despeckle pass runs)');
    if (path.extname(opts.input).toLowerCase() !== '.png') {
      fail('--native mode requires a PNG input — JPEG re-encoding cannot guarantee exact hex matches');
    }
  } else {
    if (opts.palette) fail('--palette is only used with --native mode');
    if (opts.bg && !hexToRgb(opts.bg)) fail('--bg must be a hex color like #ffffff');
    if (!opts.minRegion || opts.minRegion < 1) fail('--min-region must be a positive integer');
  }

  const manifest = readManifest();
  const puzzleFilename = `${opts.id}.json`;
  const existingIndex = manifest.puzzles.indexOf(puzzleFilename);
  const existingPuzzlePath = path.join(PUZZLES_DIR, puzzleFilename);
  if ((existingIndex !== -1 || fs.existsSync(existingPuzzlePath)) && !opts.force) {
    fail(`puzzle "${opts.id}" already exists. Pass --force to regenerate it.`);
  }

  const { puzzle, thumbBuffer } = opts.native ? buildNativePuzzle(opts, tier) : buildPhotoPuzzle(opts, tier);

  // 8. validate before writing anything
  const errors = validatePuzzleStructure(puzzle);
  if (errors.length > 0) {
    console.error('\nValidation failed — no files were written:');
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log('Validation OK.');

  if (opts.preview) {
    const proceed = await showPreviewAndConfirm(puzzle);
    if (!proceed) {
      console.log('Aborted — no files were written.');
      return;
    }
  }

  fs.mkdirSync(PUZZLES_DIR, { recursive: true });
  fs.mkdirSync(THUMBS_DIR, { recursive: true });
  fs.writeFileSync(existingPuzzlePath, JSON.stringify(puzzle, null, 2) + '\n');
  fs.writeFileSync(path.join(THUMBS_DIR, `${opts.id}.png`), thumbBuffer);

  if (existingIndex === -1) manifest.puzzles.push(puzzleFilename);
  fs.writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');

  console.log(`\nWrote puzzles/${puzzleFilename}, thumbs/${opts.id}.png, and updated manifest.json.`);
  console.log(`${puzzle.palette.length} colors, ${puzzle.width}x${puzzle.height} = ${puzzle.width * puzzle.height} cells.`);

  confirmPrecached(puzzleFilename, puzzle);
  bumpCacheVersion();
}

main().catch((err) => {
  console.error(err.stack || err.message);
  process.exit(1);
});
