# Color-by-Number Pixel Art Game — Build Spec v2

## 1. Overview
A free, ad-free, browser-based "color by number" pixel art game for an
almost-8-year-old girl. Numbered cells on a grid: pick a color, then tap or
drag across the cells carrying that number. When every cell is filled, the
hidden picture is revealed. No accounts, no ads, no payments, no data
collection. Works offline after the first load.

Interface language: **Dutch**.

---

## 2. Target Platform & Delivery

**Primary device: Android tablet (Chrome).** Everything else is secondary
but must not break.

- Deployed as **static files on a static host** (GitHub Pages or Netlify).
  This is deliberate: `fetch()` of local JSON is blocked under `file://`,
  so double-clicking `index.html` is *not* a supported way to run it.
- Local development: `npx serve .` (or any static server). Document this in
  the README.
- Ships as an installable **PWA** so it can be added to the tablet home
  screen and run without browser chrome (no address bar to tap away from
  the game, no accidental navigation).
- Must work in landscape and portrait; landscape is the expected default on
  a tablet.

---

## 3. Core Mechanic

1. Player taps a color swatch in the palette bar to select it. The swatch
   shows both the **color** and its **number**, large.
2. Tapping a grid cell whose number matches the selected color fills it
   with that color and hides the number.
3. **Dragging** with one finger fills every matching cell the finger passes
   over. Non-matching cells under the finger are simply skipped — no
   penalty, no error state.
4. Tapping a cell with a *different* number than the currently selected
   color **switches the selection to that cell's color** and fills it.
   (This replaces the "do nothing + shake" rule from v1: silently doing
   nothing reads as broken to a child. Switching is forgiving and teaches
   the mechanic by itself.)
5. Tapping an already-filled cell does nothing.
6. When every cell for a number is filled, its palette swatch shows a
   checkmark, greys out, and selection auto-advances to the next unfinished
   color.
7. When the whole grid is filled: gridlines fade out, celebration animation
   + sound, full image reveal, buttons to replay or return to the library.

**No timer, no score, no fail state, no lives.**

### Undo / erase
- A **long-press (600 ms) on a filled cell clears it.** This is the only
  undo needed for mis-taps.
- The puzzle screen has a small "opnieuw beginnen" (restart) button behind
  a confirm dialog, so a frustrated restart is possible but not accidental.

---

## 4. Interaction & Gesture Model

This is the trickiest part of the build — specify it precisely.

Use **Pointer Events** (`pointerdown` / `pointermove` / `pointerup`) and
track active pointer IDs.

| Gesture | Behaviour |
|---|---|
| One finger down + move | Paint (drag-fill) |
| Two fingers | Pinch to zoom + pan the grid. Painting is cancelled the moment a second pointer appears; any cells filled since that gesture began are kept (do not roll back). |
| Long-press one finger (600 ms, <10 px movement) | Erase that cell |
| Double-tap | Reserved — do nothing (must not trigger browser zoom) |

- Zoom range: **fit-to-screen (1×) up to 4×**. A "passend maken" (fit)
  button resets zoom and centring.
- Panning is clamped so the grid can never be dragged fully off-screen.
- The canvas must set `touch-action: none` so the browser doesn't steal the
  gestures.

### Required mobile hygiene (all of it, this is a kid's app)
```css
html, body { overscroll-behavior: none; }        /* no pull-to-refresh */
* { -webkit-tap-highlight-color: transparent; }
.grid, .palette { user-select: none; -webkit-touch-callout: none; }
```
```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, maximum-scale=1,
               user-scalable=no, viewport-fit=cover">
```

---

## 5. Rendering

**Use `<canvas>` from the start — not CSS Grid.** With pinch-zoom, panning
and drag-painting all required, canvas is simpler and faster than
transforming 500+ DOM nodes, and it removes the "rewrite it later for hard
puzzles" problem.

