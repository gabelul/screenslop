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

    failing.push({ node, ratio: measured.ratio, required, isLargeText });
  }

  failing.sort((left, right) => left.ratio - right.ratio);
  return failing.slice(0, maxFindingsPerScreen).map((entry) => contrastFinding(context, entry));
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
 * @returns {{ratio:number}|null} Measured contrast, or null for flat regions.
 */
function measureRegionContrast(image, region) {
  const stepX = Math.max(1, Math.floor(region.width / maxSamplesPerAxis));
  const stepY = Math.max(1, Math.floor(region.height / maxSamplesPerAxis));

  const luminances = [];
  for (let y = region.y; y < region.y + region.height; y += stepY) {
    for (let x = region.x; x < region.x + region.width; x += stepX) {
      luminances.push(relativeLuminance(image.getPixel(x, y)));
    }
  }
  if (luminances.length < 2) return null;

  luminances.sort((left, right) => left - right);
  let splitIndex = 1;
  let largestGap = -1;
  for (let i = 1; i < luminances.length; i += 1) {
    const gap = luminances[i] - luminances[i - 1];
    if (gap > largestGap) {
      largestGap = gap;
      splitIndex = i;
    }
  }

  const lowerMean = mean(luminances.slice(0, splitIndex));
  const upperMean = mean(luminances.slice(splitIndex));
  const ratio = contrastRatio(lowerMean, upperMean);
  // Nearly identical clusters = solid fill or photo, not text over a background.
  if (ratio < flatClusterRatio) return null;
  return { ratio };
}

/**
 * Builds the finding for one failing region.
 * @param {object} context Critique context.
 * @param {{node:object,ratio:number,required:number,isLargeText:boolean}} entry Measured failure.
 * @returns {object} Contrast finding.
 */
function contrastFinding(context, entry) {
  const { node, ratio, required, isLargeText } = entry;
  const name = accessibleName(node);
  // Small text is mostly anti-aliased edge pixels, which drag the sampled
  // text cluster toward the background and understate the true ratio. The
  // finding stays (a caption that measures 2:1 is failing even if it's really
  // 3:1), but the number deserves less trust below caption size.
  const isTinyText = Number(node.frame.height) < tinyTextMaxHeight;
  const tinyCaveat = isTinyText
    ? ' At this text size, anti-aliasing skews sampling low — the real ratio is likely somewhat higher, so verify the tokens before trusting the exact number.'
    : '';
  return createFinding({
    ruleId: 'color.contrast',
    severity: ratio < largeTextMinimum ? 'P1' : 'P2',
    pillar: 'color',
    title: 'Text contrast falls below the WCAG minimum',
    detail: `"${name}" measures a contrast ratio of ${round(ratio)}:1 against its sampled background; ${isLargeText ? 'large' : 'normal'} text needs at least ${required}:1. This is a pixel-sampled estimate from the screenshot, not a color-token verdict — verify against the actual foreground/background tokens.${tinyCaveat}`,
    evidence: {
      artifact: context.artifacts.screenshot?.displayPath || null,
      node: nodeEvidence(node),
      screenshotRegion: node.frame,
      note: `measured contrast ratio ${round(ratio)}:1 from pixel sampling`
    },
    suggestedFix: 'Darken the text color or lighten the background (or vice versa in dark mode) until the pair clears the WCAG threshold; prefer system label colors, which handle this automatically.',
    verification: `Recapture and confirm the measured ratio for "${name}" is at least ${required}:1, or confirm the real color tokens pass a contrast checker.`,
    confidence: isTinyText ? 'low' : 'medium',
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
