import { createFinding } from '../findings.mjs';
import { loadScreenshotPixels } from '../pixels.mjs';

// Color balance is the 60/30/10 rule seen from both failure ends: a screen with
// zero accent color reads as unfinished gray soup, and a screen where four-plus
// hue families all shout at once has no accent at all — just noise. Both checks
// work on a coarse pixel sample of the whole screenshot, no AX data needed.

// Sample the screenshot on a grid of roughly this many points; enough to see
// the palette, cheap enough to run on every capture.
const targetSampleCount = 2000;
// Channel spread at or below this counts as neutral (gray/near-gray).
const neutralChromaMax = 12;
// Quantize channels to 32-step buckets so anti-aliased shades of the same
// color collapse into one accent family instead of thousands of singletons.
const bucketStep = 32;
// Rule A gates: the screen is "colorless" when nearly everything is neutral
// AND no single accent color covers a visible slice of the screen.
const monochromeNeutralShareMin = 0.97;
const monochromeAccentShareMax = 0.01;
// Rule B gates: hue clustering only means something when a real chunk of the
// screen is colored; 12 bins of 30 degrees, a bin "competes" at 8%+ of the
// colored samples, and 4+ competing families is too many.
const competingNonNeutralShareMin = 0.15;
const hueBinCount = 12;
const competingBinShareMin = 0.08;
const competingBinMin = 4;

/**
 * Finds color-balance issues from screenshot pixels: screens with no accent
 * color at all, and screens where too many accent hue families compete.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes (unused; screen-level rules).
 * @param {object} [options] Options.
 * @param {Function} [options.loadPixels] Pixel loader override for tests.
 * @returns {object[]} Color balance findings.
 */
export function detectColorBalanceIssues(context, nodes, options = {}) {
  const screenshot = context.artifacts.screenshot;
  if (!screenshot?.exists) return [];

  const pixels = (options.loadPixels || loadScreenshotPixels)(screenshot.absolutePath, options);
  if (!pixels) return [];

  const sample = samplePalette(pixels);
  if (sample.total === 0) return [];

  const findings = [];
  const monochrome = monochromeMuteFinding(context, sample);
  if (monochrome) findings.push(monochrome);
  const competing = competingAccentsFinding(context, sample);
  if (competing) findings.push(competing);
  return findings;
}

/**
 * Samples the screenshot on a coarse grid and tallies neutral share, accent
 * color buckets, and hue-bin counts for the non-neutral samples.
 * @param {{width:number,height:number,getPixel:Function}} pixels Pixel accessor.
 * @returns {{total:number,neutral:number,accentBuckets:Map<string,number>,hueBins:number[]}} Palette tally.
 */
function samplePalette(pixels) {
  const step = Math.max(1, Math.floor(Math.sqrt((pixels.width * pixels.height) / targetSampleCount)));
  const accentBuckets = new Map();
  const hueBins = new Array(hueBinCount).fill(0);
  let total = 0;
  let neutral = 0;

  for (let y = 0; y < pixels.height; y += step) {
    for (let x = 0; x < pixels.width; x += step) {
      const pixel = pixels.getPixel(x, y);
      total += 1;

      const chroma = Math.max(pixel.r, pixel.g, pixel.b) - Math.min(pixel.r, pixel.g, pixel.b);
      if (chroma <= neutralChromaMax) {
        neutral += 1;
        continue;
      }

      const bucket = `${Math.floor(pixel.r / bucketStep)},${Math.floor(pixel.g / bucketStep)},${Math.floor(pixel.b / bucketStep)}`;
      accentBuckets.set(bucket, (accentBuckets.get(bucket) || 0) + 1);
      hueBins[Math.min(hueBinCount - 1, Math.floor(rgbToHue(pixel) / (360 / hueBinCount)))] += 1;
    }
  }

  return { total, neutral, accentBuckets, hueBins };
}

/**
 * Rule A: flags a screen that is effectively colorless — near-total neutral
 * coverage with no accent color big enough to register.
 * @param {object} context Critique context.
 * @param {object} sample Palette tally from samplePalette.
 * @returns {object|null} Finding or null.
 */
