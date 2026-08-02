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

/**
 * Builds a 32bpp BI_BITFIELDS BMP — the shape sips emits from any image with an
 * alpha channel. Channels are laid out RGBA rather than the classic BGRA, so a
 * parser that ignores the masks and assumes byte order reads them swapped.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {(x:number,y:number)=>{r:number,g:number,b:number}} paint Pixel source.
 * @returns {Buffer} BMP bytes.
 */
function buildBitfieldsBmp(width, height, paint) {
  const pixelOffset = 66;
  const stride = width * 4;
  const buffer = Buffer.alloc(pixelOffset + stride * height);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(pixelOffset, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22);
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(32, 28);
  buffer.writeUInt32LE(3, 30);
  buffer.writeUInt32LE(0x000000ff, 54); // red
  buffer.writeUInt32LE(0x0000ff00, 58); // green
  buffer.writeUInt32LE(0x00ff0000, 62); // blue

  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const pixel = paint(x, y);
      const offset = pixelOffset + row * stride + x * 4;
      buffer[offset] = pixel.r;
      buffer[offset + 1] = pixel.g;
      buffer[offset + 2] = pixel.b;
      buffer[offset + 3] = 255;
    }
  }
  return buffer;
}

test('parseBmp reads BITFIELDS BMPs using their channel masks, not assumed byte order', () => {
  const image = parseBmp(buildBitfieldsBmp(2, 2, () => ({ r: 226, g: 155, b: 11 })));
  assert.equal(image.width, 2);
  // Swapped channels here would mean the masks were ignored.
  assert.deepEqual(image.getPixel(0, 0), { r: 226, g: 155, b: 11 });
});

test('parseBmp still rejects compression modes it cannot decode', () => {
  const bmp = buildBitfieldsBmp(2, 2, () => ({ r: 1, g: 2, b: 3 }));
  const rle = Buffer.from(bmp);
  rle.writeUInt32LE(2, 30);
  assert.throws(() => parseBmp(rle), /Unsupported BMP compression/);

  const shallow = Buffer.from(bmp);
  shallow.writeUInt16LE(24, 28);
  assert.throws(() => parseBmp(shallow), /Unsupported BITFIELDS depth/);
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

test('live sips conversion reads a PNG screenshot instead of skipping it', { skip: !sipsAvailable }, () => {
  // sips converts PNG to a BITFIELDS BMP. That used to throw, loadScreenshotPixels
  // swallowed it, and every pixel rule silently found nothing on PNG captures.
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-pixels-png-'));
  const sourceBmp = path.join(tempDir, 'source.bmp');
  const png = path.join(tempDir, 'source.png');
  try {
    fs.writeFileSync(sourceBmp, buildBmp(8, 8, (x) => (x < 4 ? { r: 226, g: 155, b: 11 } : { r: 0, g: 0, b: 0 })));
    assert.equal(run(`sips -s format png ${JSON.stringify(sourceBmp)} --out ${JSON.stringify(png)}`).status, 0);

    const image = loadScreenshotPixels(png);
    assert.ok(image, 'expected a PNG screenshot to produce pixels');
    assert.equal(image.width, 8);
    assert.deepEqual(image.getPixel(0, 0), { r: 226, g: 155, b: 11 });
    assert.deepEqual(image.getPixel(7, 7), { r: 0, g: 0, b: 0 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
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
