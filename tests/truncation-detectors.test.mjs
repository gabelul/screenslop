import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenAxTree } from '../src/critique/ax-tree.mjs';
import { detectTruncationIssues } from '../src/critique/detectors/truncation.mjs';

const context = { artifacts: { accessibilityTree: { displayPath: 'accessibility.json' } } };

/**
 * Builds a phone-sized AX tree around the given child nodes.
 * @param {object[]} children Child AX nodes.
 * @returns {object[]} Flattened nodes.
 */
function phoneTree(children) {
  return flattenAxTree({
    role: 'AXApplication',
    label: 'Truncation App',
    enabled: true,
    hidden: false,
    frame: { x: 0, y: 0, width: 402, height: 874 },
    children
  });
}

function label(text, frame, extra = {}) {
  return { role: 'AXStaticText', label: text, enabled: true, hidden: false, frame, ...extra };
}

test('flags a long label crammed into a narrow single-line frame', () => {
  const nodes = phoneTree([label('A'.repeat(300), { x: 20, y: 100, width: 60, height: 20 })]);
  const findings = detectTruncationIssues(context, nodes);
  assert.equal(findings.length, 1);
  const hit = findings[0];
  assert.equal(hit.ruleId, 'typography.truncation-risk');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'typography');
  assert.equal(hit.confidence, 'low');
  // Long names get trimmed to 40 chars in the detail text.
  assert.match(hit.detail, /"A{40}…"/);
  assert.match(hit.detail, /German and French/);
  assert.ok(hit.evidence.screenshotRegion);
});

test('does not flag a short label with plenty of room', () => {
  const nodes = phoneTree([label('OK', { x: 20, y: 100, width: 200, height: 20 })]);
  const findings = detectTruncationIssues(context, nodes);
  assert.equal(findings.length, 0);
});

test('does not flag a comfortable sentence-length label (dogfood regression)', () => {
  // Real capture: "Add the first records to start the packet." (42 chars)
  // rendered fine in a ~350pt frame at ~20pt tall, but the old 15% margin
  // flagged it. The estimate said ~353pt of text; 25% slack absorbs that.
  const text = 'Add the first records to start the packet.';
  const nodes = phoneTree([label(text, { x: 24, y: 300, width: 350, height: 20 })]);
  const findings = detectTruncationIssues(context, nodes);
  assert.equal(findings.length, 0);
});

test('flags a literal ellipsis at medium confidence even when the width fits', () => {
  const nodes = phoneTree([label('Recent do…', { x: 20, y: 100, width: 300, height: 20 })]);
  const findings = detectTruncationIssues(context, nodes);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, 'medium');
  assert.match(findings[0].detail, /already contains/);
});

test('skips tall multi-line frames even with long text', () => {
  const nodes = phoneTree([label('A'.repeat(300), { x: 20, y: 100, width: 60, height: 80 })]);
  const findings = detectTruncationIssues(context, nodes);
  assert.equal(findings.length, 0);
});

test('caps output at 5 findings, worst overflow ratios first', () => {
  const children = Array.from({ length: 8 }, (_, index) =>
    label('X'.repeat(60 + index * 20), { x: 20, y: 100 + index * 30, width: 60, height: 20 })
  );
  const nodes = phoneTree(children);
  const findings = detectTruncationIssues(context, nodes);
  assert.equal(findings.length, 5);
  // The longest label overflows hardest and must lead the list.
  assert.equal(findings[0].evidence.node.label, 'X'.repeat(60 + 7 * 20));
  assert.equal(new Set(findings.map((finding) => finding.id)).size, 5);
});

test('produces stable fingerprint-backed ids', () => {
  const nodes = phoneTree([
    label('A'.repeat(300), { x: 20, y: 100, width: 60, height: 20 }),
    label('Recent do…', { x: 20, y: 200, width: 300, height: 20 })
  ]);
  const first = detectTruncationIssues(context, nodes);
  const second = detectTruncationIssues(context, nodes);
  assert.ok(first.length > 0);
  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});
