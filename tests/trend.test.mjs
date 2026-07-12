import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCritiqueTrend, writeTrendArtifact } from '../src/critique/trend.mjs';

test('computeCritiqueTrend returns no-baseline without sibling bundles', () => {
  const parent = makeArtifactsDir();
  const bundleDir = makeBundle(parent, '2026-07-12T10-00-00-run', []);

  const trend = computeCritiqueTrend({ bundleDir, findings: [], summary: summarize([]) });

  assert.deepEqual(trend, { status: 'no-baseline', previousBundle: null });
});

test('computeCritiqueTrend compares against the most recent older sibling', () => {
  const parent = makeArtifactsDir();
  const previousFindings = [
    makeFinding('ax-missing-name-aaaa1111', 'ax.missing-name', 'P1', 'Button has no accessible name'),
    makeFinding('layout-touch-target-bbbb2222', 'layout.touch-target', 'P2', 'Touch target below 44pt'),
    makeFinding('logs-error-cccc3333', 'logs.error', 'P2', 'Runtime error logged')
  ];
  const currentFindings = [
    makeFinding('ax-missing-name-aaaa1111', 'ax.missing-name', 'P1', 'Button has no accessible name'),
    makeFinding('layout-offscreen-frame-dddd4444', 'layout.offscreen-frame', 'P1', 'Action rendered offscreen')
  ];
  const previousDir = makeBundle(parent, '2026-07-11T09-00-00-run', previousFindings, hoursAgo(2));
  const bundleDir = makeBundle(parent, '2026-07-12T10-00-00-run', currentFindings, hoursAgo(0));

  const trend = computeCritiqueTrend({ bundleDir, findings: currentFindings, summary: summarize(currentFindings) });

  assert.equal(trend.status, 'compared');
  assert.equal(trend.previousBundle, path.basename(previousDir));
  assert.deepEqual(trend.newFindings, [
    { id: 'layout-offscreen-frame-dddd4444', ruleId: 'layout.offscreen-frame', severity: 'P1', title: 'Action rendered offscreen' }
  ]);
  assert.deepEqual(trend.resolvedFindings.map((finding) => finding.id), [
    'layout-touch-target-bbbb2222',
    'logs-error-cccc3333'
  ]);
  assert.equal(trend.unchangedCount, 1);
  assert.deepEqual(trend.deltaBySeverity, { P0: 0, P1: 1, P2: -2, P3: 0 });
});

test('computeCritiqueTrend treats corrupt previous findings.json as no-baseline', () => {
  const parent = makeArtifactsDir();
  const previousDir = makeBundle(parent, '2026-07-11T09-00-00-run', [], hoursAgo(2));
  fs.writeFileSync(path.join(previousDir, 'findings.json'), '{not valid json');
  const bundleDir = makeBundle(parent, '2026-07-12T10-00-00-run', [], hoursAgo(0));

  const trend = computeCritiqueTrend({ bundleDir, findings: [], summary: summarize([]) });

  assert.deepEqual(trend, { status: 'no-baseline', previousBundle: null });
});

test('computeCritiqueTrend reports the previous bundle as a basename, never a path', () => {
  const parent = makeArtifactsDir();
  makeBundle(parent, '2026-07-11T09-00-00-run', [], hoursAgo(2));
  const bundleDir = makeBundle(parent, '2026-07-12T10-00-00-run', [], hoursAgo(0));

  const trend = computeCritiqueTrend({ bundleDir, findings: [], summary: summarize([]) });

  assert.equal(trend.previousBundle, '2026-07-11T09-00-00-run');
  assert.equal(trend.previousBundle.includes(path.sep), false);
  assert.equal(path.isAbsolute(trend.previousBundle), false);
});

test('writeTrendArtifact writes valid JSON into the bundle directory', () => {
  const parent = makeArtifactsDir();
  const bundleDir = makeBundle(parent, '2026-07-12T10-00-00-run', []);
  const trend = { status: 'no-baseline', previousBundle: null };

  const trendPath = writeTrendArtifact(bundleDir, trend);

  assert.equal(trendPath, path.join(bundleDir, 'trend.json'));
  assert.deepEqual(JSON.parse(fs.readFileSync(trendPath, 'utf8')), trend);
});

test('computeCritiqueTrend output is deterministic across repeat calls', () => {
  const parent = makeArtifactsDir();
  const previousFindings = [
    makeFinding('logs-error-cccc3333', 'logs.error', 'P2', 'Runtime error logged'),
    makeFinding('ax-generic-name-eeee5555', 'ax.generic-name', 'P2', 'Generic accessibility label')
  ];
  const currentFindings = [
    makeFinding('ax-missing-name-aaaa1111', 'ax.missing-name', 'P1', 'Button has no accessible name'),
    makeFinding('logs-error-cccc3333', 'logs.error', 'P2', 'Runtime error logged')
  ];
  makeBundle(parent, '2026-07-11T09-00-00-run', previousFindings, hoursAgo(2));
  const bundleDir = makeBundle(parent, '2026-07-12T10-00-00-run', currentFindings, hoursAgo(0));

  const first = computeCritiqueTrend({ bundleDir, findings: currentFindings, summary: summarize(currentFindings) });
  const second = computeCritiqueTrend({ bundleDir, findings: currentFindings, summary: summarize(currentFindings) });

  assert.deepEqual(first, second);
  assert.equal(JSON.stringify(first, null, 2), JSON.stringify(second, null, 2));
});

/**
 * Creates a temporary artifacts parent directory for sibling bundles.
 * @returns {string} Parent directory path.
 */
function makeArtifactsDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-trend-'));
}

/**
 * Creates one bundle directory with a findings.json artifact.
 * @param {string} parent Parent artifacts directory.
 * @param {string} name Bundle run id.
 * @param {object[]} findings Findings for the bundle.
 * @param {Date} [mtime] Directory mtime override so ordering is explicit.
 * @returns {string} Bundle directory path.
 */
function makeBundle(parent, name, findings, mtime) {
  const bundleDir = path.join(parent, name);
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.writeFileSync(path.join(bundleDir, 'findings.json'), `${JSON.stringify({ summary: summarize(findings), findings }, null, 2)}\n`);
  if (mtime) fs.utimesSync(bundleDir, mtime, mtime);
  return bundleDir;
}

/**
 * Builds a minimal finding in the shape emitted by findings.mjs.
 * @param {string} id Fingerprint-stable finding id.
 * @param {string} ruleId Detector rule id.
 * @param {string} severity P0-P3 severity.
 * @param {string} title Finding title.
 * @returns {object} Finding fixture.
 */
function makeFinding(id, ruleId, severity, title) {
  return { id, ruleId, severity, title, pillar: 'accessibility', evidence: {}, confidence: 'medium', effort: 'medium' };
}

/**
 * Summarizes findings by severity like summarizeFindings does.
 * @param {object[]} findings Finding fixtures.
 * @returns {object} Summary counts.
 */
function summarize(findings) {
  const bySeverity = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const finding of findings) bySeverity[finding.severity] += 1;
  return { total: findings.length, bySeverity };
}

/**
 * Returns a Date shifted into the past so mtime ordering is unambiguous.
 * @param {number} hours Hours before now.
 * @returns {Date} Past timestamp.
 */
function hoursAgo(hours) {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}
