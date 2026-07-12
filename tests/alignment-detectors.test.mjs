import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenAxTree } from '../src/critique/ax-tree.mjs';
import { detectAlignmentIssues } from '../src/critique/detectors/alignment.mjs';

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
    label: 'Alignment App',
    enabled: true,
    hidden: false,
    frame,
    children
  });
}

function text(label, frame, extra = {}) {
  return { role: 'AXStaticText', label, enabled: true, hidden: false, frame, ...extra };
}

/**
 * Builds one labeled 120pt-wide row per x-origin, staggered down the screen.
 * @param {number[]} xs Leading-edge x-origins.
 * @returns {object[]} Labeled AX nodes.
 */
function scatteredRows(xs) {
  return xs.map((x, index) => text(`Row ${index}`, { x, y: 100 + index * 60, width: 120, height: 20 }));
}

test('flags a screen where labeled content scatters across 8 leading edges', () => {
  // 9 candidates on 8 distinct edges (two rows share x=16).
  const nodes = phoneTree(scatteredRows([16, 24, 36, 48, 60, 72, 84, 96, 16]));
  const findings = detectAlignmentIssues(context, nodes);
  assert.equal(findings.length, 1, 'expected exactly one alignment finding');
  const hit = findings[0];
  assert.equal(hit.ruleId, 'layout.alignment-edges');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'layout');
  assert.equal(hit.confidence, 'low');
  assert.match(hit.detail, /8 distinct leading edges/);
  assert.match(hit.detail, /9 labeled or interactive elements/);
  assert.match(hit.evidence.note, /^leading edges at x=/);
  assert.equal(hit.evidence.artifact, 'accessibility.json');
  assert.equal(hit.evidence.node, undefined, 'screen-level finding carries no node evidence');
  assert.equal(hit.evidence.screenshotRegion, undefined);
});

test('does not flag a busy screen aligned on 2-3 shared edges', () => {
  const nodes = phoneTree([
    ...[0, 1, 2, 3, 4].map((index) => text(`Left ${index}`, { x: 16, y: 100 + index * 60, width: 120, height: 20 })),
    ...[0, 1, 2, 3, 4].map((index) => text(`Right ${index}`, { x: 200, y: 100 + index * 60, width: 120, height: 20 }))
  ]);
  assert.equal(detectAlignmentIssues(context, nodes).length, 0);
});

test('does not flag fewer than 8 candidates even with scattered origins', () => {
  const nodes = phoneTree(scatteredRows([16, 30, 44, 58, 72, 86, 100]));
  assert.equal(detectAlignmentIssues(context, nodes).length, 0);
});

test('excludes near-full-width container nodes from the edge count', () => {
  // 9 rows on 3 clean edges plus 6 full-width backgrounds at scattered origins.
  // Counting the containers would push this over both thresholds.
  const aligned = [
    ...[0, 1, 2].map((index) => text(`A ${index}`, { x: 16, y: 100 + index * 60, width: 120, height: 20 })),
    ...[0, 1, 2].map((index) => text(`B ${index}`, { x: 120, y: 300 + index * 60, width: 120, height: 20 })),
    ...[0, 1, 2].map((index) => text(`C ${index}`, { x: 240, y: 500 + index * 60, width: 120, height: 20 }))
  ];
  const containers = [0, 7, 14, 21, 28, 35].map((x, index) =>
    text(`Container ${index}`, { x, y: 700 + index * 25, width: 362, height: 20 }));
  assert.equal(detectAlignmentIssues(context, phoneTree([...aligned, ...containers])).length, 0);
});

test('produces deterministic finding ids across runs', () => {
  const nodes = phoneTree(scatteredRows([16, 24, 36, 48, 60, 72, 84, 96, 16]));
  const first = detectAlignmentIssues(context, nodes);
  const second = detectAlignmentIssues(context, nodes);
  assert.equal(first.length, 1);
  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});
