import { accessibleName, isInteractiveNode, isVisibleEnabled, nodeEvidence, rootFrame } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

// Empty-state copy the AX tree gives away for free. "No photos yet" and friends
// all funnel through the same pattern; the last alternative catches app-specific
// nouns without us maintaining a dictionary.
const emptyStatePattern = /\b(no items|no results|nothing here|empty|no data|no [a-z]+ yet)\b/i;
// Navigation chrome doesn't count as a call-to-action: a Back button on an empty
// screen still leaves the user with nothing to do here.
const navChromePattern = /back|tab|navigation|toolbar/i;
// Hamburger vocabulary. Kept deliberately narrow — "Menu" in a food app's tab bar
// is a false positive we accept losing to the low-confidence label instead.
const hamburgerPattern = /\b(menu|hamburger)\b/i;
// Any of these on screen means primary navigation already lives in a tab bar.
const tabBarPattern = /tab bar|tabbar|AXTabBar/i;
// Modal-layer vocabulary for the stacked-modals check.
const modalPattern = /sheet|modal|popover|alert/i;
// A hamburger only reads as "primary navigation" in the top-leading corner.
const hamburgerTopZoneRatio = 0.12;
const hamburgerLeadingZoneRatio = 0.2;
// A modal layer has to actually dominate the screen before stacking matters.
const modalMinRootCoverage = 0.5;
// And two layers have to genuinely sit on top of each other, not just touch.
const modalMinMutualOverlap = 0.5;

/**
 * Finds HIG anti-patterns from AX structure alone: empty states with no way
 * forward, hamburger menus standing in for tab bars, and stacked modal layers.
 * No pixel data needed — every rule reads roles, names, and frames.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} HIG pattern findings, at most one per rule per screen.
 */
export function detectHigPatternIssues(context, nodes) {
  const findings = [];
  const bounds = rootFrame(nodes);
  if (!bounds) return findings;

  const visible = nodes.filter((node) => isVisibleEnabled(node));

  const deadEnd = emptyStateDeadEndFinding(context, visible);
  if (deadEnd) findings.push(deadEnd);

  const hamburger = hamburgerMenuFinding(context, visible, bounds);
  if (hamburger) findings.push(hamburger);

  const stacked = stackedModalsFinding(context, visible, bounds);
  if (stacked) findings.push(stacked);

  return findings;
}

/**
 * Flags an empty-state screen that offers the user no call-to-action.
 * "No items yet" with only a Back button is a dead end; the HIG wants empty
 * states to explain what to do next and offer a way to do it.
 * @param {object} context Critique context.
 * @param {object[]} visible Visible AX nodes.
 * @returns {object|null} Finding or null.
 */
function emptyStateDeadEndFinding(context, visible) {
  const emptyNode = visible.find((node) => emptyStatePattern.test(accessibleName(node)));
  if (!emptyNode) return null;

  const callsToAction = visible.filter((node) => isInteractiveNode(node) && !isNavigationChrome(node));
  if (callsToAction.length >= 1) return null;

  const emptyText = accessibleName(emptyNode);
  return createFinding({
    ruleId: 'layout.empty-state-dead-end',
    severity: 'P2',
    pillar: 'layout',
    title: 'Empty state offers no way forward',
    detail: `The screen shows the empty-state text "${emptyText}" but has no call-to-action beyond navigation chrome. An empty state that only says "nothing here" strands the user; the HIG expects it to explain the next step and offer a control that takes it.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: nodeEvidence(emptyNode),
      screenshotRegion: emptyNode.frame || undefined
    },
    suggestedFix: 'Add a primary call-to-action to the empty state (e.g. an "Add" or "Get started" button) so the user can resolve the emptiness instead of backing out.',
    verification: 'Recapture and confirm the empty state exposes at least one non-navigation interactive control, or document the dead end as intentional.',
    confidence: 'medium',
    effort: 'medium',
    fingerprint: `empty-state-dead-end:${emptyNode.path}:${emptyText}`
  });
}

/**
 * Flags a top-leading hamburger control on a phone screen with no tab bar.
 * iOS puts primary navigation in a tab bar; a lone hamburger in the corner
 * hides the app's structure behind an extra tap.
 * @param {object} context Critique context.
 * @param {object[]} visible Visible AX nodes.
 * @param {object} bounds Root screen bounds.
 * @returns {object|null} Finding or null.
 */
function hamburgerMenuFinding(context, visible, bounds) {
  if (!isPortraitPhone(bounds)) return null;
  if (visible.some(hasTabBarSignal)) return null;

  const hamburger = visible.find(
    (node) => isInteractiveNode(node) && node.frame && looksLikeHamburger(node) && inTopLeadingZone(node.frame, bounds)
  );
  if (!hamburger) return null;

  const name = accessibleName(hamburger) || hamburger.identifier || 'Menu';
  return createFinding({
    ruleId: 'platform.hamburger-menu',
    severity: 'P3',
    pillar: 'platform',
    title: 'Hamburger menu stands in for a tab bar',
    detail: `"${name}" sits in the top-leading corner on a screen with no tab bar, which reads as hamburger-style primary navigation. iOS convention prefers a tab bar: it keeps the app's main destinations visible and one tap away instead of hidden behind a drawer.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: nodeEvidence(hamburger),
      screenshotRegion: hamburger.frame
    },
    suggestedFix: 'Promote the app\'s primary destinations into a bottom tab bar (`TabView`) and reserve the leading nav slot for contextual actions.',
    verification: 'Recapture and confirm primary navigation is exposed as a tab bar, or document the drawer navigation as a deliberate cross-platform choice.',
    confidence: 'low',
    effort: 'high',
    fingerprint: `hamburger-menu:${hamburger.path}:${name}`
  });
}

