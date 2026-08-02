import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { quote, run } from '../runtime/shell.mjs';

// Pixel access without a dependency: macOS `sips` converts the screenshot to
// BMP, which is simple enough to parse by hand. Anywhere sips or the image is
// unavailable (Linux CI, fixture stubs, corrupt captures), this module returns
// null and pixel-based detectors skip silently instead of failing critique.

/**
 * Loads screenshot pixels for evidence analysis.
 * @param {string|null|undefined} screenshotPath Absolute screenshot path (JPEG/PNG/HEIC).
 * @param {object} [options] Options.
 * @param {(sourcePath: string) => Buffer|null} [options.convert] BMP converter override for tests.
 * @returns {{width:number,height:number,getPixel:(x:number,y:number)=>{r:number,g:number,b:number}}|null} Pixel accessor or null.
 */
export function loadScreenshotPixels(screenshotPath, options = {}) {
  if (!screenshotPath || !fs.existsSync(screenshotPath)) return null;
  const convert = options.convert || sipsConvert;
  const buffer = convert(screenshotPath);
  if (!buffer) return null;
  try {
    return parseBmp(buffer);
  } catch {
    return null;
  }
}

/**
 * Converts an image to BMP bytes with macOS sips.
 * @param {string} sourcePath Source image path.
 * @returns {Buffer|null} BMP bytes or null when conversion is unavailable.
 */
