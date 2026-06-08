const interactiveRolePatterns = [
  /button/i,
  /^AXLink$/i,
  /textfield|text field/i,
  /textarea|text area/i,
  /^AXSlider$/i,
  /^AXSwitch$/i,
  /^AXMenuButton$/i,
  /^AXPopUpButton$/i
];

/**
 * Flattens a nested accessibility tree while preserving stable paths.
 * @param {object|null} root Accessibility tree root.
 * @returns {object[]} Flattened nodes.
 */
export function flattenAxTree(root) {
  if (!root || typeof root !== 'object') return [];
  const nodes = [];
  visitAxNode(root, '0', nodes);
  return nodes;
}

/**
 * Returns true when a node looks interactive.
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the role is interactive.
 */
export function isInteractiveNode(node) {
  const role = String(node.role || '');
  if (interactiveRolePatterns.some((pattern) => pattern.test(role))) return true;
  return looksLikeIdentifiedControl(node);
}

/**
 * Treats Baguette generic AX nodes with stable control identifiers as actionable.
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the generic element looks like a control.
 */
function looksLikeIdentifiedControl(node) {
  const role = String(node.role || '');
  const identifier = String(node.identifier || '');
  if (!/^AXGenericElement$/i.test(role) || !identifier) return false;
  return /(?:button|control|toggle|switch|slider|field|link|picker)$/i.test(identifier);
}

/**
 * Returns the best accessible name available on a node.
 * @param {object} node Flattened AX node.
 * @returns {string} Trimmed accessible name.
 */
export function accessibleName(node) {
  return firstText(node.label, node.title, node.value);
}

/**
 * Returns true when the node is visible enough for MVP checks.
 * @param {object} node Flattened AX node.
 * @returns {boolean} Whether the node should be inspected.
 */
export function isVisibleEnabled(node) {
  return node.hidden !== true && node.enabled !== false;
}

/**
 * Returns the first root-sized application/window frame.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object|null} Root bounds frame.
 */
export function rootFrame(nodes) {
  const root = nodes.find((node) => node.frame && /application|window/i.test(String(node.role || '')));
  return root?.frame || nodes.find((node) => node.frame)?.frame || null;
}

/**
 * Converts an AX node into compact evidence data.
 * @param {object} node Flattened AX node.
 * @returns {object} Node evidence.
 */
export function nodeEvidence(node) {
  return {
    path: node.path,
    role: node.role || null,
    label: node.label ?? null,
    title: node.title ?? null,
    value: node.value ?? null,
    identifier: node.identifier ?? null,
    frame: node.frame || null
  };
}

/**
 * Recursively visits AX nodes.
 * @param {object} node Current AX node.
 * @param {string} path Stable child index path.
 * @param {object[]} nodes Destination array.
 * @returns {void}
 */
function visitAxNode(node, path, nodes) {
  const { children: _children, ...publicFields } = node;
  nodes.push({ ...publicFields, path });

  const children = Array.isArray(node.children) ? node.children : [];
  children.forEach((child, index) => visitAxNode(child, `${path}.${index}`, nodes));
}

/**
 * Returns the first non-empty text value.
 * @param {...unknown} values Candidate values.
 * @returns {string} Trimmed text.
 */
function firstText(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return '';
}
