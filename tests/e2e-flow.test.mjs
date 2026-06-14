import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { runFixtureE2EFlow } from './helpers/e2e-flow.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('fixture e2e flow verifies a selected finding fixed after fresh critique', async () => {
  const result = await runFixtureE2EFlow({ freshMode: 'fixed' });
  const item = result.verification.items[0];

  assert.equal(result.ok, true);
  assert.equal(item.status, 'verified-fixed');
  assert.equal(result.fix.items[0].status, 'applied');
  assert.equal(result.fix.session.appliedPatches[0].findingId, result.findingId);
  assertArtifactsExist(result.artifacts);
  assertVerificationArtifactMatches(result.artifacts.verificationPath, result.verification.summary);
  assertFreshCritiqueWasRegenerated(result);
});

test('fixture e2e flow reports still-present when fresh evidence keeps the same stable key', async () => {
  const result = await runFixtureE2EFlow({ freshMode: 'still-present' });
  const item = result.verification.items[0];

  assert.equal(item.status, 'still-present');
  assert.match(item.matchKey, /node\.identifier=settings\.saveButton/);
  assertArtifactsExist(result.artifacts);
  assertFreshCritiqueWasRegenerated(result);
});

test('fixture e2e flow reports changed when the same rule moves to another stable key', async () => {
  const result = await runFixtureE2EFlow({ freshMode: 'changed' });
  const item = result.verification.items[0];

  assert.equal(item.status, 'changed');
  assert.equal(item.freshEvidence.node.identifier, 'settings.otherButton');
  assertArtifactsExist(result.artifacts);
  assertFreshCritiqueWasRegenerated(result);
});

test('fixture e2e smoke script prints parseable JSON for CI and agents', () => {
  const result = spawnSync('node', [
    path.join(repoRoot, 'scripts/smoke-e2e-flow.mjs'),
    '--fresh-mode',
    'fixed'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, 'e2e-flow');
  assert.equal(payload.verification.items[0].status, 'verified-fixed');
});

test('screenslop verify still refuses to prove without a fresh bundle', () => {
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'verify',
    'tests/fixtures/evidence/problem',
    '--json'
  ], { cwd: repoRoot, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Missing --fresh-bundle/);
});

test('screenslop matrix writes a real no-config report with linked cell evidence', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-matrix-cli-'));
  fs.mkdirSync(path.join(workspace, 'examples', 'matrix'), { recursive: true });
  fs.copyFileSync(path.join(repoRoot, 'examples/matrix/default.json'), path.join(workspace, 'examples/matrix/default.json'));
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'matrix',
    '--dry-run',
    '--profile',
    'examples/matrix/default.json',
    '--json'
  ], {
    cwd: workspace,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, 'matrix');
  assert.equal(payload.summary.total, 6);
  assert.equal(payload.summary.unavailable, 6);
  assert.equal(payload.cells[0].reason, 'no-config');
  assert.equal(fs.existsSync(path.join(workspace, payload.artifacts.reportPath)), true);
  assert.equal(fs.existsSync(path.join(workspace, payload.cells[0].evidence)), true);
});

/**
 * Asserts all reported flow artifact paths exist on disk.
 * @param {object} artifacts Flow artifact path map.
 * @returns {void}
 */
function assertArtifactsExist(artifacts) {
  for (const [name, file] of Object.entries(artifacts)) {
    assert.equal(Boolean(file), true, `${name} should be present`);
    assert.equal(fs.existsSync(file), true, `${name} should exist: ${file}`);
  }
}

/**
 * Confirms the written verification artifact matches returned summary data.
 * @param {string} file Verification JSON path.
 * @param {object} summary Expected summary.
 * @returns {void}
 */
function assertVerificationArtifactMatches(file, summary) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(payload.summary, summary);
}

/**
 * Confirms fresh verification input came from a newly written fresh critique.
 * @param {object} result Flow result.
 * @returns {void}
 */
function assertFreshCritiqueWasRegenerated(result) {
  assert.equal(path.dirname(result.artifacts.freshFindingsPath), result.freshBundle);
  const freshPayload = JSON.parse(fs.readFileSync(result.artifacts.freshFindingsPath, 'utf8'));
  assert.equal(Array.isArray(freshPayload.findings), true);
  const verificationPayload = JSON.parse(fs.readFileSync(result.artifacts.verificationPath, 'utf8'));
  assert.equal(verificationPayload.freshFindingsPath, result.artifacts.freshFindingsPath);
}

/**
 * Lists files below a directory, returning an empty list when absent.
 * @param {string} dir Directory path.
 * @returns {string[]} Sorted relative file paths.
 */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const files = [];
  walk(dir, dir, files);
  return files.sort();
}

/**
 * Recursively walks files for placeholder side-effect checks.
 * @param {string} root Root directory.
 * @param {string} dir Current directory.
 * @param {string[]} files Output file list.
 * @returns {void}
 */
function walk(root, dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, file, files);
      continue;
    }
    if (entry.isFile()) files.push(path.relative(root, file));
  }
}