function sipsConvert(sourcePath) {
  let tempDir = null;
  try {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-pixels-'));
    const outPath = path.join(tempDir, 'frame.bmp');
    const result = run(`sips -s format bmp ${quote(sourcePath)} --out ${quote(outPath)}`);
    if (result.status !== 0 || !fs.existsSync(outPath)) return null;
    return fs.readFileSync(outPath);
  } catch {
    return null;
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * Parses a 24/32bpp BMP buffer.
 *
 * sips emits 24bpp with negative height (top-down rows); classic BMPs are
 * bottom-up with positive height. Both are handled.
 *
 * It also emits BI_BITFIELDS (compression 3) whenever the source image carries
 * an alpha channel, which every PNG screenshot does. Rejecting that used to
 * make `loadScreenshotPixels` return null, and since pixel rules skip silently
 * on a null image, a PNG capture quietly produced zero color findings instead
 * of an error. Channel positions come from the header masks rather than an
 * assumed BGRA order.
 *
 * @param {Buffer} buffer BMP bytes.
 * @returns {{width:number,height:number,getPixel:(x:number,y:number)=>{r:number,g:number,b:number}}} Pixel accessor.
 */
export function parseBmp(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 54 || buffer.toString('ascii', 0, 2) !== 'BM') {
    throw new Error('Not a BMP buffer.');
  }

  const pixelOffset = buffer.readUInt32LE(10);
  const width = buffer.readInt32LE(18);
  const rawHeight = buffer.readInt32LE(22);
  const bitsPerPixel = buffer.readUInt16LE(28);
  const compression = buffer.readUInt32LE(30);

  if (width <= 0 || rawHeight === 0) throw new Error('Invalid BMP dimensions.');
  if (bitsPerPixel !== 24 && bitsPerPixel !== 32) throw new Error(`Unsupported BMP depth: ${bitsPerPixel}bpp.`);
  if (compression !== 0 && compression !== 3) throw new Error(`Unsupported BMP compression: ${compression}.`);
  if (compression === 3 && bitsPerPixel !== 32) {
    throw new Error(`Unsupported BITFIELDS depth: ${bitsPerPixel}bpp.`);
  }

  const masks = compression === 3 ? readChannelMasks(buffer) : null;
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  const bytesPerPixel = bitsPerPixel / 8;
  const stride = Math.ceil((width * bytesPerPixel) / 4) * 4;
  if (buffer.length < pixelOffset + stride * height) throw new Error('Truncated BMP pixel data.');

  return {
    width,
    height,
    getPixel(x, y) {
      const clampedX = Math.min(Math.max(Math.floor(x), 0), width - 1);
      const clampedY = Math.min(Math.max(Math.floor(y), 0), height - 1);
      const row = topDown ? clampedY : height - 1 - clampedY;
      const offset = pixelOffset + row * stride + clampedX * bytesPerPixel;
      if (masks) {
        const raw = buffer.readUInt32LE(offset);
        return {
          r: channelValue(raw, masks.r),
          g: channelValue(raw, masks.g),
          b: channelValue(raw, masks.b)
        };
      }
      // BI_RGB stores channels as BGR(A).
      return { r: buffer[offset + 2], g: buffer[offset + 1], b: buffer[offset] };
    }
  };
}

/**
 * Reads the RGB channel masks that follow a BITFIELDS header.
 * They sit at a fixed offset in both BITMAPINFOHEADER and the V4/V5 headers.
 * @param {Buffer} buffer BMP bytes.
 * @returns {{r:object,g:object,b:object}} Decoded channel masks.
 */
function readChannelMasks(buffer) {
  if (buffer.length < 66) throw new Error('Truncated BMP channel masks.');
  const red = describeMask(buffer.readUInt32LE(54));
  const green = describeMask(buffer.readUInt32LE(58));
  const blue = describeMask(buffer.readUInt32LE(62));
  if (!red || !green || !blue) throw new Error('Missing BMP channel masks.');
  return { r: red, g: green, b: blue };
}

/**
 * Precomputes the shift and full-scale value for one channel mask.
 * @param {number} mask Channel bit mask.
 * @returns {{mask:number,shift:number,max:number}|null} Mask descriptor, or null when empty.
 */
function describeMask(mask) {
  if (!mask) return null;
  let shift = 0;
  while (shift < 32 && !((mask >>> shift) & 1)) shift += 1;
  return { mask, shift, max: mask >>> shift };
}

/**
 * Extracts one 0-255 channel from a packed BITFIELDS pixel.
 * @param {number} raw Packed 32-bit pixel.
 * @param {{mask:number,shift:number,max:number}} descriptor Channel mask descriptor.
 * @returns {number} Channel value 0-255.
 */
function channelValue(raw, descriptor) {
  const value = (raw & descriptor.mask) >>> descriptor.shift;
  return descriptor.max === 255 ? value : Math.round((value * 255) / descriptor.max);
}

/**
 * Computes WCAG relative luminance for an sRGB pixel.
 * @param {{r:number,g:number,b:number}} pixel Pixel channels 0-255.
 * @returns {number} Relative luminance 0-1.
 */
export function relativeLuminance(pixel) {
  const channel = (value) => {
    const scaled = value / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(pixel.r) + 0.7152 * channel(pixel.g) + 0.0722 * channel(pixel.b);
}

/**
 * Computes the WCAG contrast ratio between two luminances.
 * @param {number} a First relative luminance.
 * @param {number} b Second relative luminance.
 * @returns {number} Contrast ratio 1-21.
 */
export function contrastRatio(a, b) {
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Builds a synthetic 24bpp bottom-up BMP for tests and fixtures.
 * @param {number} width Image width.
 * @param {number} height Image height.
 * @param {(x:number,y:number)=>{r:number,g:number,b:number}} paint Pixel painter (top-left origin).
 * @returns {Buffer} BMP bytes.
 */
export function buildBmp(width, height, paint) {
  const stride = Math.ceil((width * 3) / 4) * 4;
  const pixelBytes = stride * height;
  const buffer = Buffer.alloc(54 + pixelBytes);
  buffer.write('BM', 0, 'ascii');
  buffer.writeUInt32LE(buffer.length, 2);
  buffer.writeUInt32LE(54, 10);
  buffer.writeUInt32LE(40, 14);
  buffer.writeInt32LE(width, 18);
  buffer.writeInt32LE(height, 22); // positive = bottom-up
  buffer.writeUInt16LE(1, 26);
  buffer.writeUInt16LE(24, 28);

  for (let y = 0; y < height; y += 1) {
    const row = height - 1 - y;
    for (let x = 0; x < width; x += 1) {
      const pixel = paint(x, y);
      const offset = 54 + row * stride + x * 3;
      buffer[offset] = pixel.b;
      buffer[offset + 1] = pixel.g;
      buffer[offset + 2] = pixel.r;
    }
  }
  return buffer;
}
