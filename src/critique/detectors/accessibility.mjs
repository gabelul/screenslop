import { accessibleName, isInteractiveNode, isVisibleEnabled, nodeEvidence } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

const genericLabels = new Set(['button', 'image', 'icon']);

/**
 * Finds AX naming problems for visible enabled controls.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} Accessibility findings.
 */
export function detectAccessibilityIssues(context, nodes) {
  const findings = [];
  const interactiveNodes = nodes.filter((node) => isVisibleEnabled(node) && isInteractiveNode(node));

  for (const node of interactiveNodes) {
    const name = accessibleName(node);
    if (!name) {
      findings.push(createFinding({
        ruleId: 'ax.missing-name',
        severity: missingNameSeverity(node),
        pillar: 'accessibility',
        title: `${node.role || 'Interactive control'} has no accessible name`,
        detail: 'This visible enabled control has no label, title, or useful value in the AX tree. VoiceOver users may not know what it does.',
        evidence: {
          artifact: context.artifacts.accessibilityTree.displayPath || null,
          node: nodeEvidence(node),
          sourceHint: sourceHint(context, node)
        },
        suggestedFix: 'Add a specific SwiftUI `.accessibilityLabel(...)` or use visible text that becomes the control name.',
        verification: 'Recapture with `screenslop see` and confirm the AX node has a meaningful label.',
        confidence: 'high',
        effort: 'low',
        fingerprint: `missing-name:${node.path}:${node.role}:${frameSeed(node)}`
      }));
      continue;
    }

    const normalized = name.trim().toLowerCase();
    if (genericLabels.has(normalized)) {
      findings.push(createFinding({
        ruleId: 'ax.generic-name',
        severity: 'P2',
        pillar: 'accessibility',
        title: `Generic control label: ${name}`,
        detail: `The control label "${name}" describes the UI object, not the action or content.`,
        evidence: {
          artifact: context.artifacts.accessibilityTree.displayPath || null,
          node: nodeEvidence(node),
          sourceHint: sourceHint(context, node)
        },
        suggestedFix: 'Replace the generic label with the action or object name, for example “Add gift” instead of “Button”.',
        verification: 'Recapture and confirm the label explains the control in context.',
        confidence: 'high',
        effort: 'low',
        fingerprint: `generic-name:${node.path}:${normalized}:${frameSeed(node)}`
      }));
    }
  }

  findings.push(...detectRepeatedCloseLabels(context, interactiveNodes));
  return findings;
}

/**
 * Finds repeated low-context close labels.
 * @param {object} context Critique context.
 * @param {object[]} interactiveNodes Visible interactive nodes.
 * @returns {object[]} Findings.
 */
function detectRepeatedCloseLabels(context, interactiveNodes) {
  const closeNodes = interactiveNodes.filter((node) => accessibleName(node).trim().toLowerCase() === 'close');
  if (closeNodes.length <= 1) return [];

  return closeNodes.map((node) => createFinding({
    ruleId: 'ax.repeated-close-name',
    severity: 'P2',
    pillar: 'accessibility',
    title: 'Repeated “Close” control lacks context',
    detail: 'Multiple visible controls are labeled “Close”. VoiceOver users need context when more than one close action is present.',
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: nodeEvidence(node),
      sourceHint: sourceHint(context, node)
    },
    suggestedFix: 'Use contextual labels such as “Close sheet”, “Close preview”, or “Dismiss settings”.',
    verification: 'Recapture and confirm each close control has a distinct accessible label.',
    confidence: 'medium',
    effort: 'low',
    fingerprint: `repeated-close:${node.path}:${frameSeed(node)}`
  }));
}

/**
 * Assigns severity for missing accessible names.
 * @param {object} node AX node.
 * @returns {string} P severity.
 */
function missingNameSeverity(node) {
  return /slider|textfield|textarea|switch/i.test(String(node.role || '')) ? 'P2' : 'P1';
}

/**
 * Selects the best source hint available today.
 * @param {object} context Critique context.
 * @param {object} node AX node.
 * @returns {string|null} Source hint.
 */
function sourceHint(context, node) {
  return node.identifier || context.manifest.sourceHints?.[0] || null;
}

/**
 * Builds a stable frame fingerprint.
 * @param {object} node AX node.
 * @returns {string} Frame seed.
 */
function frameSeed(node) {
  const frame = node.frame || {};
  return `${frame.x ?? ''},${frame.y ?? ''},${frame.width ?? ''},${frame.height ?? ''}`;
}
