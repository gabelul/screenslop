// Token drift: compare the accent colors actually on screen against the color
// tokens the private design profile learned. The tokextract audit concept —
// "this screen uses #FF6B35, the profile says the accent is #E8590C" — but
// computed from screenshot pixels instead of source ASTs. Everything here is
// design-lane material: drift is measured against a learned profile that may
// itself be stale, so findings stay low-confidence and never claim the
// verified-fixed track.

import { attributeColor } from './color-attribution.mjs';

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
// Two candidates whose distances sit within 5 of each other count as a tie;
// the semantic role wins the tie because roles are what reviewers should
// reach for, not the raw primitive that happens to share the value.
const semanticTieDistance = 5;
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
    // Suppression uses the true minimum distance: an accent sitting on any
    // token is on-token, even when a semantic tie-break would report a
    // slightly farther role as the nearest.
    if (!nearest || nearest.minDistance <= nearMissDistance) continue;
    items.push(driftItem(accent, nearest, tokenColors));
  }

  return items
    .sort((left, right) => (right.share - left.share) || left.screenColor.localeCompare(right.screenColor))
    .slice(0, maxDriftItems);
}

/**
 * Builds the item for an accent that turned out to be a derived token variant.
 *
 * This is deliberately not called drift. An app rendering its warning token 22
 * lightness points darker for legibility is using its palette, not abandoning
 * it. The review question is whether that variant deserves a name of its own.
 *
 * @param {object} params Item parameters.
 * @param {object} params.accent Sampled accent bucket.
 * @param {object} params.attribution Attribution result.
 * @param {number} params.sharePercent Rounded share percentage.
 * @param {number} params.share Raw share.
 * @param {string} params.staleness Shared profile-staleness caveat.
 * @returns {object} Design-lane item.
 */
function derivedVariantItem({ accent, attribution, sharePercent, share, staleness }) {
  const ambiguous = attribution.status === 'ambiguous';
  const named = ambiguous
    ? attribution.candidates.map((token) => token.name || token.hex).join(' or ')
    : attribution.token.name || attribution.token.hex;
  const points = Math.abs(Math.round((attribution.lightnessDelta || 0) * 100));
  const direction = (attribution.lightnessDelta || 0) < 0 ? 'darker' : 'lighter';

  return {
    kind: 'design',
    ruleId: 'design.token-derived-variant',
    severity: 'P3',
    confidence: ambiguous ? 'low' : 'medium',
    proofLevel: 'profile-informed',
    screenColor: accent.hex,
    nearestToken: ambiguous ? null : attribution.token.hex,
    nearestTokenName: ambiguous ? null : (attribution.token.name || null),
    nearestTokenLayer: 'unknown',
    distance: null,
    lightnessDelta: Math.round((attribution.lightnessDelta || 0) * 1000) / 1000,
    share,
    title: ambiguous
      ? `Screen accent ${accent.hex} looks like a derived variant of ${named}`
      : `Screen accent ${accent.hex} is ${named} rendered ${points} points ${direction}`,
    detail: ambiguous
      ? `About ${sharePercent}% of the screen's chromatic pixels are ${accent.hex}. Its hue and chroma match more than one learned token (${named}), so this is a derived variant of the palette rather than an unknown color — but the evidence cannot say which token it came from. ${staleness}`
      : `About ${sharePercent}% of the screen's chromatic pixels are ${accent.hex}, which shares hue and chroma with the learned token ${attribution.token.hex} (${named}) at ${points} OKLCh lightness points ${direction}. That is a derived variant, not an unknown accent: RGB distance alone would have called it drift. Worth checking whether this variant should be a named token in its own right rather than computed at the call site. ${staleness}`
  };
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
  const byHex = new Map();
  for (const record of records) {
    // Semantic aliases carry no hex of their own — their value is a reference
    // like "PrimitiveColors.blue500" that the profile's resolution pass turned
    // into resolvedValue. Try the direct value first, then the resolved one.
    const rgb = parseHexColor(`${record?.value || ''} ${record?.name || ''}`)
      || parseHexColor(record?.resolvedValue || '');
    if (!rgb) continue;
    const candidate = { ...rgb, name: String(record?.name || ''), layer: normalizeTokenLayer(record?.layer) };
    const existing = byHex.get(rgb.hex);
    // The same hex twice usually means a semantic role aliasing a primitive —
    // keep the semantic record so drift items name the role, not the raw value.
    if (!existing || (existing.layer !== 'semantic' && candidate.layer === 'semantic')) byHex.set(rgb.hex, candidate);
  }
  return [...byHex.values()];
}

/**
 * Normalizes a token's layer field; profiles written before layers existed
 * simply have no field, and those tokens classify as 'unknown'.
 * @param {string|undefined} layer Raw layer value from the token record.
 * @returns {'primitive'|'semantic'|'component'|'unknown'} Safe layer value.
 */
