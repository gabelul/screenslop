import { isInteractiveNode, isVisibleEnabled, nodeEvidence, rootFrame } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

const minTouchTarget = 44;
const ignoredOversizedIdentifiers = new Set(['PopoverDismissRegion']);

/**
 * Finds layout and hit-target candidates from AX frames.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} Layout findings.
 */
export function detectLayoutIssues(context, nodes) {
  const findings = [];
  const bounds = rootFrame(nodes);

  for (const node of nodes) {
    if (!isVisibleEnabled(node) || !node.frame) continue;

    if (isInteractiveNode(node)) {
      const touchFinding = touchTargetFinding(context, node);
      if (touchFinding) findings.push(touchFinding);
    }

    const offscreenFinding = offscreenFrameFinding(context, node, bounds);
    if (offscreenFinding) findings.push(offscreenFinding);
  }

  return findings;
}

/**
 * Builds a small touch-target finding when needed.
 * @param {object} context Critique context.
 * @param {object} node AX node.
 * @returns {object|null} Finding or null.
 */
function touchTargetFinding(context, node) {
  const frame = node.frame;
  const width = Number(frame.width);
  const height = Number(frame.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width >= minTouchTarget && height >= minTouchTarget) return null;

  const bothAxes = width < minTouchTarget && height < minTouchTarget;
  const systemAccessory = isSystemAccessory(node);
  const severity = systemAccessory ? 'P3' : bothAxes ? 'P1' : 'P2';
  const title = bothAxes ? 'Touch target is below 44x44pt' : 'Touch target is below 44pt on one axis';

  return createFinding({
    ruleId: 'layout.touch-target',
    severity,
    pillar: 'interaction',
    title,
    detail: `This ${node.role || 'control'} frame is ${round(width)}x${round(height)}pt. iOS controls need a reliable 44x44pt hit target.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: nodeEvidence(node),
      screenshotRegion: frame
    },
    suggestedFix: 'Increase the tappable frame with `.frame(minWidth: 44, minHeight: 44)` or add padding around the control.',
    verification: 'Recapture and confirm the AX frame is at least 44x44pt or document a larger hit area.',
    confidence: systemAccessory ? 'low' : 'high',
    effort: 'low',
    fingerprint: `touch-target:${node.path}:${node.role}:${frame.x},${frame.y},${frame.width},${frame.height}`
  });
}

/**
 * Builds an offscreen or clipping candidate finding.
 * @param {object} context Critique context.
 * @param {object} node AX node.
 * @param {object|null} bounds Root screen bounds.
 * @returns {object|null} Finding or null.
 */
function offscreenFrameFinding(context, node, bounds) {
  if (!bounds || isRootLike(node) || isIgnoredOversizedNode(node)) return null;

  const frame = node.frame;
  const maxX = Number(bounds.x || 0) + Number(bounds.width || 0);
  const maxY = Number(bounds.y || 0) + Number(bounds.height || 0);
  const minX = Number(bounds.x || 0);
  const minY = Number(bounds.y || 0);
  const nodeMaxX = Number(frame.x) + Number(frame.width);
  const nodeMaxY = Number(frame.y) + Number(frame.height);
  const outside = Number(frame.x) < minX || Number(frame.y) < minY || nodeMaxX > maxX || nodeMaxY > maxY;
  if (!outside) return null;

  const centerX = Number(frame.x) + Number(frame.width) / 2;
  const centerY = Number(frame.y) + Number(frame.height) / 2;
  const centerOutside = centerX < minX || centerY < minY || centerX > maxX || centerY > maxY;
  const interactive = isInteractiveNode(node);

  return createFinding({
    ruleId: 'layout.offscreen-frame',
    severity: interactive && centerOutside ? 'P1' : interactive ? 'P2' : 'P3',
    pillar: 'layout',
    title: interactive && centerOutside ? 'Interactive control center is outside the screen' : 'AX frame extends beyond the screen',
    detail: `The node frame ${formatFrame(frame)} extends beyond root bounds ${formatFrame(bounds)}. This is a clipping/offscreen candidate, not a visual verdict by itself.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: nodeEvidence(node),
      screenshotRegion: frame
    },
    suggestedFix: 'Check the SwiftUI layout constraints, safe-area handling, and any overlay/backdrop frames for this element.',
    verification: 'Recapture and confirm the control frame sits inside the root screen bounds, or mark the oversized frame as intentional.',
    confidence: interactive ? 'medium' : 'low',
    effort: 'medium',
    fingerprint: `offscreen:${node.path}:${node.role}:${frame.x},${frame.y},${frame.width},${frame.height}`
  });
}

/**
 * Returns true for system controls where the visible glyph may be smaller than the hit area.
 * @param {object} node AX node.
 * @returns {boolean} Whether to down-rank the finding.
 */
function isSystemAccessory(node) {
  const text = `${node.label || ''} ${node.identifier || ''}`.toLowerCase();
  return text.includes('close') || text.includes('grabber') || text.includes('dynamic island');
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
 * Returns true for intentionally oversized overlay regions.
 * @param {object} node AX node.
 * @returns {boolean} Whether to skip offscreen checks.
 */
function isIgnoredOversizedNode(node) {
  return ignoredOversizedIdentifiers.has(node.identifier) || /dismiss region|backdrop|scrim/i.test(String(node.label || ''));
}

/**
 * Formats a frame for report text.
 * @param {object} frame AX frame.
 * @returns {string} Compact frame.
 */
function formatFrame(frame) {
  return `x=${round(frame.x)}, y=${round(frame.y)}, w=${round(frame.width)}, h=${round(frame.height)}`;
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
