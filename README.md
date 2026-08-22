# PixelKleur

A free, ad-free, browser-based "color by number" pixel art game. See
[CLAUDE.md](CLAUDE.md) for the full build spec.

## Local development

Browsers block `fetch()` of local JSON under `file://`, so opening
`index.html` directly will not work — the puzzle manifest and puzzle JSON
files won't load. Serve the project over HTTP instead:

```sh
npx serve .
```

Then open the printed `http://localhost:...` URL in Chrome. Any other static
file server works too (`python -m http.server`, VS Code's Live Server, etc.)
— the only requirement is that it serves plain static files with no build
step.

## Project structure

```
index.html              app shell
styles.css
app.js                  entry point (may split into ES modules)
manifest.webmanifest    PWA manifest
sw.js                   service worker (offline caching)
icons/                  PWA icons (192/512)
sounds/                 fill / color-done / complete audio
source-art/             puzzle source images (pre-generator) — flat-color SVGs +
                        rasterized PNGs for the photo-mode pipeline, or a PNG
                        drawn directly at grid resolution for native mode
archive/source-art/     SVGs superseded by native-mode art — kept for history,
                        not read by any tool
puzzles/
  manifest.json         list of puzzle files (generator-maintained)
  <id>.json             one file per puzzle
thumbs/                 puzzle thumbnails
tools/
  create-puzzle.js      CLI generator: source image -> puzzle JSON
  validate-puzzles.js   CLI validator, run after every generated puzzle
```

## Adding a puzzle

Puzzles are generated from source images by Peter via the CLI, not uploaded
in-app by the child (see CLAUDE.md §7, §9, §15).

Normal path — pixel art authored directly at grid resolution, no resampling
or quantization (CLAUDE.md §7, §9 "Native mode"): draw a PNG that's already
exactly the tier's grid size, using only the palette's exact hex values, then

```sh
node tools/create-puzzle.js source-art/poes-wolbol.png --native --palette source-art/poes-wolbol-palette.json --difficulty medium --id poes-wolbol --title "Poes met wolbol"
node tools/validate-puzzles.js
```

Exception path — a specific real-life subject (e.g. an actual pet or stuffed
animal) that needs a real photo instead of drawn art: source that one photo
separately: it skips native authoring, and the `--bg` / despeckling guidance
in CLAUDE.md §9 applies.

Legacy path — original flat-color SVG art, rasterized and quantized down to
grid resolution (CLAUDE.md §7 calls this the discouraged "v2 approach": it
throws away detail the quantizer then has to fake back with despeckling).
Prefer the native path above for new puzzles.
1. Draw the picture as a flat SVG in `source-art/<id>.svg` (no gradients,
   no photorealism, distinct closed regions per intended color).
2. Rasterize it to a 512px PNG (also in `source-art/`).
3. Run it through the generator and validator:

```sh
node tools/create-puzzle.js source-art/poes-wolbol.png --difficulty medium --id poes-wolbol --title "Poes met wolbol"
node tools/validate-puzzles.js
```

### Archived source art

When a puzzle switches from the SVG/photo-mode pipeline to native authoring,
its old `source-art/<id>.svg` moves to `archive/source-art/<id>.svg`. This
matters because `tools/rasterize-source-art.js` regenerates
`source-art/<id>.png` from *every* `.svg` it finds — left in place, it would
silently overwrite native art with a 512px rasterization of the old vector
source. `poes-wolbol` is the first puzzle made this way: its native art is
`source-art/poes-wolbol.png` + `source-art/poes-wolbol-palette.json`, and the
original vector illustration is archived at
`archive/source-art/poes-wolbol.svg`.
