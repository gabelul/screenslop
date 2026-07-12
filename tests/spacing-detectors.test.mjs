import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenAxTree } from '../src/critique/ax-tree.mjs';
import { detectSpacingIssues } from '../src/critique/detectors/spacing.mjs';

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
    label: 'Spacing App',
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
 * Builds a vertical column of 20pt-tall labeled rows separated by the given gaps.
 * A gap list of length N yields N+1 rows and N measured gaps.
 * @param {number[]} gaps Vertical gaps between consecutive rows.
 * @returns {object[]} Labeled AX nodes.
 */
function column(gaps) {
  const rows = [];
  let y = 100;
  for (let index = 0; index <= gaps.length; index += 1) {
    rows.push(text(`Row ${index}`, { x: 16, y, width: 120, height: 20 }));
    y += 20 + (gaps[index] ?? 0);
  }
  return rows;
}

test('flags mostly off-grid gaps with the off-grid share in the detail', () => {
  // 10 rows, 9 gaps, 8 of them missing the 4pt grid (89%).
  const nodes = phoneTree(column([7, 9, 13, 15, 8, 7, 9, 13, 15]));
  const findings = detectSpacingIssues(context, nodes);
  assert.equal(findings.length, 1, 'expected exactly one spacing finding');
  const hit = findings[0];
  assert.equal(hit.ruleId, 'layout.spacing-offgrid');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'layout');
  assert.equal(hit.confidence, 'low');
  assert.match(hit.detail, /89% of 9 measured vertical gaps/);
  assert.match(hit.detail, /7, 9, 13, 15/, 'detail quotes example off-grid gap values');
  assert.match(hit.evidence.note, /^vertical gaps \(pt\):/);
  assert.equal(hit.evidence.artifact, 'accessibility.json');
  assert.equal(hit.evidence.node, undefined, 'screen-level finding carries no node evidence');
});

test('does not flag varied gaps that all sit on the 4pt grid', () => {
  const nodes = phoneTree(column([8, 12, 16, 8, 12, 16, 8, 12, 16]));
  assert.equal(detectSpacingIssues(context, nodes).length, 0);
});

test('flags identical 16pt gaps as monotony, not off-grid', () => {
  const nodes = phoneTree(column([16, 16, 16, 16, 16, 16, 16, 16, 16]));
  const findings = detectSpacingIssues(context, nodes);
  assert.equal(findings.length, 1, 'expected exactly one spacing finding');
  const hit = findings[0];
  assert.equal(hit.ruleId, 'layout.spacing-monotony');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'layout');
  assert.equal(hit.confidence, 'low');
  assert.match(hit.detail, /100% of 9 measured vertical gaps/);
  assert.match(hit.detail, /16pt/, 'detail states the dominant gap');
  assert.ok(!findings.some((finding) => finding.ruleId === 'layout.spacing-offgrid'));
});

test('monotony suppresses off-grid even when the uniform gap misses the grid', () => {
  // 15pt everywhere is both 100% off-grid and 100% monotonous; only monotony fires.
  const nodes = phoneTree(column([15, 15, 15, 15, 15, 15, 15, 15]));
  const findings = detectSpacingIssues(context, nodes);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'layout.spacing-monotony');
});

test('does not flag fewer than 8 measured gaps even when all are off-grid', () => {
  const nodes = phoneTree(column([7, 9, 13, 15, 7, 9]));
  assert.equal(detectSpacingIssues(context, nodes).length, 0);
});

test('does not flag a healthy on-grid spacing scale with real section breaks', () => {
  const nodes = phoneTree(column([8, 16, 24, 48, 8, 16, 24, 48]));
  assert.equal(detectSpacingIssues(context, nodes).length, 0);
});

test('produces deterministic finding ids across runs', () => {
  const offGrid = phoneTree(column([7, 9, 13, 15, 8, 7, 9, 13, 15]));
  const monotone = phoneTree(column([16, 16, 16, 16, 16, 16, 16, 16, 16]));
  for (const nodes of [offGrid, monotone]) {
    const first = detectSpacingIssues(context, nodes);
    const second = detectSpacingIssues(context, nodes);
    assert.equal(first.length, 1);
    assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
  }
});
