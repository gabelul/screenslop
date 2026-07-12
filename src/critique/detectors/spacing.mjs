import { accessibleName, isInteractiveNode, isVisibleEnabled, rootFrame } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

// iOS lays out on a 4pt base grid; gaps that keep landing between grid lines
// read as eyeballed spacing rather than a deliberate rhythm.
const gridUnit = 4;
// A gap within this distance of a grid multiple still counts as on-grid.
const gridTolerance = 0.5;
// Below this many measured gaps the screen is too sparse to judge rhythm.
const minMeasuredGaps = 8;
// More than this share of off-grid gaps and the spacing looks unmanaged.
const offGridShareThreshold = 0.4;
// At or above this share of one identical gap the rhythm reads as templated.
const monotonyShareThreshold = 0.85;
// Gaps within this distance of each other count as the same value.
const monotonyTolerance = 1;
// Measured-gap window: below 2pt is effectively touching, above 120pt is a
// deliberate section break rather than intra-content rhythm.
const minGapPt = 2;
const maxGapPt = 120;
// Near-full-height frames are scroll views/backgrounds, not spaced content.
const fullHeightRatio = 0.9;
// Cap the example gap values quoted in the finding detail.
const maxExampleGaps = 6;

/**
 * Judges vertical spacing rhythm from AX frames: content that drifts off the
 * 4pt grid, or content spaced so uniformly it reads as templated. Emits at
 * most one finding per rule, and prefers the monotony finding when both would
 * fire (monotonous gaps make the on/off-grid question moot).
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} Spacing findings (zero or one).
 */
export function detectSpacingIssues(context, nodes) {
  const bounds = rootFrame(nodes);
  if (!bounds) return [];

  const candidates = nodes.filter((node) => isSpacingCandidate(node, bounds));
  const gaps = measureVerticalGaps(candidates);
  if (gaps.length < minMeasuredGaps) return [];

  const monotony = monotonyFinding(context, gaps);
  if (monotony) return [monotony];

  const offGrid = offGridFinding(context, gaps);
  return offGrid ? [offGrid] : [];
}

/**
 * Flags a gap set dominated by one identical value: uniform spacing between
 * every element flattens grouping, since section breaks should be larger than
 * intra-group gaps.
 * @param {object} context Critique context.
 * @param {number[]} gaps Measured vertical gaps.
 * @returns {object|null} Finding or null.
 */
function monotonyFinding(context, gaps) {
  const { value, count } = dominantGap(gaps);
  const share = count / gaps.length;
  if (share < monotonyShareThreshold) return null;

  const dominant = round(value);
  const sharePercent = Math.round(share * 100);

  return createFinding({
    ruleId: 'layout.spacing-monotony',
    severity: 'P3',
    pillar: 'layout',
    title: 'Uniform spacing flattens the layout into a template',
    detail: `${sharePercent}% of ${gaps.length} measured vertical gaps are the same ${dominant}pt. One gap everywhere reads as templated rhythm with no grouping: section breaks should be visibly larger than intra-group spacing so related content clusters.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      note: `vertical gaps (pt): ${gapList(gaps)}`
    },
    suggestedFix: 'Introduce a spacing scale: keep a tight gap inside groups and a clearly larger gap (2-3x) between sections so the hierarchy is visible.',
    verification: 'Recapture and confirm the gap distribution has at least two distinct spacing tiers, or document the uniform rhythm as intentional.',
    confidence: 'low',
    effort: 'medium',
    fingerprint: `spacing-monotony:${dominant}:${sharePercent}:${gaps.length}`
  });
}

/**
 * Flags a gap set where too many gaps miss the 4pt grid.
 * @param {object} context Critique context.
 * @param {number[]} gaps Measured vertical gaps.
 * @returns {object|null} Finding or null.
 */
function offGridFinding(context, gaps) {
  const offGrid = gaps.filter((gap) => !isOnGrid(gap));
  const share = offGrid.length / gaps.length;
  if (share <= offGridShareThreshold) return null;

  const sharePercent = Math.round(share * 100);
  const examples = [...new Set(offGrid.map(round))].slice(0, maxExampleGaps);

  return createFinding({
    ruleId: 'layout.spacing-offgrid',
    severity: 'P3',
    pillar: 'layout',
    title: 'Vertical spacing drifts off the 4pt grid',
    detail: `${sharePercent}% of ${gaps.length} measured vertical gaps are not multiples of 4pt (e.g. ${examples.join(', ')}). iOS spacing convention is a 4pt base grid; gaps landing between grid lines read as eyeballed spacing rather than a system.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      note: `vertical gaps (pt): ${gapList(gaps)}`
    },
    suggestedFix: 'Snap vertical spacing to the 4pt grid (8, 12, 16, 24...) via shared spacing constants instead of ad-hoc padding values.',
    verification: 'Recapture and confirm at most 40% of measured gaps miss the 4pt grid, or document the off-grid values as intentional.',
    confidence: 'low',
    effort: 'medium',
    fingerprint: `spacing-offgrid:${offGrid.length}/${gaps.length}:${examples.join(',')}`
  });
}