function normalizeTokenLayer(layer) {
  return layer === 'primitive' || layer === 'semantic' || layer === 'component' ? layer : 'unknown';
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
 * Finds the profile token nearest to an accent color, with a semantic tie-break.
 * When a semantic role sits within `semanticTieDistance` of the closest match,
 * the role is reported as nearest — pointing a reviewer at "use the role" beats
 * pointing at the primitive it aliases. The raw minimum distance is preserved
 * so on-token suppression never loosens.
 * @param {{r:number,g:number,b:number}} accent Accent bucket color.
 * @param {{hex:string,r:number,g:number,b:number,name:string,layer:string}[]} tokenColors Parsed token colors.
 * @returns {{hex:string,name:string|null,layer:string,distance:number,minDistance:number,semanticAlternative:{name:string|null,hex:string,distance:number}|null}|null} Nearest token details.
 */
function nearestToken(accent, tokenColors) {
  let best = null;
  let bestSemantic = null;
  for (const token of tokenColors) {
    const distance = Math.hypot(accent.r - token.r, accent.g - token.g, accent.b - token.b);
    if (!best || distance < best.distance) best = { ...token, distance };
    if (token.layer === 'semantic' && (!bestSemantic || distance < bestSemantic.distance)) bestSemantic = { ...token, distance };
  }
  if (!best) return null;

  const semanticWinsTie = bestSemantic && best.layer !== 'semantic' && bestSemantic.distance <= best.distance + semanticTieDistance;
  const chosen = semanticWinsTie ? bestSemantic : best;
  return {
    hex: chosen.hex,
    name: chosen.name || null,
    layer: chosen.layer || 'unknown',
    distance: chosen.distance,
    minDistance: best.distance,
    semanticAlternative: chosen.layer !== 'semantic' && bestSemantic
      ? { name: bestSemantic.name || null, hex: bestSemantic.hex, distance: bestSemantic.distance }
      : null
  };
}

/**
 * Builds one drift or near-miss item for the design lane.
 * @param {{hex:string,share:number}} accent Accent bucket.
 * @param {{hex:string,name:string|null,layer:string,distance:number,semanticAlternative:object|null}} nearest Nearest token match.
 * @returns {object} Design-lane drift item.
 */
function driftItem(accent, nearest, tokenColors = []) {
  const isDrift = nearest.distance > driftDistance;
  const share = Math.round(accent.share * 1000) / 1000;
  const sharePercent = Math.round(share * 100);
  const staleness = 'Drift is measured against the learned design profile, which may itself be stale — treat this as a review prompt, not a measured defect.';

  // Before claiming the profile never learned this color, check whether it is a
  // derived variant of one. Apps darken status hues for legibility constantly,
  // and RGB distance puts those variants 100+ away from their own token —
  // measured at 109 and 132 on a real device. Calling that "an accent the
  // profile never learned" is simply wrong, and it is the loudest way to be
  // wrong, because it reads as "someone hardcoded a color".
  if (isDrift) {
    const attribution = attributeColor(accent, tokenColors);
    if (attribution.status === 'derived' || attribution.status === 'ambiguous') {
      return derivedVariantItem({ accent, attribution, sharePercent, share, staleness });
    }
  }
  // When the nearest token is a raw primitive but a semantic role also sits
  // within the near-miss band, nudge toward the role — that's the fix a
  // layered design system actually wants.
  const semanticAside = nearest.layer === 'primitive'
    && nearest.semanticAlternative
    && nearest.semanticAlternative.distance <= driftDistance
    ? ` The semantic role ${nearest.semanticAlternative.name || nearest.semanticAlternative.hex} (${nearest.semanticAlternative.hex}) sits almost as close at RGB distance ${Math.round(nearest.semanticAlternative.distance)} — prefer the role over the raw primitive.`
    : '';

  return {
    kind: 'design',
    ruleId: isDrift ? 'design.token-drift' : 'design.token-near-miss',
    severity: 'P3',
    confidence: 'low',
    proofLevel: 'profile-informed',
    screenColor: accent.hex,
    nearestToken: nearest.hex,
    nearestTokenName: nearest.name || null,
    nearestTokenLayer: nearest.layer || 'unknown',
    distance: Math.round(nearest.distance * 10) / 10,
    share,
    title: isDrift
      ? `Screen accent ${accent.hex} is not in the design profile`
      : `Screen accent ${accent.hex} looks like a hand-rolled ${nearest.hex}`,
    detail: isDrift
      ? `About ${sharePercent}% of the screen's chromatic pixels are ${accent.hex}, and the closest learned color token is ${nearest.hex} at RGB distance ${Math.round(nearest.distance)} — too far to be the same color. Either the screen uses an accent the profile never learned, or the profile needs a refresh.${semanticAside} ${staleness}`
      : `About ${sharePercent}% of the screen's chromatic pixels are ${accent.hex}, sitting RGB distance ${Math.round(nearest.distance)} from the learned token ${nearest.hex}. That gap is the classic magic-number drift: a hardcoded approximation of a token instead of the token itself.${semanticAside} ${staleness}`
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
