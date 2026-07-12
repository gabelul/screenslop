import { accessibleName, isInteractiveNode, isVisibleEnabled, rootFrame } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

// Clean iOS screens line content up on 2-3 shared leading edges; a scatter of
// x-origins reads as visual chaos even when every individual frame is fine.
// Edges within this tolerance count as the same alignment guide.
const edgeClusterTolerance = 4;
// Below this many aligned-content candidates the screen is too sparse to judge.
const minCandidateNodes = 8;
// More distinct leading edges than this and the layout has no dominant margin.
const maxLeadingEdges = 6;
// Near-full-width frames are containers/backgrounds, not aligned content.
const fullWidthRatio = 0.9;

/**
 * Flags screens whose labeled/interactive content starts on too many distinct
 * leading edges. Emits at most one screen-level finding per capture.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} Alignment findings (zero or one).
 */
export function detectAlignmentIssues(context, nodes) {
  const bounds = rootFrame(nodes);
  if (!bounds) return [];

  const candidates = nodes.filter((node) => isAlignmentCandidate(node, bounds));
  if (candidates.length < minCandidateNodes) return [];

  const edges = clusterLeadingEdges(candidates.map((node) => Number(node.frame.x)));
  if (edges.length <= maxLeadingEdges) return [];

  const origins = edges.map((edge) => Math.round(edge));
  const originList = origins.join(', ');

  return [createFinding({
    ruleId: 'layout.alignment-edges',
    severity: 'P3',
    pillar: 'layout',
    title: 'Content starts on too many distinct leading edges',
    detail: `${candidates.length} labeled or interactive elements start on ${edges.length} distinct leading edges (x = ${originList}). Clean iOS screens align content on 2-3 shared edges; this many x-origins reads as visual scatter rather than a deliberate grid.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      note: `leading edges at x=${originList}`
    },
    suggestedFix: 'Consolidate content onto a shared leading margin: pick one or two alignment guides (e.g. a common horizontal padding) and snap element leading edges to them.',
    verification: 'Recapture and confirm the screen has at most 6 distinct leading edges, or document the scattered layout as intentional.',
    confidence: 'low',
    effort: 'medium',
    fingerprint: `alignment-edges:${[...origins].sort((left, right) => left - right).join(',')}`
  })];
}

/**
 * Returns true for nodes that participate in the leading-edge count: visible,
 * framed, inside root bounds, content-bearing, and not a container/background.
 * @param {object} node Flattened AX node.
 * @param {object} bounds Root screen bounds.
 * @returns {boolean} Whether the node counts as aligned content.
 */
function isAlignmentCandidate(node, bounds) {
  if (!isVisibleEnabled(node) || !node.frame || isRootLike(node)) return false;

  const x = Number(node.frame.x);
  const y = Number(node.frame.y);
  const width = Number(node.frame.width);
  const height = Number(node.frame.height);
  if (![x, y, width, height].every(Number.isFinite)) return false;

  // Near-full-width frames are containers, not content that gets aligned.
  if (width >= Number(bounds.width || 0) * fullWidthRatio) return false;
  if (!insideBounds(x, y, width, height, bounds)) return false;

  return isInteractiveNode(node) || accessibleName(node) !== '';
}

/**
 * Clusters sorted x-origins into leading edges; a new cluster starts when the
 * gap from the current cluster's origin exceeds the tolerance.
 * @param {number[]} xs Candidate frame x-origins.
 * @returns {number[]} Ascending cluster origins.
 */
function clusterLeadingEdges(xs) {
  const sorted = [...xs].sort((left, right) => left - right);
  const origins = [];
  for (const x of sorted) {
    const current = origins[origins.length - 1];
    if (current === undefined || x - current > edgeClusterTolerance) origins.push(x);
  }
  return origins;
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
