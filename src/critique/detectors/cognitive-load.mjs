import { accessibleName, isInteractiveNode, isVisibleEnabled, nodeEvidence } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

// Miller/Cowan working-memory research puts the comfortable ceiling near 4
// competing choices per group. We flag at MORE THAN 5 (not > 4) on purpose:
// iOS tab bars legitimately hold 5 items and reflexive noise at exactly 5
// would train people to ignore the rule.
const maxCompetingActions = 5;
// Cap the names we spell out in the detail text; past that it's just noise.
const maxNamedChildren = 6;
// Containers that are supposed to be long: rows in a table, items in a menu,
// a picker wheel. Many siblings there is structure, not cognitive overload.
const longContainerPattern = /table|list|scroll|collection|tab bar|tabbar|segmented|picker|menu|grid/i;
// Fallback signal when the parent node itself is missing from the flattened
// tree: children that are cells/rows imply a list-like container.
const repeatingChildPattern = /cell|row/i;

/**
 * Finds flat groups of competing interactive siblings that overload working memory.
 * Groups visible interactive nodes by parent path and flags any plain container
 * asking the user to weigh more than 5 actions at once.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} Working-memory findings, at most one per parent group.
 */
export function detectCognitiveLoadIssues(context, nodes) {
  const findings = [];
  const byPath = new Map(nodes.map((node) => [node.path, node]));
  const groups = new Map();

  for (const node of nodes) {
    if (!isVisibleEnabled(node) || !isInteractiveNode(node)) continue;
    const parentPath = parentPathOf(node.path);
    if (parentPath === null) continue;
    if (!groups.has(parentPath)) groups.set(parentPath, []);
    groups.get(parentPath).push(node);
  }

  for (const [parentPath, children] of groups) {
    if (children.length <= maxCompetingActions) continue;
    if (isLegitimatelyLongContainer(parentPath, byPath, children)) continue;
    findings.push(workingMemoryFinding(context, parentPath, byPath.get(parentPath) || null, children));
  }

  return findings;
}

/**
 * Builds the single working-memory finding for one overloaded parent group.
 * @param {object} context Critique context.
 * @param {string} parentPath Parent node path.
 * @param {object|null} parent Parent AX node, when present in the flattened tree.
 * @param {object[]} children Interactive child nodes competing in the group.
 * @returns {object} Working-memory finding.
 */
function workingMemoryFinding(context, parentPath, parent, children) {
  const groupName = parent ? accessibleName(parent) || parent.role || parentPath : parentPath;
  const names = children
    .slice(0, maxNamedChildren)
    .map((child) => accessibleName(child) || child.role || child.path)
    .join(', ');
  const overflow = children.length > maxNamedChildren ? ', …' : '';

  return createFinding({
    ruleId: 'hierarchy.working-memory',
    severity: 'P3',
    pillar: 'hierarchy',
    title: 'Too many competing actions in one group',
    detail: `"${groupName}" offers ${children.length} competing interactive choices side by side (${names}${overflow}). Working-memory research (Miller/Cowan) puts the comfortable ceiling near 4 choices per group; past that, users scan instead of deciding.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: parent ? nodeEvidence(parent) : undefined,
      note: `competing actions: ${names}`
    },
    suggestedFix: 'Group related actions, move secondary ones behind a menu/More affordance, or split the screen so each group asks one decision at a time.',
    verification: 'Recapture and confirm at most 5 competing actions per group, or document the grouping as intentional.',
    confidence: 'low',
    effort: 'medium',
    fingerprint: `working-memory:${parentPath}:${children.length}`
  });
}

/**
 * Returns true when the group lives in a container that is supposed to be long.
 * Checks the parent node's role/label/identifier text, walks ancestor roles for
 * list/scroll/menu signals, and falls back to the children's own roles (cells,
 * rows) when the parent node is missing from the flattened tree.
 * @param {string} parentPath Parent node path.
 * @param {Map<string, object>} byPath Flattened nodes keyed by path.
 * @param {object[]} children Interactive child nodes in the group.
 * @returns {boolean} Whether to skip the group.
 */
function isLegitimatelyLongContainer(parentPath, byPath, children) {
  const parent = byPath.get(parentPath);
  if (parent && longContainerPattern.test(containerText(parent))) return true;

  for (let path = parentPathOf(parentPath); path !== null; path = parentPathOf(path)) {
    const ancestor = byPath.get(path);
    if (ancestor && longContainerPattern.test(String(ancestor.role || ''))) return true;
  }

  if (!parent) {
    return children.some((child) => {
      const role = String(child.role || '');
      return longContainerPattern.test(role) || repeatingChildPattern.test(role);
    });
  }

  return false;
}

/**
 * Builds the searchable container text for the exclusion check.
 * @param {object} node AX node.
 * @returns {string} Role/label/identifier text.
 */
function containerText(node) {
  return `${node.role || ''} ${node.label || ''} ${node.identifier || ''}`;
}

/**
 * Returns the parent path for a flattened AX node path ("0.1.2" -> "0.1").
 * @param {string} path Stable child index path.
 * @returns {string|null} Parent path, or null at the root.
 */
function parentPathOf(path) {
  const cut = String(path).lastIndexOf('.');
  return cut === -1 ? null : String(path).slice(0, cut);
}
