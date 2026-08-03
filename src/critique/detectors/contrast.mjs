import { attributeColor, describeAttribution } from '../../design/color-attribution.mjs';
import { accessibleName, isVisibleEnabled, nodeEvidence, rootFrame } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';
import { contrastRatio, loadScreenshotPixels, relativeLuminance } from '../pixels.mjs';

// WCAG 1.4.3: normal text needs 4.5:1, large text gets away with 3:1.
// Apple's HIG points-based cutoff for "large" is roughly 24pt of AX frame height.
const normalTextMinimum = 4.5;
const largeTextMinimum = 3.0;
const largeTextMinHeight = 24;
// Below caption height, sampled ratios read low (anti-aliasing) — the finding
// text carries a caveat and confidence drops.
const tinyTextMaxHeight = 14;
// Below this the two luminance clusters are one surface (photo, fill, divider),
// not text-on-background, and sampling has nothing meaningful to say.
const flatClusterRatio = 1.05;
// One screen full of washed-out gray produces dozens of identical hits; five
// worst offenders make the point without drowning the report.
const maxFindingsPerScreen = 5;
// ~20x20 grid caps sampling at ~400 pixels per region regardless of size.
const maxSamplesPerAxis = 20;
// Anything under 8x8pt is an icon sliver or divider, not readable text.
const minCandidateSize = 8;
// Share of the text cluster treated as glyph core when estimating the drawn
// color. Most text samples are antialiased edge pixels blended toward the
// background; the quarter furthest from it carries the real color.
const textCoreShare = 0.25;
// Captures are JPEG — Baguette emits nothing else — so sampled channels drift a
// couple of units on flat fills and far more on antialiased text edges, which is
// exactly where contrast gets measured. A ratio sitting near its threshold is
// inside that noise and could flip either way; a ratio far below it is
// unarguable no matter what the codec did. Confidence tracks that distance,
// because "2.1 against 4.5" and "4.4 against 4.5" are not the same claim.
const noiseBandNormal = 0.4;
const strongMarginNormal = 1.2;
// Small text is mostly edge pixels, so sampling understates it in one direction.
// That skew only ever makes the real ratio higher, so tiny text needs a wider
// margin to earn the same confidence — not a flat downgrade.
const noiseBandTiny = 1.0;
const strongMarginTiny = 2.0;

const textLikeRolePattern = /text|static|label|button/i;

/**
 * Estimates text contrast by sampling screenshot pixels under text-bearing AX frames.
 * Luminances inside each frame are split into two clusters (text vs background);
 * the contrast ratio between cluster means is checked against WCAG minimums.
 * Skips silently when pixels are unavailable (Linux CI, fixture stubs).
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @param {object} [options] Options.
 * @param {(path: string, options: object) => object|null} [options.loadPixels] Pixel loader override for tests.
 * @returns {object[]} Contrast findings, worst ratios first, capped per screen.
 */
export function detectContrastIssues(context, nodes, options = {}) {
  if (context.artifacts.screenshot?.exists === false) return [];
  const image = (options.loadPixels || loadScreenshotPixels)(context.artifacts.screenshot?.absolutePath, options);
  if (!image) return [];

  const bounds = rootFrame(nodes);
  if (!bounds || !(Number(bounds.width) > 0)) return [];

  // AX frames are in points; the screenshot is in device pixels.
  const scale = image.width / Number(bounds.width);

  const failing = [];
  for (const node of nodes.filter(isContrastCandidate)) {
    const region = pixelRegion(node.frame, bounds, scale, image);
    if (!region) continue;

    const measured = measureRegionContrast(image, region);
    if (!measured) continue;

    const isLargeText = Number(node.frame.height) >= largeTextMinHeight;
    const required = isLargeText ? largeTextMinimum : normalTextMinimum;
    if (measured.ratio >= required) continue;

    failing.push({ node, ratio: measured.ratio, required, isLargeText, textColor: measured.textColor });
  }

  failing.sort((left, right) => left.ratio - right.ratio);
  return failing
    .slice(0, maxFindingsPerScreen)
    .map((entry) => contrastFinding(context, entry, options.colorTokens || []));
}

/**
 * Returns true for visible, named, text-bearing nodes big enough to sample.
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the node is a contrast candidate.
 */
function isContrastCandidate(node) {
  if (!isVisibleEnabled(node) || !node.frame) return false;
  if (!textLikeRolePattern.test(String(node.role || ''))) return false;
  if (!accessibleName(node)) return false;
  const width = Number(node.frame.width);
  const height = Number(node.frame.height);
  return Number.isFinite(width) && Number.isFinite(height)
    && width >= minCandidateSize && height >= minCandidateSize;
}

