import { accessibleName, isInteractiveNode, isVisibleEnabled, nodeEvidence, rootFrame } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

// A big CTA-style control, not a nav-bar text button. Nav-bar "Done" at the top
// is idiomatic iOS; a 50pt-tall custom Save banner at the top is a thumb problem.
const primaryCtaMinWidth = 120;
const primaryCtaMinHeight = 40;
// Top quarter of a portrait phone is the one-handed dead zone.
const hardReachZoneRatio = 0.25;
// Edge-to-edge gap thresholds for destructive-next-to-confirm placement.
const adjacencyDangerGap = 16;
const adjacencyWarnGap = 44;

const primaryActionPattern = /\b(save|continue|done|submit|next|confirm|buy|checkout|pay|purchase|sign in|sign up|log in|get started|add to cart)\b/i;
const destructivePattern = /\b(delete|remove|discard|erase|clear all|unsubscribe|deactivate|reset)\b/i;

/**
 * Finds placement/design candidates from AX frames: primary actions parked in
 * the one-handed dead zone, and destructive controls sitting next to confirm actions.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} Design placement findings.
 */
export function detectDesignPlacementIssues(context, nodes) {
  const findings = [];
  const bounds = rootFrame(nodes);
  if (!bounds) return findings;

  const actionable = nodes.filter((node) => isVisibleEnabled(node) && node.frame && isInteractiveNode(node));

  if (isPortraitPhone(bounds)) {
    for (const node of actionable) {
      const finding = thumbReachFinding(context, node, bounds);
      if (finding) findings.push(finding);
    }
  }

  findings.push(...destructiveAdjacencyFindings(context, actionable));
  return findings;
}

/**
 * Flags a large primary CTA whose center sits in the top hard-reach zone.
 * @param {object} context Critique context.
 * @param {object} node AX node.
 * @param {object} bounds Root screen bounds.
 * @returns {object|null} Finding or null.
 */
function thumbReachFinding(context, node, bounds) {
  const frame = node.frame;
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width < primaryCtaMinWidth || height < primaryCtaMinHeight) return null;

  const name = accessibleName(node) || '';
  if (!primaryActionPattern.test(name)) return null;

  const centerY = Number(frame.y) + height / 2;
  const zoneBottom = Number(bounds.y || 0) + Number(bounds.height || 0) * hardReachZoneRatio;
  if (!(centerY < zoneBottom)) return null;

  return createFinding({
    ruleId: 'layout.thumb-reach',
    severity: 'P2',
    pillar: 'interaction',
    title: 'Primary action sits in the one-handed dead zone',
    detail: `"${name}" is a ${round(width)}x${round(height)}pt primary control centered at y=${round(centerY)} on a ${round(bounds.height)}pt portrait screen. The top quarter is the hardest one-handed reach zone; primary CTAs belong in the bottom half or the nav bar.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: nodeEvidence(node),
      screenshotRegion: frame
    },
    suggestedFix: 'Move the primary action toward the bottom of the layout (e.g. a bottom-anchored button or `.toolbar` placement) so the dominant hand can reach it.',
    verification: 'Recapture and confirm the primary control center sits below the top quarter of the screen, or document the placement as intentional.',
    confidence: 'medium',
    effort: 'medium',
    fingerprint: `thumb-reach:${node.path}:${name}:${frame.x},${frame.y},${frame.width},${frame.height}`
  });
}

/**
 * Flags destructive controls placed within a finger-slip of confirm actions.
 * @param {object} context Critique context.
 * @param {object[]} actionable Visible interactive AX nodes.
 * @returns {object[]} Adjacency findings, one per destructive node.
 */
function destructiveAdjacencyFindings(context, actionable) {
  const findings = [];
  const destructive = actionable.filter((node) => matchesOnly(node, destructivePattern, primaryActionPattern));
  const confirming = actionable.filter((node) => matchesOnly(node, primaryActionPattern, destructivePattern));

  for (const danger of destructive) {
    let nearest = null;
    let nearestGap = Infinity;
    for (const confirm of confirming) {
      const gap = rectGap(danger.frame, confirm.frame);
      if (gap < nearestGap) {
        nearestGap = gap;
        nearest = confirm;
      }
    }
    if (!nearest || nearestGap >= adjacencyWarnGap) continue;

    const dangerName = accessibleName(danger) || danger.role || 'control';
    const confirmName = accessibleName(nearest) || nearest.role || 'control';
    findings.push(createFinding({
      ruleId: 'layout.destructive-adjacency',
      severity: nearestGap < adjacencyDangerGap ? 'P1' : 'P2',
      pillar: 'interaction',
      title: 'Destructive control sits next to a confirm action',
      detail: `"${dangerName}" is ${round(nearestGap)}pt from "${confirmName}". A slip while confirming can trigger the destructive action. iOS convention separates destructive controls or moves them behind a confirmation.`,
      evidence: {
        artifact: context.artifacts.accessibilityTree.displayPath || null,
        node: nodeEvidence(danger),
        screenshotRegion: danger.frame,
        note: `nearest confirm action: ${confirmName}`
      },
      suggestedFix: 'Separate the destructive control from the confirm action (spacing, opposite edges, or a swipe/menu affordance) or gate it behind a confirmation dialog.',
      verification: 'Recapture and confirm the destructive control is at least 44pt from confirm actions or gated behind confirmation.',
      confidence: 'medium',
      effort: 'medium',
      fingerprint: `destructive-adjacency:${danger.path}:${nearest.path}`
    }));
  }
  return findings;
}

/**
 * Matches a node name against one pattern while rejecting names that also match the other.
 * "Discard changes and save" should not count on either side.
 * @param {object} node AX node.
 * @param {RegExp} include Pattern the name must match.
 * @param {RegExp} exclude Pattern the name must not match.
 * @returns {boolean} Whether the node matches cleanly.
 */
function matchesOnly(node, include, exclude) {
  const name = accessibleName(node) || '';
  return include.test(name) && !exclude.test(name);
}

/**
 * Computes the edge-to-edge gap between two frames (0 when overlapping).
 * @param {object} a First frame.
 * @param {object} b Second frame.
 * @returns {number} Gap in points.
 */
function rectGap(a, b) {
  const dx = Math.max(0, Math.max(Number(a.x), Number(b.x)) - Math.min(Number(a.x) + Number(a.width), Number(b.x) + Number(b.width)));
  const dy = Math.max(0, Math.max(Number(a.y), Number(b.y)) - Math.min(Number(a.y) + Number(a.height), Number(b.y) + Number(b.height)));
  return Math.hypot(dx, dy);
}

/**
 * Returns true for portrait phone-sized root bounds (thumb-reach only makes sense there).
 * @param {object} bounds Root frame.
 * @returns {boolean} Whether the surface is a portrait phone.
 */
function isPortraitPhone(bounds) {
  const width = Number(bounds.width || 0);
  const height = Number(bounds.height || 0);
  return width >= 300 && width <= 500 && height >= 600 && height > width;
}

/**
 * Rounds numeric output for reports.
 * @param {number|string} value Number-like value.
 * @returns {number|string} Rounded value.
 */
function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : value;
}
