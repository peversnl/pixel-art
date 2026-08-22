// Minimal image loading: decode PNG/JPEG to a flat top-left row-major
// RGBA buffer. Deliberately pure-JS (pngjs/jpeg-js), no native bindings,
// so the tool installs the same way on any machine.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

function loadImage(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();

  if (ext === '.png') {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }

  if (ext === '.jpg' || ext === '.jpeg') {
    const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
    return { width: img.width, height: img.height, data: Buffer.from(img.data) };
  }

  throw new Error(`Unsupported image format "${ext}". Use PNG or JPEG.`);
}

module.exports = { loadImage };