/**
 * Maps a point-space AX frame into an integer pixel region on the screenshot.
 * @param {object} frame AX frame in points.
 * @param {object} bounds Root frame in points.
 * @param {number} scale Device pixels per point.
 * @param {object} image Pixel accessor.
 * @returns {{x:number,y:number,width:number,height:number}|null} Pixel region, or null when it falls outside the image.
 */
function pixelRegion(frame, bounds, scale, image) {
  const x = Math.round((Number(frame.x) - Number(bounds.x || 0)) * scale);
  const y = Math.round((Number(frame.y) - Number(bounds.y || 0)) * scale);
  const width = Math.round(Number(frame.width) * scale);
  const height = Math.round(Number(frame.height) * scale);
  if (![x, y, width, height].every(Number.isFinite)) return null;
  if (x < 0 || y < 0 || width < 1 || height < 1) return null;
  if (x + width > image.width || y + height > image.height) return null;
  return { x, y, width, height };
}

/**
 * Samples a pixel grid inside the region and estimates text-vs-background contrast.
 * Luminances are sorted and split at the largest gap; the smaller cluster is
 * assumed to be text, the larger one background.
 * @param {object} image Pixel accessor.
 * @param {{x:number,y:number,width:number,height:number}} region Pixel region.
 * @returns {{ratio:number, textColor:object|null}|null} Measured contrast, or null for flat regions.
 */
function measureRegionContrast(image, region) {
  const stepX = Math.max(1, Math.floor(region.width / maxSamplesPerAxis));
  const stepY = Math.max(1, Math.floor(region.height / maxSamplesPerAxis));

  const samples = [];
  for (let y = region.y; y < region.y + region.height; y += stepY) {
    for (let x = region.x; x < region.x + region.width; x += stepX) {
      const pixel = image.getPixel(x, y);
      samples.push({ pixel, luminance: relativeLuminance(pixel) });
    }
  }
  if (samples.length < 2) return null;

  samples.sort((left, right) => left.luminance - right.luminance);
  let splitIndex = 1;
  let largestGap = -1;
  for (let i = 1; i < samples.length; i += 1) {
    const gap = samples[i].luminance - samples[i - 1].luminance;
    if (gap > largestGap) {
      largestGap = gap;
      splitIndex = i;
    }
  }

  const lower = samples.slice(0, splitIndex);
  const upper = samples.slice(splitIndex);
  const lowerMean = mean(lower.map((entry) => entry.luminance));
  const upperMean = mean(upper.map((entry) => entry.luminance));
  const ratio = contrastRatio(lowerMean, upperMean);
  // Nearly identical clusters = solid fill or photo, not text over a background.
  if (ratio < flatClusterRatio) return null;

  // Glyphs cover less of a label's box than its background does, so the smaller
  // cluster is the text.
  const [text, background] = lower.length <= upper.length ? [lower, upper] : [upper, lower];
  return { ratio, textColor: representativeTextColor(text, background) };
}

/**
 * Estimates the color the glyphs were actually drawn in.
 *
 * Averaging the whole text cluster reports a color blended toward the
 * background, because most glyph samples land on antialiased edges. Averaging a
 * single extreme pixel is noise. So this averages the most saturated core of
 * the cluster — the pixels furthest from the background — which on a real
 * device reproduced the app's rendered token variant closely enough to
 * attribute it.
 *
 * @param {{pixel:object}[]} text Text cluster samples.
 * @param {{pixel:object}[]} background Background cluster samples.
 * @returns {{r:number,g:number,b:number}|null} Representative glyph color.
 */
function representativeTextColor(text, background) {
  if (text.length === 0 || background.length === 0) return null;
  const backgroundMean = meanPixel(background.map((entry) => entry.pixel));
  const ranked = [...text].sort((left, right) => (
    pixelDistance(right.pixel, backgroundMean) - pixelDistance(left.pixel, backgroundMean)
  ));
  const coreCount = Math.max(1, Math.round(ranked.length * textCoreShare));
  return meanPixel(ranked.slice(0, coreCount).map((entry) => entry.pixel));
}

/**
 * Averages a list of pixels channel by channel.
 * @param {{r:number,g:number,b:number}[]} pixels Pixels to average.
 * @returns {{r:number,g:number,b:number}} Mean pixel, rounded.
 */
function meanPixel(pixels) {
  const total = pixels.reduce((acc, pixel) => ({
    r: acc.r + pixel.r,
    g: acc.g + pixel.g,
    b: acc.b + pixel.b
  }), { r: 0, g: 0, b: 0 });
  return {
    r: Math.round(total.r / pixels.length),
    g: Math.round(total.g / pixels.length),
    b: Math.round(total.b / pixels.length)
  };
}

/**
 * Formats a pixel as a hex string for finding evidence.
 * @param {{r:number,g:number,b:number}} pixel Pixel to format.
 * @returns {string} Uppercase hex color.
 */
