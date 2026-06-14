import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { collectMatrix } from '../src/matrix/collect-matrix.mjs';
import { collectDesignProfile } from '../src/design/profile.mjs';

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
    assert.ok(cell.settingStatus.appearance.status);
    assert.ok(cell.settingStatus.dynamicType.status);
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
  assert.equal(report.cells.find((cell) => cell.id === 'dark-appearance').settingStatus.appearance.status, 'unavailable');
  assert.equal(report.cells.find((cell) => cell.id === 'dynamic-type-accessibility').settingStatus.dynamicType.status, 'unavailable');
});

test('matrix design dry-run records unavailable design status per cell', async () => {
  const root = createWorkspace();
  writeConfig(root);

  const report = await collectMatrix({ root, dryRun: true, includeDesign: true });

  assert.equal(report.designSummary.enabled, true);
  assert.equal(report.designSummary.cellsReviewed, 0);
  assert.equal(report.designSummary.consistency.status, 'not-run');
  for (const cell of report.cells) {
    assert.equal(cell.design.enabled, true);
    assert.equal(cell.design.status, 'dry-run');
    assert.equal(cell.design.findings, 0);
  }
});

test('matrix writes reports and dry-run bundles under configured artifactsDir', async () => {
  const root = createWorkspace();
  writeConfig(root, { artifactsDir: 'matrix-artifacts' });

  const report = await collectMatrix({ root, dryRun: true });

  assert.match(report.artifacts.reportPath, /^matrix-artifacts\//);
  assert.match(report.artifacts.reportMarkdownPath, /^matrix-artifacts\//);
  assert.equal(fs.existsSync(path.join(root, report.artifacts.reportPath)), true);
  for (const cell of report.cells) {
    assert.match(cell.evidenceBundle, /^matrix-artifacts\//);
    assert.match(cell.evidence, /^matrix-artifacts\//);
    assert.equal(fs.existsSync(path.join(root, cell.evidence)), true);
  }
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
  assert.equal(report.cells.find((cell) => cell.id === 'dark-appearance').settingStatus.appearance.status, 'requested-only');
  assert.equal(report.cells.find((cell) => cell.id === 'dynamic-type-normal').settingStatus.dynamicType.status, 'requested-only');
  assert.equal(report.cells[0].settingStatus.appearance.status, 'not-requested');
});


test('matrix --design threads design summaries through captured cells', async () => {
  const root = createWorkspace();
  writeConfig(root);
  fs.writeFileSync(path.join(root, 'App', 'SettingsView.swift'), 'import SwiftUI\nstruct SettingsView: View { var body: some View { Text("Settings") } }\n');
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# Design\n\nKeep status copy honest.\n');
  collectDesignProfile({ root, write: true, yes: true });
  let count = 0;

  const report = await collectMatrix({
    root,
    includeDesign: true,
    agentPacket: true,
    commandRunner: () => ({ status: 0, stdout: '{}', stderr: '' }),
    collectSeeFn: async () => {
      count += 1;
      const dir = path.join('artifacts', `design-cell-${count}`);
      const absolute = path.join(root, dir);
      fs.mkdirSync(absolute, { recursive: true });
      const manifest = {
        runId: `design-cell-${count}`,
        surface: 'Settings',
        runtime: { driver: 'matrix', deviceName: 'iPhone Test', udid: 'TEST' },
        artifacts: { screenshot: path.join(dir, 'screenshot.jpg') },
        capture: { status: 'complete', steps: [] }
      };
      fs.writeFileSync(path.join(absolute, 'evidence.json'), `${JSON.stringify(manifest, null, 2)}\n`);
      fs.writeFileSync(path.join(absolute, 'screenshot.jpg'), 'fake');
      return { ok: true, dir, evidence: path.join(dir, 'evidence.json'), artifacts: manifest.artifacts };
    },
    collectCritiqueFn: async ({ bundlePath }) => ({
      ok: true,
      command: 'critique',
      bundle: bundlePath,
      evidence: path.join(bundlePath, 'evidence.json'),
      artifacts: {},
      summary: { total: 0, bySeverity: { P0: 0, P1: 0, P2: 0, P3: 0 }, byPillar: {} },
      findings: []
    })
  });

  assert.equal(report.designSummary.enabled, true);
  assert.equal(report.designSummary.cellsReviewed, 6);
  assert.equal(report.designSummary.findings, 0);
  assert.equal(report.designSummary.consistency.status, 'consistent');
  assert.equal(report.summary.designCells, 6);
  assert.equal(report.cells[0].design.status, 'reviewed');
  assert.equal(report.cells[0].design.profileStatus, 'current');
  assert.match(report.cells[0].design.artifacts.designPacketPath, /design-review-packet\.json$/);
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
 * @param {object} [overrides] Config field overrides.
 * @returns {void}
 */
function writeConfig(root, overrides = {}) {
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
    sourceHints: [],
    ...overrides
  }, null, 2)}\n`);
}