- Two stacked canvases:
  - **base layer** — filled cells + gridlines, redrawn only on zoom/pan.
  - **active layer** — cells filled during the current drag, plus the hint
    pulse. Cheap to redraw per frame.
- Redraw on `requestAnimationFrame`, never synchronously per pointermove
  event.
- Respect `devicePixelRatio` so numbers stay crisp on a tablet screen.
- Numbers are drawn only on unfilled cells. Font size scales with zoom;
  below ~14 px effective cell size, hide the numbers entirely (they're
  illegible anyway) — the player is expected to zoom in to work.
- Hit-testing is pure arithmetic: `col = floor((x - panX) / (cell * zoom))`.

### Layout
- Grid occupies the full area above the palette bar.
- Palette bar pinned to the bottom, horizontally scrollable, swatches
  **minimum 56 × 56 px** with the number centred in high-contrast text.
- Header: home button, progress indicator ("42/210"), mute toggle. All
  icon-driven; touch targets ≥ 48 px.

---

## 6. Difficulty Tiers

The data format supports arbitrary grid size and color count, so new tiers
need zero code changes.

| Tier | Grid | Cells | Colors | Notes |
|---|---|---|---|---|
| `easy` | 20×24 | 480 | 6–8 | short sessions; was the old `medium` |
| `medium` (launch default) | 32×40 | 1280 | 10–14 | her current level |
| `hard` | 48×60 | 2880 | 16–24 | for later |

All 10 launch puzzles ship at `medium`.

### Why the grids got bigger

At 20 columns, a subject occupying 60% of the frame is ~12 cells across —
an eye is a single cell, and any despeckle pass deletes it. Recognisable
faces need roughly **24+ cells across the subject**, with **2×2 cells
minimum for an eye**. 32 columns is the point where flat cartoon art
survives the downsample; below that, the art is fighting the format.

Higher resolution is affordable because §4 already specifies pinch-zoom:
the player is expected to zoom in to work, so cells don't need to be
legible at fit-to-screen. Canvas rendering (§5) makes cell count nearly
free.

**Session length check:** at 32×40, roughly 40–60% of cells are background
(`0`, not fillable), leaving ~500–750 taps per puzzle. With drag-painting
that's a 10–20 minute session, and progress saves (§11) make it resumable.
If that turns out to be too long in practice, move puzzles to `easy`
rather than shrinking `medium` — the tiers exist for exactly this.

---

## 7. Puzzle Content

Ten launch puzzles across four categories (deliberately mixed, no single
favourite animal):

**Dieren** — 1. Poes met wolbol · 2. Puppy · 3. Konijn in de tuin
**Fantasie** — 4. Eenhoorn · 5. Zeemeermin
**Natuur** — 6. Vlinder · 7. Regenboog met wolken · 8. Bloemenboeket
**Alledaags** — 9. IJsje · 10. Verjaardagstaart met ballonnen

No vehicles, no sports themes.

**Source art: original art drawn natively at the target grid resolution —
not photos, not sourced clipart, and not full-resolution SVGs run through
a quantizer.**

The v2 approach (draw a 512px SVG, then downsample and quantize it) creates
a problem it then has to solve badly: it throws away detail, invents
near-duplicate colors, and needs a despeckle pass that eats the very
features that make a picture readable. Since we're authoring the art
ourselves, we can skip all of it.

**Native pixel authoring (the default path):**
1. Choose the puzzle's palette **by hand first** — 10–14 exact hex values,
   visibly distinct from each other, with Dutch names.
2. Draw the picture directly at grid resolution (32×40 for `medium`) as an
   indexed pixel image: either a `WxH` PNG using only those exact palette
   colors, or the grid array itself.
3. `create-puzzle.js` reads it **1:1 with no resampling, no quantization,
   and no despeckle** — every authored cell survives exactly as drawn.

