// Token drift: compare the accent colors actually on screen against the color
// tokens the private design profile learned. The tokextract audit concept —
// "this screen uses #FF6B35, the profile says the accent is #E8590C" — but
// computed from screenshot pixels instead of source ASTs. Everything here is
// design-lane material: drift is measured against a learned profile that may
// itself be stale, so findings stay low-confidence and never claim the
// verified-fixed track.

// ~2000 grid samples keeps the scan cheap while still catching any accent
// region that covers a few percent of the screen.
const targetSampleCount = 2000;
// A pixel whose channels sit within 12 of each other is a gray/neutral —
// backgrounds, text, separators. Only chromatic pixels count as accents.
const neutralChannelSpread = 12;
// Coarse 32-wide RGB buckets: close shades of one accent collapse together
// instead of splintering below the share threshold.
const bucketSize = 32;
// An accent bucket must hold at least 3% of the non-neutral samples to matter.
const accentShareThreshold = 0.03;
// Euclidean RGB distance bands: <= 20 is "close enough to be the token",
// 20-60 smells like a hardcoded approximation, > 60 is a color the profile
// simply does not know.
const nearMissDistance = 20;
const driftDistance = 60;
// Never flood a review with drift items; the biggest accents tell the story.
const maxDriftItems = 4;

/**
 * Detects screen accent colors that drift from the profile's learned color tokens.
 * @param {object} options Detection options.
 * @param {object|null} options.profile Design profile (shape from profile.mjs); missing/partial token data is tolerated.
 * @param {{width:number,height:number,getPixel:(x:number,y:number)=>{r:number,g:number,b:number}}|null} options.image Pixel accessor from loadScreenshotPixels.
 * @returns {object[]} Design-lane drift items, largest accent share first, capped at 4.
 */
export function detectTokenDrift({ profile, image } = {}) {
  if (!image || !Number.isFinite(image.width) || !Number.isFinite(image.height)) return [];
  const tokenColors = extractProfileColorTokens(profile);
  if (tokenColors.length === 0) return [];

  const accents = sampleAccentBuckets(image);
  if (accents.length === 0) return [];

  const items = [];
  for (const accent of accents) {
    const nearest = nearestToken(accent, tokenColors);
    if (!nearest || nearest.distance <= nearMissDistance) continue;
    items.push(driftItem(accent, nearest));
  }

  return items
    .sort((left, right) => (right.share - left.share) || left.screenColor.localeCompare(right.screenColor))
    .slice(0, maxDriftItems);
}

/**
 * Pulls usable hex colors out of the profile's color token records.
 * Token values come from profile.mjs extraction and can be `#E8590C`,
 * `0xFF6B35`, `Color(hex: "FF6B35")`, or non-hex expressions we skip.
 * @param {object|null} profile Design profile.
 * @returns {{hex:string,r:number,g:number,b:number,name:string}[]} Parsed token colors.
 */
export function extractProfileColorTokens(profile) {
  const records = Array.isArray(profile?.tokens?.colors) ? profile.tokens.colors : [];
  const seen = new Set();
  const colors = [];
  for (const record of records) {
    const rgb = parseHexColor(`${record?.value || ''} ${record?.name || ''}`);
    if (!rgb || seen.has(rgb.hex)) continue;
    seen.add(rgb.hex);
    colors.push({ ...rgb, name: String(record?.name || '') });
  }
  return colors;
}

/**
 * Finds the first parseable hex color in token text.
 * @param {string} text Token value/name text.
 * @returns {{hex:string,r:number,g:number,b:number}|null} Parsed color or null.
 */
