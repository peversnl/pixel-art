#!/usr/bin/env node
// PixelKleur puzzle validator (CLAUDE.md §9). Checks every puzzle listed
// in puzzles/manifest.json: structural validity (shared with
// create-puzzle.js's pre-write check) plus repo-level checks that only
// make sense across the whole set — duplicate ids, manifest entries with
// no matching file, missing thumbnails.
//
// Usage: node tools/validate-puzzles.js

const fs = require('fs');
const path = require('path');
const { validatePuzzleStructure } = require('./lib/validate-puzzle');

const ROOT = path.join(__dirname, '..');
const PUZZLES_DIR = path.join(ROOT, 'puzzles');
const MANIFEST_PATH = path.join(PUZZLES_DIR, 'manifest.json');

function main() {
  if (!fs.existsSync(MANIFEST_PATH)) {
    console.error(`Manifest not found: ${MANIFEST_PATH}`);
    process.exit(1);
  }

  let manifest;
  try {
    manifest = JSON.parse(fs.readFileSync(MANIFEST_PATH, 'utf8'));
  } catch (err) {
    console.error(`manifest.json is not valid JSON: ${err.message}`);
    process.exit(1);
  }
  if (manifest.schemaVersion !== 1) {
    console.error(`manifest.json: schemaVersion must be 1, got ${JSON.stringify(manifest.schemaVersion)}`);
    process.exit(1);
  }
  if (!Array.isArray(manifest.puzzles)) {
    console.error('manifest.json: "puzzles" must be an array');
    process.exit(1);
  }

  if (manifest.puzzles.length === 0) {
    console.log('No puzzles in manifest.json yet — nothing to validate.');
    return;
  }

  let hadErrors = false;
  const seenIds = new Map(); // id -> filename

  for (const filename of manifest.puzzles) {
    console.log(`\nChecking ${filename}...`);
    const filePath = path.join(PUZZLES_DIR, filename);

    if (!fs.existsSync(filePath)) {
      console.error('  FAIL: manifest references a file that does not exist');
      hadErrors = true;
      continue;
    }

    let puzzle;
    try {
      puzzle = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
      console.error(`  FAIL: invalid JSON (${err.message})`);
      hadErrors = true;
      continue;
    }

    const errors = validatePuzzleStructure(puzzle);

    if (puzzle.id) {
      if (seenIds.has(puzzle.id)) {
        errors.push(`duplicate id "${puzzle.id}" also used by ${seenIds.get(puzzle.id)}`);
      } else {
        seenIds.set(puzzle.id, filename);
      }
    }

    if (puzzle.thumbnail) {
      const thumbPath = path.join(ROOT, puzzle.thumbnail);
      if (!fs.existsSync(thumbPath)) {
        errors.push(`thumbnail file not found: ${puzzle.thumbnail}`);
      }
    }

    if (errors.length === 0) {
      console.log(`  OK (${puzzle.width}x${puzzle.height}, ${puzzle.palette?.length ?? 0} colors)`);
    } else {
      hadErrors = true;
      for (const e of errors) console.error(`  FAIL: ${e}`);
    }
  }

  console.log();
  if (hadErrors) {
    console.error('Validation failed.');
    process.exit(1);
  }
  console.log(`All ${manifest.puzzles.length} puzzle(s) passed validation.`);
}

main();
