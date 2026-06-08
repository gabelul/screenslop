import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectMatrix } from '../src/matrix/collect-matrix.mjs';

test('matrix dry-run with no config writes six unavailable cell bundles', async () => {
  const root = createWorkspace();
  const report = await collectMatrix({ root, dryRun: true });

  assert.equal(report.ok, true);
  assert.equal(report.summary.total, 6);
  assert.equal(report.summary.unavailable, 6);
  assert.equal(report.cells[0].id, 'default-configured-iphone');
  assert.equal(report.cells[0].reason, 'no-config');
  assert.equal(fs.existsSync(path.join(root, report.artifacts.reportPath)), true);
  for (const cell of report.cells) {
    assert.equal(fs.existsSync(path.join(root, cell.evidence)), true);
  }
});

test('matrix dry-run with config preserves the six requested profile cells', async () => {
  const root = createWorkspace();
  writeConfig(root);

  const report = await collectMatrix({ root, dryRun: true });

  assert.equal(report.summary.total, 6);
  assert.equal(report.summary.dryRun, 6);
  assert.deepEqual(report.cells.map((cell) => cell.id), [
    'default-configured-iphone',
    'large-iphone',
    'light-appearance',
    'dark-appearance',
    'dynamic-type-normal',
    'dynamic-type-accessibility'
  ]);
  assert.equal(report.cells.find((cell) => cell.id === 'dark-appearance').requested.appearance, 'dark');
  assert.equal(report.cells.find((cell) => cell.id === 'dynamic-type-accessibility').requested.dynamicType, 'accessibility3');
});

test('matrix live path records capture and optional critique per cell', async () => {
  const root = createWorkspace();
  writeConfig(root);
  const seen = [];

  const report = await collectMatrix({
    root,
    includeCritique: true,
    commandRunner: () => ({ status: 0, stdout: '{}', stderr: '' }),
    collectSeeFn: async (options) => {
      seen.push(options);
      const dir = path.join('artifacts', `fake-${seen.length}`);
      const absolute = path.join(root, dir);
      fs.mkdirSync(absolute, { recursive: true });
      fs.writeFileSync(path.join(absolute, 'evidence.json'), '{}');
      return {
        ok: true,
        dir,
        evidence: path.join(dir, 'evidence.json'),
        artifacts: { screenshot: path.join(dir, 'screenshot.jpg'), accessibilityTree: path.join(dir, 'accessibility.json') }
      };
    },
    collectCritiqueFn: async ({ bundlePath }) => ({
      ok: true,
      summary: { total: bundlePath.includes('fake') ? 1 : 0 },
      artifacts: { findingsPath: path.join(bundlePath, 'findings.json') }
    })
  });

  assert.equal(report.summary.captured, 6);
  assert.equal(report.summary.failed, 0);
  assert.equal(seen.length, 6);
  assert.equal(seen[0].surface, 'Settings');
  assert.equal(seen[0].bundleId, 'dev.example.App');
  assert.equal(report.cells[0].build.ok, true);
  assert.equal(report.cells[0].critique.findings, 1);
});

/**
 * Creates a temporary project workspace.
 * @returns {string} Workspace root.
 */
function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-matrix-test-'));
  fs.mkdirSync(path.join(root, 'App'), { recursive: true });
  return root;
}

/**
 * Writes a valid Screenslop project config.
 * @param {string} root Workspace root.
 * @returns {void}
 */
function writeConfig(root) {
  fs.mkdirSync(path.join(root, '.screenslop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    schemaVersion: 1,
    runtimePreference: ['baguette', 'xcodebuildmcp', 'simctl', 'manual'],
    preferredRuntime: 'baguette',
    defaultSurface: 'Settings',
    defaultScheme: 'App',
    defaultBundleId: 'dev.example.App',
    defaultDevice: 'iPhone 17',
    workspacePath: 'App.xcworkspace',
    projectPath: null,
    sourceRoot: 'App',
    artifactsDir: 'artifacts',
    sourceHints: []
  }, null, 2)}\n`);
}