This guarantees crisp results: what gets drawn is what gets played. It also
means the artist (Claude Code) is composing *for* the constraint instead of
having a quantizer discover it afterwards — eyes get placed as deliberate
2×2 blocks, outlines are one cell wide on purpose, and the subject is sized
to fill the frame.

Practical drawing rules at 32×40:
- Subject fills 70–85% of the frame; don't leave wide empty margins.
- Eyes and other small features: **2×2 cells minimum**.
- Outlines: 1 cell, and only where they carry the shape.
- Avoid single isolated cells of a color — they read as mistakes.
- Every palette color should appear in a region of at least ~6 cells, or
  it isn't worth a palette slot.

**Photo path (fallback only):** if a specific puzzle should be a real
recognisable subject — her actual stuffed rabbit, the family cat — a photo
goes through the full quantize/despeckle pipeline in §9. Expect it to look
noticeably rougher than the authored puzzles.

---

## 8. Data Format

### `puzzles/<id>.json`
```json
{
  "schemaVersion": 1,
  "id": "poes-wolbol",
  "title": "Poes met wolbol",
  "difficulty": "medium",
  "width": 20,
  "height": 24,
  "contentHash": "a3f9c1d2",
  "thumbnail": "thumbs/poes-wolbol.png",
  "palette": [
    { "n": 1, "hex": "#F5A623", "name": "oranje" },
    { "n": 2, "hex": "#FFFFFF", "name": "wit" },
    { "n": 3, "hex": "#4A90D9", "name": "blauw" }
  ],
  "grid": [
    [0, 0, 1, 1, 2],
    [0, 1, 1, 3, 2]
  ]
}
```

- `grid` is an array of `height` rows, each of `width` integers.
- `0` = background / empty. Never appears in the palette and is never
  fillable; it renders as the page background.
- `name` is the Dutch friendly color name. It is shown **under the swatch
  in the palette bar** and in the hint text — v1 left this unused.
- `contentHash` is a short hash of `grid` + `palette`, written by the
  generator. Used to invalidate saved progress when a puzzle is
  regenerated.

### `puzzles/manifest.json`
There is **no way to list a directory** from the browser, so a manifest is
required. The generator updates it automatically.
```json
{ "schemaVersion": 1, "puzzles": ["poes-wolbol.json", "puppy.json"] }
```

---

## 9. Puzzle Generator (Peter's CLI tool — not in the app)

The tool has **two modes**. Native mode is the default for authored art;
photo mode is the fallback for real photographs.

### Native mode (default)

`node tools/create-puzzle.js art/poes.png --native --palette art/poes-palette.json --id poes-wolbol --title "Poes met wolbol"`

The input PNG is already exactly `width × height` and uses only the exact
hex values in the palette file.

1. Read the PNG **1:1**. No resize, no resample, no interpolation of any
   kind. If the PNG's dimensions don't match the tier's grid, **fail with
   an error** rather than scaling it.
2. Map each pixel to its palette index by exact hex match. Fully
   transparent → `0`. An unmatched color is an **error**, not something to
   snap to the nearest palette entry — it means the art and palette are out
   of sync, and silently snapping hides that.
3. **No quantization. No despeckle. No palette merging.** The art is
   authored; trust it.
4. Assign Dutch names from the palette file.
5. Write `puzzles/<id>.json`, generate `thumbs/<id>.png`, append to
   `puzzles/manifest.json`.
6. Run the validator and refuse to write if it fails.

### Photo mode (`--photo`)

`node tools/create-puzzle.js foto.jpg --photo --difficulty medium --id poes --title "Poes"`

1. **Resize with area-average (box filter) downsampling, never
   nearest-neighbour.** Point sampling is what makes thin features vanish
   and shapes disintegrate; area averaging preserves shape mass.
2. **Handle aspect ratio explicitly.** Fit the source inside the grid
   preserving aspect ratio, then **pad the remainder with background
   (`0`)** — centred. Never stretch to fill, never crop silently. Log the
   computed fit box so a mismatch is visible.
