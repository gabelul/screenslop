import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildBmp, contrastRatio, loadScreenshotPixels, parseBmp, relativeLuminance } from '../src/critique/pixels.mjs';
import { run } from '../src/runtime/shell.mjs';

const sipsAvailable = process.platform === 'darwin' && run('command -v sips').status === 0;

test('parseBmp reads a bottom-up 24bpp BMP with top-left origin coordinates', () => {
  const image = parseBmp(buildBmp(4, 2, (x, y) => (x === 0 && y === 0
    ? { r: 255, g: 0, b: 0 }
    : { r: 0, g: 0, b: 255 })));
  assert.equal(image.width, 4);
  assert.equal(image.height, 2);
  assert.deepEqual(image.getPixel(0, 0), { r: 255, g: 0, b: 0 });
  assert.deepEqual(image.getPixel(3, 1), { r: 0, g: 0, b: 255 });
});

test('parseBmp handles top-down BMPs (negative height, the sips shape)', () => {
  const bottomUp = buildBmp(2, 2, (x, y) => ({ r: x * 100, g: y * 100, b: 0 }));
  const topDown = Buffer.from(bottomUp);
  topDown.writeInt32LE(-2, 22);
  // Flipping the sign without reordering rows mirrors the image vertically.
  const image = parseBmp(topDown);
  assert.deepEqual(image.getPixel(0, 0), parseBmp(bottomUp).getPixel(0, 1));
});

test('parseBmp rejects non-BMP buffers and unsupported depths', () => {
  assert.throws(() => parseBmp(Buffer.from('fake-jpeg')));
  const bmp = buildBmp(2, 2, () => ({ r: 0, g: 0, b: 0 }));
  bmp.writeUInt16LE(8, 28);
  assert.throws(() => parseBmp(bmp), /Unsupported BMP depth/);
});

test('getPixel clamps out-of-range coordinates instead of crashing', () => {
  const image = parseBmp(buildBmp(2, 2, () => ({ r: 9, g: 9, b: 9 })));
  assert.deepEqual(image.getPixel(-5, 99), { r: 9, g: 9, b: 9 });
});

test('contrast helpers reproduce known WCAG values', () => {
  const black = relativeLuminance({ r: 0, g: 0, b: 0 });
  const white = relativeLuminance({ r: 255, g: 255, b: 255 });
  assert.equal(Math.round(contrastRatio(black, white)), 21);
  assert.equal(contrastRatio(white, white), 1);
});

test('loadScreenshotPixels returns null for missing files and failed conversions', () => {
  assert.equal(loadScreenshotPixels(null), null);
  assert.equal(loadScreenshotPixels('/nope/never/frame.jpg'), null);
  const fakeJpeg = path.join(os.tmpdir(), `screenslop-fake-${process.pid}.jpg`);
  fs.writeFileSync(fakeJpeg, 'fake-jpeg');
  try {
    assert.equal(loadScreenshotPixels(fakeJpeg, { convert: () => null }), null);
  } finally {
    fs.rmSync(fakeJpeg, { force: true });
  }
});

test('loadScreenshotPixels uses an injected converter', () => {
  const bmp = buildBmp(3, 3, () => ({ r: 1, g: 2, b: 3 }));
  const fakePath = path.join(os.tmpdir(), `screenslop-inject-${process.pid}.jpg`);
  fs.writeFileSync(fakePath, 'placeholder');
  try {
    const image = loadScreenshotPixels(fakePath, { convert: () => bmp });
    assert.deepEqual(image.getPixel(1, 1), { r: 1, g: 2, b: 3 });
  } finally {
    fs.rmSync(fakePath, { force: true });
  }
});

test('live sips conversion round-trips a real image', { skip: !sipsAvailable }, () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-pixels-live-'));
  const sourceBmp = path.join(tempDir, 'source.bmp');
  try {
    fs.writeFileSync(sourceBmp, buildBmp(8, 8, (x) => (x < 4 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 })));
    const image = loadScreenshotPixels(sourceBmp);
    assert.ok(image, 'expected sips conversion to succeed');
    assert.equal(image.width, 8);
    assert.equal(image.getPixel(0, 0).r, 255);
    assert.equal(image.getPixel(7, 7).r, 0);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
