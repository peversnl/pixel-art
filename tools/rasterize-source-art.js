#!/usr/bin/env node
// Dev helper (not part of the shipped generator): rasterizes every
// source-art/<id>.svg to a 512px source-art/<id>.png, per CLAUDE.md §7's
// "draw as flat SVG, rasterize to a 512px PNG" step. Uses @resvg/resvg-js
// (devDependency only — the web app itself never touches SVG or this tool).
//
// Usage: node tools/rasterize-source-art.js [id ...]   (no args = all)

const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');

const SOURCE_ART_DIR = path.join(__dirname, '..', 'source-art');

function main() {
  const requested = process.argv.slice(2);
  const svgFiles = fs
    .readdirSync(SOURCE_ART_DIR)
    .filter((f) => f.endsWith('.svg'))
    .filter((f) => requested.length === 0 || requested.includes(path.basename(f, '.svg')));

  if (svgFiles.length === 0) {
    console.error('No matching .svg files found in source-art/');
    process.exit(1);
  }

  for (const file of svgFiles) {
    const id = path.basename(file, '.svg');
    const svg = fs.readFileSync(path.join(SOURCE_ART_DIR, file), 'utf8');
    const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 512 } });
    const png = resvg.render().asPng();
    const outPath = path.join(SOURCE_ART_DIR, `${id}.png`);
    fs.writeFileSync(outPath, png);
    console.log(`${file} -> ${id}.png`);
  }
}

main();