3. Determine background: fully transparent → `0`; `--bg "#ffffff"` marks a
   background color when there's no alpha.
4. Quantize to the tier's palette size using k-means in **Lab** space (not
   RGB).
5. **Merge palette entries with ΔE < 10, computed in Lab.** Merging in RGB
   is why near-identical creams and greens survive. After merging, re-index
   the grid and verify no two surviving colors are within the threshold.
6. **Despeckle**, with `--min-region` scaled to the grid (default: 2 cells
   at `easy`, 3 at `medium`, 4 at `hard`) — and **protect high-contrast
   small regions**: a region whose color is far (ΔE > 30) from all its
   neighbours is kept regardless of size. This is what saves eyes and
   pupils from being merged into a face.
7. Dutch color names, write, append to manifest, validate.

### Both modes

`--preview` renders the generated puzzle **side by side with the source**
in the browser before writing, so a mis-scale or a lost feature is
immediately obvious rather than discovered ten puzzles later.

### `node tools/validate-puzzles.js`
Run over every puzzle in the manifest. Fails on:
- grid not rectangular, or dimensions not matching `width`/`height`
- any grid number (other than 0) missing from the palette
- any palette entry that never appears in the grid
- two palette colors within ΔE < 10 **(computed in Lab)**
- any palette color occupying fewer than 4 cells total — likely a
  quantization artifact rather than an intended color
- more than 15% of fillable cells being isolated single-cell regions —
  a strong signal the output is confetti
- duplicate `id`s, or manifest entries with no matching file
- invalid hex, missing `name`, missing thumbnail

---

## 10. Screens & Flow

### A. Puzzle Library
- Grid of thumbnails, 2–3 columns on a tablet.
- Per-puzzle state badge: **nieuw** / **bezig** (with a small progress ring)
  / **klaar** (star).
- In-progress puzzles show their partially-filled thumbnail.

### B. Puzzle Screen
Canvas grid, palette bar, header (home / progress / mute).

### C. Completion Screen
Gridlines fade, full picture reveal, confetti + sound, "Nog een keer" and
"Terug naar de puzzels".

### D. Error & empty states (missing from v1 — specify them)
| Situation | Behaviour |
|---|---|
| Manifest fails to load | Friendly Dutch message + retry button |
| A puzzle JSON is missing or invalid | Hide that tile; log to console; don't crash the library |
| Unknown puzzle id in the URL | Redirect to the library |
| Saved progress fails to parse | Discard it silently, start fresh |

---

## 11. Persistence

`localStorage`, namespaced and versioned.

- `pixelkleur:v1:settings` → `{ "muted": false }`
- `pixelkleur:v1:progress:<puzzleId>` →
  `{ "contentHash": "a3f9c1d2", "filled": [0,1,2,45], "completed": false, "updatedAt": 1690000000 }`

Rules:
- `filled` is a flat array of cell indices (`row * width + col`).
- On load, **if the stored `contentHash` differs from the puzzle's, discard
  the progress** and start clean. This prevents corrupt state after a
  puzzle is regenerated.
- Save on a 500 ms debounce after fills, and on `visibilitychange`
  (Android kills backgrounded tabs — without this she loses her work).
- Wrap every read/write in try/catch; storage can be full or disabled.
- A hidden parent reset: long-press the library title for 3 s → "alle
  voortgang wissen?" confirm.

---

## 12. Offline / PWA

"Works offline after first load" doesn't happen by itself — it needs:

- `manifest.webmanifest`: name, Dutch short name, icons (192/512),
  `display: "standalone"`, `orientation: "any"`, theme color.
- A **service worker** that precaches the app shell (`index.html`,
  `styles.css`, `app.js`, sounds, icons) plus `puzzles/manifest.json` and
  every puzzle JSON and thumbnail listed in it.
- Cache-first for puzzle assets, network-first with cache fallback for the
  shell.
