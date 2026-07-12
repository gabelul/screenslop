import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenAxTree } from '../src/critique/ax-tree.mjs';
import { detectDesignPlacementIssues } from '../src/critique/detectors/design.mjs';

const context = { artifacts: { accessibilityTree: { displayPath: 'accessibility.json' } } };

/**
 * Builds a phone-sized AX tree around the given child nodes.
 * @param {object[]} children Child AX nodes.
 * @param {object} [frame] Root frame override.
 * @returns {object[]} Flattened nodes.
 */
function phoneTree(children, frame = { x: 0, y: 0, width: 402, height: 874 }) {
  return flattenAxTree({
    role: 'AXApplication',
    label: 'Design App',
    enabled: true,
    hidden: false,
    frame,
    children
  });
}

function button(label, frame, extra = {}) {
  return { role: 'AXButton', label, enabled: true, hidden: false, frame, ...extra };
}

test('flags a large primary CTA parked in the top hard-reach zone', () => {
  const nodes = phoneTree([button('Save changes', { x: 100, y: 80, width: 200, height: 50 })]);
  const findings = detectDesignPlacementIssues(context, nodes);
  const hit = findings.find((finding) => finding.ruleId === 'layout.thumb-reach');
  assert.ok(hit, 'expected a thumb-reach finding');
  assert.equal(hit.severity, 'P2');
  assert.equal(hit.pillar, 'interaction');
  assert.ok(hit.evidence.screenshotRegion);
});

test('does not flag the same CTA in the bottom half of the screen', () => {
  const nodes = phoneTree([button('Save changes', { x: 100, y: 760, width: 200, height: 50 })]);
  const findings = detectDesignPlacementIssues(context, nodes);
  assert.equal(findings.filter((finding) => finding.ruleId === 'layout.thumb-reach').length, 0);
});

test('does not flag a small nav-bar Done button at the top', () => {
  const nodes = phoneTree([button('Done', { x: 330, y: 60, width: 60, height: 30 })]);
  const findings = detectDesignPlacementIssues(context, nodes);
  assert.equal(findings.filter((finding) => finding.ruleId === 'layout.thumb-reach').length, 0);
});

test('skips thumb-reach checks on non-phone surfaces', () => {
  const nodes = phoneTree(
    [button('Save changes', { x: 100, y: 80, width: 200, height: 50 })],
    { x: 0, y: 0, width: 820, height: 1180 }
  );
  const findings = detectDesignPlacementIssues(context, nodes);
  assert.equal(findings.filter((finding) => finding.ruleId === 'layout.thumb-reach').length, 0);
});

test('flags Delete tightly adjacent to Save as P1', () => {
  const nodes = phoneTree([
    button('Save', { x: 40, y: 700, width: 140, height: 50 }),
    button('Delete', { x: 188, y: 700, width: 140, height: 50 })
  ]);
  const findings = detectDesignPlacementIssues(context, nodes);
  const hit = findings.find((finding) => finding.ruleId === 'layout.destructive-adjacency');
  assert.ok(hit, 'expected a destructive-adjacency finding');
  assert.equal(hit.severity, 'P1');
  assert.match(hit.detail, /Delete/);
});

test('downgrades adjacency to P2 in the 16-44pt band', () => {
  const nodes = phoneTree([
    button('Save', { x: 40, y: 700, width: 140, height: 50 }),
    button('Delete', { x: 210, y: 700, width: 140, height: 50 })
  ]);
  const findings = detectDesignPlacementIssues(context, nodes);
  const hit = findings.find((finding) => finding.ruleId === 'layout.destructive-adjacency');
  assert.ok(hit);
  assert.equal(hit.severity, 'P2');
});

test('does not flag Delete when it sits far from confirm actions', () => {
  const nodes = phoneTree([
    button('Save', { x: 40, y: 700, width: 140, height: 50 }),
    button('Delete', { x: 40, y: 400, width: 140, height: 50 })
  ]);
  const findings = detectDesignPlacementIssues(context, nodes);
  assert.equal(findings.filter((finding) => finding.ruleId === 'layout.destructive-adjacency').length, 0);
});

test('ignores names matching both destructive and confirm vocabularies', () => {
  const nodes = phoneTree([
    button('Save', { x: 40, y: 700, width: 140, height: 50 }),
    button('Discard changes and save', { x: 188, y: 700, width: 160, height: 50 })
  ]);
  const findings = detectDesignPlacementIssues(context, nodes);
  assert.equal(findings.filter((finding) => finding.ruleId === 'layout.destructive-adjacency').length, 0);
});

test('produces stable fingerprint-backed ids', () => {
  const nodes = phoneTree([button('Save changes', { x: 100, y: 80, width: 200, height: 50 })]);
  const first = detectDesignPlacementIssues(context, nodes);
  const second = detectDesignPlacementIssues(context, nodes);
  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});