function hexOf(pixel) {
  return `#${[pixel.r, pixel.g, pixel.b].map((value) => value.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/**
 * Euclidean RGB distance between two pixels.
 * @param {{r:number,g:number,b:number}} a First pixel.
 * @param {{r:number,g:number,b:number}} b Second pixel.
 * @returns {number} Distance.
 */
function pixelDistance(a, b) {
  return Math.sqrt((a.r - b.r) ** 2 + (a.g - b.g) ** 2 + (a.b - b.b) ** 2);
}

/**
 * Builds the finding for one failing region.
 * @param {object} context Critique context.
 * @param {{node:object,ratio:number,required:number,isLargeText:boolean}} entry Measured failure.
 * @returns {object} Contrast finding.
 */
function contrastFinding(context, entry, colorTokens) {
  const { node, ratio, required, isLargeText, textColor } = entry;
  const name = accessibleName(node);
  // Small text is mostly anti-aliased edge pixels, which drag the sampled
  // text cluster toward the background and understate the true ratio. The
  // finding stays (a caption that measures 2:1 is failing even if it's really
  // 3:1), but the number deserves less trust below caption size.
  const isTinyText = Number(node.frame.height) < tinyTextMaxHeight;
  const tinyCaveat = isTinyText
    ? ' At this text size, anti-aliasing skews sampling low — the real ratio is likely somewhat higher, so verify the tokens before trusting the exact number.'
    : '';

  // How far below the threshold the measurement landed decides whether codec
  // noise could have invented this finding.
  const margin = required - ratio;
  const noiseBand = isTinyText ? noiseBandTiny : noiseBandNormal;
  const strongMargin = isTinyText ? strongMarginTiny : strongMarginNormal;
  const withinNoise = margin <= noiseBand;
  const confidence = margin >= strongMargin ? 'high' : withinNoise ? 'low' : 'medium';
  const marginCaveat = withinNoise
    ? ` At only ${round(margin)} below the ${required}:1 threshold, this sits inside JPEG sampling noise — treat it as a prompt to check the real color tokens, not as a confirmed failure.`
    : '';

  // A pair that fails in one appearance can clear the threshold in the other:
  // status hues get lightened for dark surfaces and collapse against light ones.
  // A single `see` bundle records `appearance: unspecified`, so critique has no
  // way to know which one it just measured — say so instead of implying both.
  // Naming the token turns "sampled #8A6410 measures 2.9:1" into a root cause a
  // reader can act on. It is additive context only: it never moves the severity
  // or the confidence, because the failing ratio is measured from the capture
  // while the token name comes from a learned profile that may be stale. If no
  // profile exists, or the color cannot be traced, the finding reads as before.
  const attribution = textColor && colorTokens.length > 0
    ? attributeColor(textColor, colorTokens)
    : null;
  const attributionNote = attribution ? describeAttribution(attribution) : '';

  const appearance = context.manifest?.environment?.appearance;
  const appearanceNote = !appearance || appearance === 'unspecified'
    ? ' This bundle does not record which appearance was captured, and contrast findings are often appearance-specific — run `screenslop matrix` to check the other appearance before assuming this fails everywhere.'
    : '';

  return createFinding({
    ruleId: 'color.contrast',
    severity: ratio < largeTextMinimum ? 'P1' : 'P2',
    pillar: 'color',
    title: 'Text contrast falls below the WCAG minimum',
    detail: `"${name}" measures a contrast ratio of ${round(ratio)}:1 against its sampled background; ${isLargeText ? 'large' : 'normal'} text needs at least ${required}:1. This is a pixel-sampled estimate from the screenshot, not a color-token verdict — verify against the actual foreground/background tokens.${attributionNote}${marginCaveat}${tinyCaveat}`,
    evidence: {
      artifact: context.artifacts.screenshot?.displayPath || null,
      node: nodeEvidence(node),
      screenshotRegion: node.frame,
      note: `measured contrast ratio ${round(ratio)}:1 from pixel sampling`,
      ...(textColor ? { sampledTextColor: hexOf(textColor) } : {}),
      ...(attribution && attribution.token
        ? { attributedToken: attribution.token.name || attribution.token.hex, attribution: attribution.status }
        : {})
    },
    suggestedFix: 'Darken the text color or lighten the background (or vice versa in dark mode) until the pair clears the WCAG threshold; prefer system label colors, which handle this automatically.',
    verification: `Recapture and confirm the measured ratio for "${name}" is at least ${required}:1, or confirm the real color tokens pass a contrast checker.${appearanceNote}`,
    confidence,
    effort: 'small',
    fingerprint: `contrast:${node.path}:${Math.round(ratio * 10)}`
  });
}

/**
 * Averages a non-empty list of numbers.
 * @param {number[]} values Numbers to average.
 * @returns {number} Mean value.
 */
function mean(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Rounds numeric output for reports.
 * @param {number} value Number to round.
 * @returns {number} Rounded value.
 */
function round(value) {
  return Math.round(value * 10) / 10;
}