function parseHexColor(text) {
  const match = String(text).match(/(?:#|0x)([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3})\b/i);
  if (!match) return null;
  let digits = match[1];
  if (digits.length === 3) digits = [...digits].map((char) => char + char).join('');
  const r = parseInt(digits.slice(0, 2), 16);
  const g = parseInt(digits.slice(2, 4), 16);
  const b = parseInt(digits.slice(4, 6), 16);
  return { hex: rgbToHex(r, g, b), r, g, b };
}

/**
 * Samples the screenshot on a coarse grid and buckets chromatic pixels.
 * @param {{width:number,height:number,getPixel:(x:number,y:number)=>{r:number,g:number,b:number}}} image Pixel accessor.
 * @returns {{hex:string,r:number,g:number,b:number,share:number}[]} Accent buckets holding >= 3% of non-neutral samples.
 */
function sampleAccentBuckets(image) {
  const cols = Math.max(1, Math.round(Math.sqrt(targetSampleCount * (image.width / image.height))));
  const rows = Math.max(1, Math.round(targetSampleCount / cols));
  const buckets = new Map();
  let chromatic = 0;

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const pixel = image.getPixel(((col + 0.5) * image.width) / cols, ((row + 0.5) * image.height) / rows);
      const spread = Math.max(pixel.r, pixel.g, pixel.b) - Math.min(pixel.r, pixel.g, pixel.b);
      if (spread <= neutralChannelSpread) continue;
      chromatic += 1;
      const key = `${Math.floor(pixel.r / bucketSize)},${Math.floor(pixel.g / bucketSize)},${Math.floor(pixel.b / bucketSize)}`;
      const bucket = buckets.get(key) || { count: 0, r: 0, g: 0, b: 0 };
      bucket.count += 1;
      bucket.r += pixel.r;
      bucket.g += pixel.g;
      bucket.b += pixel.b;
      buckets.set(key, bucket);
    }
  }

  if (chromatic === 0) return [];
  const accents = [];
  for (const bucket of buckets.values()) {
    const share = bucket.count / chromatic;
    if (share < accentShareThreshold) continue;
    const r = Math.round(bucket.r / bucket.count);
    const g = Math.round(bucket.g / bucket.count);
    const b = Math.round(bucket.b / bucket.count);
    accents.push({ hex: rgbToHex(r, g, b), r, g, b, share });
  }
  return accents;
}

/**
 * Finds the profile token nearest to an accent color.
 * @param {{r:number,g:number,b:number}} accent Accent bucket color.
 * @param {{hex:string,r:number,g:number,b:number}[]} tokenColors Parsed token colors.
 * @returns {{hex:string,distance:number}|null} Nearest token and its RGB distance.
 */
function nearestToken(accent, tokenColors) {
  let best = null;
  for (const token of tokenColors) {
    const distance = Math.hypot(accent.r - token.r, accent.g - token.g, accent.b - token.b);
    if (!best || distance < best.distance) best = { hex: token.hex, distance };
  }
  return best;
}

/**
 * Builds one drift or near-miss item for the design lane.
 * @param {{hex:string,share:number}} accent Accent bucket.
 * @param {{hex:string,distance:number}} nearest Nearest token match.
 * @returns {object} Design-lane drift item.
 */
function driftItem(accent, nearest) {
  const isDrift = nearest.distance > driftDistance;
  const share = Math.round(accent.share * 1000) / 1000;
  const sharePercent = Math.round(share * 100);
  const staleness = 'Drift is measured against the learned design profile, which may itself be stale — treat this as a review prompt, not a measured defect.';

  return {
    kind: 'design',
    ruleId: isDrift ? 'design.token-drift' : 'design.token-near-miss',
    severity: 'P3',
    confidence: 'low',
    proofLevel: 'profile-informed',
    screenColor: accent.hex,
    nearestToken: nearest.hex,
    distance: Math.round(nearest.distance * 10) / 10,
    share,
    title: isDrift
      ? `Screen accent ${accent.hex} is not in the design profile`
      : `Screen accent ${accent.hex} looks like a hand-rolled ${nearest.hex}`,
    detail: isDrift
      ? `About ${sharePercent}% of the screen's chromatic pixels are ${accent.hex}, and the closest learned color token is ${nearest.hex} at RGB distance ${Math.round(nearest.distance)} — too far to be the same color. Either the screen uses an accent the profile never learned, or the profile needs a refresh. ${staleness}`
      : `About ${sharePercent}% of the screen's chromatic pixels are ${accent.hex}, sitting RGB distance ${Math.round(nearest.distance)} from the learned token ${nearest.hex}. That gap is the classic magic-number drift: a hardcoded approximation of a token instead of the token itself. ${staleness}`
  };
}

/**
 * Formats RGB channels as an uppercase hex color.
 * @param {number} r Red 0-255.
 * @param {number} g Green 0-255.
 * @param {number} b Blue 0-255.
 * @returns {string} `#RRGGBB` string.
 */
function rgbToHex(r, g, b) {
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}