/**
 * Flags two or more modal-like layers covering the screen at the same time.
 * A sheet on a sheet (or an alert floating over a full-screen modal) buries
 * context; the HIG treats stacked modal layers as a sign the flow needs a push.
 * @param {object} context Critique context.
 * @param {object[]} visible Visible AX nodes.
 * @param {object} bounds Root screen bounds.
 * @returns {object|null} Finding or null.
 */
function stackedModalsFinding(context, visible, bounds) {
  const rootArea = frameArea(bounds);
  if (!(rootArea > 0)) return null;

  const layers = visible.filter(
    (node) => node.frame && looksLikeModalLayer(node) && frameArea(node.frame) >= rootArea * modalMinRootCoverage
  );
  if (layers.length < 2) return null;

  // First pair in node order that genuinely stacks — one finding per screen.
  for (let i = 0; i < layers.length - 1; i += 1) {
    for (let j = i + 1; j < layers.length; j += 1) {
      const lower = layers[i];
      const upper = layers[j];
      const smallerArea = Math.min(frameArea(lower.frame), frameArea(upper.frame));
      if (intersectionArea(lower.frame, upper.frame) < smallerArea * modalMinMutualOverlap) continue;

      const lowerName = accessibleName(lower) || lower.role || 'modal layer';
      const upperName = accessibleName(upper) || upper.role || 'modal layer';
      return createFinding({
        ruleId: 'platform.stacked-modals',
        severity: 'P2',
        pillar: 'platform',
        title: 'Modal layers are stacked on top of each other',
        detail: `"${upperName}" overlaps "${lowerName}" and both cover most of the screen — a modal presented over another modal. The HIG treats stacked modal layers as an anti-pattern: each layer buries the context below it and the dismissal path gets ambiguous fast.`,
        evidence: {
          artifact: context.artifacts.accessibilityTree.displayPath || null,
          node: nodeEvidence(upper),
          screenshotRegion: upper.frame,
          note: `stacked over: ${lowerName} (${lower.path})`
        },
        suggestedFix: 'Flatten the flow: push the second step within the existing sheet\'s navigation stack, or dismiss the first modal before presenting the next.',
        verification: 'Recapture and confirm at most one modal layer covers the screen at a time, or document the stacked presentation as intentional.',
        confidence: 'medium',
        effort: 'medium',
        fingerprint: `stacked-modals:${lower.path}:${upper.path}`
      });
    }
  }

  return null;
}

/**
 * Returns true when a node reads as navigation chrome (Back, tab bars, toolbars).
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the node is chrome rather than a call-to-action.
 */
function isNavigationChrome(node) {
  return navChromePattern.test(`${node.role || ''} ${node.label || ''} ${node.identifier || ''}`);
}

/**
 * Returns true when a node's name or identifier says hamburger/menu.
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the control looks like a hamburger button.
 */
function looksLikeHamburger(node) {
  return hamburgerPattern.test(accessibleName(node)) || hamburgerPattern.test(String(node.identifier || ''));
}

/**
 * Returns true when a node carries a tab-bar signal in its role or label.
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the node indicates tab-bar navigation.
 */
function hasTabBarSignal(node) {
  return tabBarPattern.test(String(node.role || '')) || tabBarPattern.test(String(node.label || ''));
}

/**
 * Returns true when a node's role, identifier, or label reads as a modal layer.
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the node looks like a sheet/modal/popover/alert.
 */
function looksLikeModalLayer(node) {
  return modalPattern.test(`${node.role || ''} ${node.identifier || ''} ${node.label || ''}`);
}

/**
 * Returns true when a frame's center sits in the top-leading corner zone.
 * @param {object} frame Node frame.
 * @param {object} bounds Root screen bounds.
 * @returns {boolean} Whether the control sits where hamburgers live.
 */
function inTopLeadingZone(frame, bounds) {
  const centerX = Number(frame.x) + Number(frame.width) / 2;
  const centerY = Number(frame.y) + Number(frame.height) / 2;
  if (!Number.isFinite(centerX) || !Number.isFinite(centerY)) return false;
  const zoneRight = Number(bounds.x || 0) + Number(bounds.width || 0) * hamburgerLeadingZoneRatio;
  const zoneBottom = Number(bounds.y || 0) + Number(bounds.height || 0) * hamburgerTopZoneRatio;
  return centerX < zoneRight && centerY < zoneBottom;
}

/**
 * Computes a frame's area, treating malformed frames as zero.
 * @param {object} frame Frame with width/height.
 * @returns {number} Area in square points.
 */
function frameArea(frame) {
  const width = Number(frame?.width);
  const height = Number(frame?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  return Math.max(0, width) * Math.max(0, height);
}

/**
 * Computes the overlapping area of two frames.
 * @param {object} a First frame.
 * @param {object} b Second frame.
 * @returns {number} Intersection area in square points (0 when disjoint).
 */
function intersectionArea(a, b) {
  const width = Math.min(Number(a.x) + Number(a.width), Number(b.x) + Number(b.width)) - Math.max(Number(a.x), Number(b.x));
  const height = Math.min(Number(a.y) + Number(a.height), Number(b.y) + Number(b.height)) - Math.max(Number(a.y), Number(b.y));
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  return Math.max(0, width) * Math.max(0, height);
}

/**
 * Returns true for portrait phone-sized root bounds (the hamburger convention
 * argument only holds on phones).
 * @param {object} bounds Root frame.
 * @returns {boolean} Whether the surface is a portrait phone.
 */
function isPortraitPhone(bounds) {
  const width = Number(bounds.width || 0);
  const height = Number(bounds.height || 0);
  return width >= 300 && width <= 500 && height >= 600 && height > width;
}
