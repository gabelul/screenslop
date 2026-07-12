import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenAxTree } from '../src/critique/ax-tree.mjs';
import { detectCognitiveLoadIssues } from '../src/critique/detectors/cognitive-load.mjs';

const context = { artifacts: { accessibilityTree: { displayPath: 'accessibility.json' } } };

/**
 * Builds a phone-sized AX tree around the given child nodes.
 * @param {object[]} children Child AX nodes.
 * @returns {object[]} Flattened nodes.
 */
function phoneTree(children) {
  return flattenAxTree({
    role: 'AXApplication',
    label: 'Cognitive Load App',
    enabled: true,
    hidden: false,
    frame: { x: 0, y: 0, width: 402, height: 874 },
    children
  });
}

function button(label, extra = {}) {
  return { role: 'AXButton', label, enabled: true, hidden: false, ...extra };
}

/**
 * Builds a list of numbered sibling buttons.
 * @param {number} count How many buttons.
 * @param {string} [prefix] Label prefix.
 * @returns {object[]} Button nodes.
 */
function buttons(count, prefix = 'Action') {
  return Array.from({ length: count }, (_, index) => button(`${prefix} ${index + 1}`));
}

function group(label, children, extra = {}) {
  return { role: 'AXGroup', label, enabled: true, hidden: false, children, ...extra };
}

test('flags a plain group with 7 sibling buttons as one P3 working-memory finding', () => {
  const nodes = phoneTree([group('Quick actions', buttons(7))]);
  const findings = detectCognitiveLoadIssues(context, nodes);
  assert.equal(findings.length, 1);
  const hit = findings[0];
  assert.equal(hit.ruleId, 'hierarchy.working-memory');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'hierarchy');
  assert.equal(hit.confidence, 'low');
  assert.match(hit.detail, /7 competing/);
  assert.match(hit.detail, /Quick actions/);
  assert.match(hit.evidence.note, /Action 1/);
});

test('does not flag a group with 5 siblings', () => {
  const nodes = phoneTree([group('Quick actions', buttons(5))]);
  const findings = detectCognitiveLoadIssues(context, nodes);
  assert.equal(findings.length, 0);
});

test('does not flag an AXTable/AXList parent with 8 interactive rows', () => {
  const nodes = phoneTree([
    { role: 'AXTable', label: 'Inbox', enabled: true, hidden: false, children: buttons(8, 'Message') },
    { role: 'AXList', label: 'Archive', enabled: true, hidden: false, children: buttons(8, 'Item') }
  ]);
  const findings = detectCognitiveLoadIssues(context, nodes);
  assert.equal(findings.length, 0);
});

test('does not flag a tab bar with 6 items', () => {
  const nodes = phoneTree([group('Tab Bar', buttons(6, 'Tab'))]);
  const findings = detectCognitiveLoadIssues(context, nodes);
  assert.equal(findings.length, 0);
});

test('does not flag a tab bar with 5 items', () => {
  const nodes = phoneTree([group('Tab Bar', buttons(5, 'Tab'))]);
  const findings = detectCognitiveLoadIssues(context, nodes);
  assert.equal(findings.length, 0);
});

test('flags two separate overloaded groups with two findings', () => {
  const nodes = phoneTree([
    group('Primary actions', buttons(6, 'Primary')),
    group('Secondary actions', buttons(7, 'Secondary'))
  ]);
  const findings = detectCognitiveLoadIssues(context, nodes);
  assert.equal(findings.length, 2);
  assert.notEqual(findings[0].id, findings[1].id);
  for (const finding of findings) {
    assert.equal(finding.ruleId, 'hierarchy.working-memory');
  }
});

test('produces stable fingerprint-backed ids across runs', () => {
  const nodes = phoneTree([
    group('Primary actions', buttons(6, 'Primary')),
    group('Secondary actions', buttons(7, 'Secondary'))
  ]);
  const first = detectCognitiveLoadIssues(context, nodes);
  const second = detectCognitiveLoadIssues(context, nodes);
  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});