function monochromeMuteFinding(context, sample) {
  const neutralShare = sample.neutral / sample.total;
  if (neutralShare < monochromeNeutralShareMin) return null;

  const topAccentShare = Math.max(0, ...sample.accentBuckets.values()) / sample.total;
  if (topAccentShare >= monochromeAccentShareMax) return null;

  const neutralPct = roundPct(neutralShare);
  const accentPct = roundPct(topAccentShare);
  return createFinding({
    ruleId: 'color.monochrome-mute',
    severity: 'P3',
    pillar: 'color',
    title: 'Screen is effectively colorless',
    detail: `${neutralPct}% of sampled pixels are near-neutral and the largest accent color covers only ${accentPct}% of the screen. With no accent at all, nothing signals what matters — the inverse failure of the 60/30/10 rule.`,
    evidence: {
      artifact: context.artifacts.screenshot.displayPath || null,
      note: `neutral share ${neutralPct}%, largest accent bucket ${accentPct}% of ${sample.total} samples`
    },
    suggestedFix: 'Give the primary action or key status one clear accent color (tint color, highlighted state) so the screen has a visual anchor.',
    verification: 'Recapture and confirm at least one accent color covers a visible share of the screen, or document the monochrome palette as intentional.',
    confidence: 'low',
    effort: 'medium',
    fingerprint: `monochrome-mute:${neutralPct}:${accentPct}`
  });
}

/**
 * Rule B: flags a screen where four or more accent hue families each claim a
 * meaningful slice of the colored pixels — accents competing instead of guiding.
 * @param {object} context Critique context.
 * @param {object} sample Palette tally from samplePalette.
 * @returns {object|null} Finding or null.
 */
function competingAccentsFinding(context, sample) {
  const nonNeutral = sample.total - sample.neutral;
  const nonNeutralShare = nonNeutral / sample.total;
  if (nonNeutralShare < competingNonNeutralShareMin) return null;

  const competingBins = sample.hueBins.filter((count) => count >= nonNeutral * competingBinShareMin).length;
  if (competingBins < competingBinMin) return null;

  const nonNeutralPct = roundPct(nonNeutralShare);
  return createFinding({
    ruleId: 'color.competing-accents',
    severity: 'P3',
    pillar: 'color',
    title: 'Too many accent color families compete',
    detail: `${competingBins} distinct hue families each cover 8%+ of the colored pixels (${nonNeutralPct}% of the screen is non-neutral). When four or more accents carry equal weight, none of them reads as the accent.`,
    evidence: {
      artifact: context.artifacts.screenshot.displayPath || null,
      note: `${competingBins} hue bins at 8%+ of non-neutral samples; non-neutral share ${nonNeutralPct}% of ${sample.total} samples`
    },
    suggestedFix: 'Pick one dominant accent (plus at most one secondary) and demote the rest to neutrals or muted tints.',
    verification: 'Recapture and confirm fewer than four hue families each cover 8%+ of the colored pixels.',
    confidence: 'low',
    effort: 'medium',
    fingerprint: `competing-accents:${competingBins}:${nonNeutralPct}`
  });
}

/**
 * Computes the HSL hue angle for an sRGB pixel.
 * @param {{r:number,g:number,b:number}} pixel Pixel channels 0-255.
 * @returns {number} Hue in degrees 0-360.
 */
function rgbToHue(pixel) {
  const r = pixel.r / 255;
  const g = pixel.g / 255;
  const b = pixel.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  if (delta === 0) return 0;

  let hue;
  if (max === r) hue = ((g - b) / delta) % 6;
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return ((hue * 60) + 360) % 360;
}

/**
 * Rounds a 0-1 share to a one-decimal percentage for reports and fingerprints.
 * @param {number} share Share 0-1.
 * @returns {number} Percentage rounded to one decimal.
 */
function roundPct(share) {
  return Math.round(share * 1000) / 10;
}