- Bump a `CACHE_VERSION` constant on each deploy so updates actually land.
- No CDN dependencies whatsoever — everything self-hosted.

---

## 13. Audio

- Short fill sound, a completion fanfare, and a soft "klaar" chime when a
  color is finished.
- **Vary the pitch of the fill sound slightly** (e.g. rising by a semitone
  as a color nears completion, resetting each color). 480 identical blips
  is torture for everyone in the room.
- During a drag, throttle to at most one sound every ~60 ms.
- Audio must be unlocked on first user gesture (Chrome autoplay policy) —
  create/resume the `AudioContext` on the first tap.
- Mute toggle in the header, persisted in settings. Preload all sounds; use
  small OGG/MP3 files or WebAudio-synthesized tones.

---

## 14. Kid-Friendly UX

- All UI strings in a single `STRINGS` object in `app.js` — one place to
  edit, easy to add English later.
- Minimal reading; icon-driven buttons with text labels underneath.
- Large, high-contrast, rounded visual style. No dense text anywhere.
- **Hint (optional, v1.5):** after ~20 s of no input, gently pulse the
  outline of the cells matching the selected color.
- No ads, no purchases, no external links, no analytics, no data collection.

---

## 15. Explicit Non-Goals (v1)

- No accounts, no cloud sync, no multiplayer
- No monetization of any kind
- No in-app image upload by the child — puzzles are added by a parent via
  the CLI tool
- No screen-reader / full a11y pass (documented as out of scope, not
  forgotten)
- No landscape/portrait-specific layouts beyond responsive reflow

---

## 16. Definition of Done

Build is complete when all of the following pass on an Android tablet in
Chrome:

- [ ] All 10 puzzles load from the manifest and appear in the library
- [ ] A puzzle can be completed end-to-end by tapping only
- [ ] A puzzle can be completed using drag-painting
- [ ] Pinch-zoom and pan work; painting never fires during a two-finger
      gesture; the "fit" button resets the view
- [ ] Long-press erases a single filled cell
- [ ] Tapping a cell with a different number switches the selected color
- [ ] Completing a color checks off its swatch and auto-advances
- [ ] Completion screen fires: gridlines fade, confetti, sound, both buttons work
- [ ] Progress survives a tab close and reopen, and a device restart
- [ ] Regenerating a puzzle discards stale progress instead of corrupting it
- [ ] Airplane mode: the installed PWA still loads and plays every puzzle
- [ ] Mute persists across sessions
- [ ] No pull-to-refresh, no text selection, no browser double-tap zoom
- [ ] `validate-puzzles.js` passes on all 10
- [ ] Adding a new puzzle via `create-puzzle.js` makes it appear with no
      code changes
- [ ] Lighthouse PWA install check passes

---

## 17. Suggested Project Structure

```
index.html
styles.css
app.js
manifest.webmanifest
sw.js
icons/            icon-192.png, icon-512.png
sounds/           fill.ogg, color-done.ogg, complete.ogg
source-art/       poes-wolbol.svg + .png … (the 10 originals pre-generator)
puzzles/
  manifest.json
  poes-wolbol.json  … (10 files)
thumbs/           poes-wolbol.png …
tools/
  create-puzzle.js
  validate-puzzles.js
README.md
```

`app.js` may be split into ES modules (`state.js`, `render.js`,
`input.js`, `storage.js`, `audio.js`) — modules load natively over http, no
build step needed.

---

## 18. Remaining Open Questions

1. **Hint timing** — is a 20 s auto-hint helpful or patronising for her?
2. **Palette size at launch** — 10 or 14 colors? 14 is prettier, 10 is much
   less scrolling in the palette bar on a tablet.

~~Source art~~ — resolved: original flat SVG illustrations drawn for this
project (§7), avoiding both the licensing question and the photo-noise
problem. Revisit only if a specific real-life subject (her actual stuffed
animal, the family cat) is wanted for one puzzle.