/**
 * Returns true for nodes whose vertical rhythm we measure: visible, framed,
 * inside root bounds, content-bearing, and not a container/background.
 * @param {object} node Flattened AX node.
 * @param {object} bounds Root screen bounds.
 * @returns {boolean} Whether the node counts as spaced content.
 */
function isSpacingCandidate(node, bounds) {
  if (!isVisibleEnabled(node) || !node.frame || isRootLike(node)) return false;

  const x = Number(node.frame.x);
  const y = Number(node.frame.y);
  const width = Number(node.frame.width);
  const height = Number(node.frame.height);
  if (![x, y, width, height].every(Number.isFinite)) return false;

  // Near-full-height frames are scroll containers, not content with rhythm.
  if (height >= Number(bounds.height || 0) * fullHeightRatio) return false;
  if (!insideBounds(x, y, width, height, bounds)) return false;

  return isInteractiveNode(node) || accessibleName(node) !== '';
}

/**
 * Measures vertical gaps between consecutive candidates sorted by y-origin.
 * Overlapping pairs and gaps outside the 2-120pt window are dropped: negative
 * gaps are stacked siblings, huge ones are deliberate section breaks.
 * @param {object[]} candidates Spacing candidate nodes.
 * @returns {number[]} Measured gaps in points.
 */
function measureVerticalGaps(candidates) {
  const sorted = [...candidates].sort((left, right) => Number(left.frame.y) - Number(right.frame.y));
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) {
    const prev = sorted[index - 1].frame;
    const next = sorted[index].frame;
    const gap = Number(next.y) - (Number(prev.y) + Number(prev.height));
    if (gap >= minGapPt && gap <= maxGapPt) gaps.push(gap);
  }
  return gaps;
}

/**
 * Finds the gap value that the most other gaps sit within 1pt of.
 * @param {number[]} gaps Measured vertical gaps.
 * @returns {{value: number, count: number}} Dominant gap and its cluster size.
 */
function dominantGap(gaps) {
  let best = { value: gaps[0], count: 0 };
  for (const value of gaps) {
    const count = gaps.filter((gap) => Math.abs(gap - value) <= monotonyTolerance).length;
    if (count > best.count) best = { value, count };
  }
  return best;
}

/**
 * Returns true when a gap sits within tolerance of a 4pt grid multiple.
 * @param {number} gap Gap in points.
 * @returns {boolean} Whether the gap is on-grid.
 */
function isOnGrid(gap) {
  const remainder = gap % gridUnit;
  return Math.min(remainder, gridUnit - remainder) <= gridTolerance;
}

/**
 * Formats gaps for evidence notes, capped so notes stay readable.
 * @param {number[]} gaps Measured vertical gaps.
 * @returns {string} Comma-separated rounded gaps.
 */
function gapList(gaps) {
  const rounded = gaps.map(round);
  const shown = rounded.slice(0, 12).join(', ');
  return rounded.length > 12 ? `${shown}, ... (${rounded.length} total)` : shown;
}

/**
 * Returns true when the frame sits fully inside the root screen bounds.
 * @param {number} x Frame x-origin.
 * @param {number} y Frame y-origin.
 * @param {number} width Frame width.
 * @param {number} height Frame height.
 * @param {object} bounds Root screen bounds.
 * @returns {boolean} Whether the frame is on screen.
 */
function insideBounds(x, y, width, height, bounds) {
  const minX = Number(bounds.x || 0);
  const minY = Number(bounds.y || 0);
  const maxX = minX + Number(bounds.width || 0);
  const maxY = minY + Number(bounds.height || 0);
  return x >= minX && y >= minY && x + width <= maxX && y + height <= maxY;
}

/**
 * Returns true for root application/window nodes.
 * @param {object} node AX node.
 * @returns {boolean} Whether the node is root-like.
 */
function isRootLike(node) {
  return node.path === '0' || /application|window/i.test(String(node.role || ''));
}

/**
 * Rounds numeric output for reports.
 * @param {number} value Gap value.
 * @returns {number} Rounded to one decimal.
 */
function round(value) {
  return Math.round(Number(value) * 10) / 10;
}
