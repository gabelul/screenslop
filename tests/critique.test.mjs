import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCritique } from '../src/critique/collect-critique.mjs';
import { isInteractiveNode } from '../src/critique/ax-tree.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');


test('isInteractiveNode keeps the MVP role set conservative', () => {
  assert.equal(isInteractiveNode({ role: 'AXButton' }), true);
  assert.equal(isInteractiveNode({ role: 'AXMenuButton' }), true);
  assert.equal(isInteractiveNode({ role: 'AXPopUpButton' }), true);
  assert.equal(isInteractiveNode({ role: 'AXGenericElement', identifier: 'runtimeSmoke.saveButton' }), true);
  assert.equal(isInteractiveNode({ role: 'AXCell' }), false);
  assert.equal(isInteractiveNode({ role: 'AXTab' }), false);
  assert.equal(isInteractiveNode({ role: 'AXMenu' }), false);
  assert.equal(isInteractiveNode({ role: 'AXGenericElement', identifier: 'runtimeSmoke.title' }), false);
});

test('collectCritique writes an empty report for a clean bundle', async () => {
  const { root, bundle } = copyFixture('clean');
  const result = await collectCritique({ root, bundlePath: bundle });

  assert.equal(result.ok, true);
  assert.equal(result.summary.total, 0);
  assert.deepEqual(result.findings, []);
  assert.equal(fs.existsSync(path.join(root, result.artifacts.findingsPath)), true);
  assert.equal(fs.existsSync(path.join(root, result.artifacts.reportPath)), true);
});

test('collectCritique reports weak capture and missing accessibility evidence', async () => {
  const { root, bundle } = copyFixture('missing-ax');
  const result = await collectCritique({ root, bundlePath: bundle });

  assert.equal(result.ok, true);
  assert.equal(result.summary.bySeverity.P1, 1);
  assert.equal(result.summary.bySeverity.P2, 1);
  assert.equal(result.findings.some((finding) => finding.ruleId === 'evidence.missing-ax-tree'), true);
  assert.equal(result.findings.some((finding) => finding.ruleId === 'evidence.capture-status'), true);
});

test('collectCritique detects AX, touch target, offscreen, and log findings', async () => {
  const { root, bundle } = copyFixture('problem');
  const first = await collectCritique({ root, bundlePath: bundle });
  const second = await collectCritique({ root, bundlePath: bundle });
  const ruleIds = first.findings.map((finding) => finding.ruleId);

  assert.equal(first.ok, true);
  assert.equal(ruleIds.includes('ax.missing-name'), true);
  assert.equal(ruleIds.includes('ax.generic-name'), true);
  assert.equal(ruleIds.includes('layout.touch-target'), true);
  assert.equal(ruleIds.includes('layout.offscreen-frame'), true);
  assert.equal(ruleIds.includes('logs.error'), true);
  assert.equal(ruleIds.includes('logs.swiftui-layout'), true);
  assert.equal(first.findings.some((finding) => finding.evidence.node?.identifier === 'PopoverDismissRegion'), false);
  assert.deepEqual(first.findings.map((finding) => finding.id), second.findings.map((finding) => finding.id));
});


test('collectCritique suppresses recurring AX frame false positives', async () => {
  const { root, bundle } = createAxBundle({
    role: 'AXApplication',
    label: 'False Positive Fixture',
    enabled: true,
    hidden: false,
    frame: { x: 0, y: 0, width: 402, height: 874 },
    children: [
      { role: 'AXButton', label: 'Below fold row', enabled: true, hidden: false, identifier: 'settings.rowButton', frame: { x: 20, y: 920, width: 360, height: 48 } },
      { role: 'AXSegmentedControl', label: 'Filter segmented control', enabled: true, hidden: false, frame: { x: 20, y: 120, width: 220, height: 32 } },
      { role: 'AXGenericElement', label: 'Start date picker', enabled: true, hidden: false, identifier: 'startDatePicker', frame: { x: 20, y: 170, width: 180, height: 33 } },
      { role: 'AXButton', label: 'Return to JollyTrack', enabled: true, hidden: false, frame: { x: 8, y: 20, width: 150, height: 30 } },
      { role: 'AXButton', label: 'Back', enabled: true, hidden: false, frame: { x: 8, y: 64, width: 38, height: 32 } },
      { role: 'AXButton', label: 'More', enabled: true, hidden: false, identifier: 'main.toolbar.moreButton', frame: { x: 356, y: 64, width: 32, height: 32 } },
      { role: 'AXButton', label: 'Profile row', enabled: true, hidden: false, identifier: 'profile.SectionRow', frame: { x: 20, y: 240, width: 360, height: 40 } },
      { role: 'AXButton', label: 'Continue', enabled: true, hidden: false, identifier: 'onboarding.continueButton', frame: { x: 120, y: 300, width: 90, height: 22 } },
      { role: 'AXButton', label: 'Tiny custom action', enabled: true, hidden: false, identifier: 'custom.tinyIconButton', frame: { x: 20, y: 360, width: 32, height: 32 } },
      { role: 'AXButton', label: 'Horizontal offscreen action', enabled: true, hidden: false, identifier: 'custom.horizontalOffscreenButton', frame: { x: 430, y: 420, width: 80, height: 48 } }
    ]
  });
  const result = await collectCritique({ root, bundlePath: bundle });

  assert.equal(result.ok, true);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.label === 'Below fold row'), false);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.label === 'Filter segmented control'), false);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.label === 'Start date picker'), false);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.label === 'Return to JollyTrack'), false);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.label === 'Back'), false);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.identifier === 'main.toolbar.moreButton'), false);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.identifier === 'profile.SectionRow'), false);
  assert.equal(result.findings.some((finding) => finding.evidence.node?.identifier === 'onboarding.continueButton'), false);
  assert.equal(result.findings.some((finding) => finding.ruleId === 'layout.touch-target' && finding.evidence.node?.identifier === 'custom.tinyIconButton'), true);
  assert.equal(result.findings.some((finding) => finding.ruleId === 'layout.offscreen-frame' && finding.evidence.node?.identifier === 'custom.horizontalOffscreenButton'), true);
});


test('collectCritique prefers copied bundle-local artifacts over repo-root manifest paths', async () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-critique-moved-'));
  const movedBundle = path.join(tempRoot, 'moved-problem');
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), movedBundle, { recursive: true });

  fs.writeFileSync(path.join(movedBundle, 'accessibility.json'), JSON.stringify({
    role: 'AXApplication',
    label: 'Moved Clean App',
    enabled: true,
    hidden: false,
    frame: { x: 0, y: 0, width: 402, height: 874 },
    children: []
  }, null, 2));
  fs.writeFileSync(path.join(movedBundle, 'logs.ndjson'), '{"level":"default","eventMessage":"normal line"}\n');

  const result = await collectCritique({ root: repoRoot, bundlePath: movedBundle });

  assert.equal(result.ok, true);
  assert.equal(result.bundle, movedBundle);
  assert.equal(result.evidence, path.join(movedBundle, 'evidence.json'));
  assert.equal(result.summary.total, 0);
});

test('screenslop critique --json keeps external bundle paths absolute and local', () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-critique-cli-moved-'));
  const movedBundle = path.join(tempRoot, 'moved-problem');
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), movedBundle, { recursive: true });
  fs.writeFileSync(path.join(movedBundle, 'accessibility.json'), JSON.stringify({
    role: 'AXApplication',
    label: 'Moved Clean App',
    enabled: true,
    hidden: false,
    frame: { x: 0, y: 0, width: 402, height: 874 },
    children: []
  }, null, 2));
  fs.writeFileSync(path.join(movedBundle, 'logs.ndjson'), '{"level":"default","eventMessage":"normal line"}\n');

  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'critique', movedBundle, '--json'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.bundle, movedBundle);
  assert.equal(payload.evidence, path.join(movedBundle, 'evidence.json'));
  assert.equal(payload.artifacts.findingsPath, path.join(movedBundle, 'findings.json'));
  assert.equal(payload.summary.total, 0);
});

test('screenslop critique --json prints parseable output and writes artifacts', () => {
  const { root, bundle } = copyFixture('problem');
  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'critique', bundle, '--json'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'critique');
  assert.equal(payload.summary.total > 0, true);
  assert.equal(fs.existsSync(path.join(root, payload.artifacts.findingsPath)), true);
  assert.equal(fs.existsSync(path.join(root, payload.artifacts.reportPath)), true);
});


test('emitted findings conform to the finding schema contract', async () => {
  const schema = JSON.parse(fs.readFileSync(path.join(repoRoot, 'schemas/finding.schema.json'), 'utf8'));
  const { root, bundle } = copyFixture('problem');
  const result = await collectCritique({ root, bundlePath: bundle });

  for (const finding of result.findings) {
    assertFindingMatchesSchema(finding, schema);
  }
});

test('screenslop critique exits nonzero for unreadable bundle input', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-critique-missing-'));
  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'critique', 'missing', '--json'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Evidence manifest not found/);
});


/**
 * Checks the subset of JSON Schema constraints used by finding.schema.json.
 * @param {object} finding Emitted finding.
 * @param {object} schema Finding JSON schema.
 * @returns {void}
 */
function assertFindingMatchesSchema(finding, schema) {
  for (const field of schema.required) {
    assert.ok(Object.hasOwn(finding, field), `missing required field ${field}`);
  }

  assert.equal(typeof finding.id, 'string');
  assert.equal(typeof finding.ruleId, 'string');
  assert.equal(typeof finding.title, 'string');
  assert.equal(typeof finding.detail, 'string');
  assert.equal(typeof finding.suggestedFix, 'string');
  assert.equal(typeof finding.verification, 'string');
  assert.equal(typeof finding.evidence, 'object');
  assert.equal(schema.properties.severity.enum.includes(finding.severity), true);
  assert.equal(schema.properties.pillar.enum.includes(finding.pillar), true);
  assert.equal(schema.properties.confidence.enum.includes(finding.confidence), true);
  assert.equal(schema.properties.effort.enum.includes(finding.effort), true);
}

/**
 * Creates a minimal complete evidence bundle from an AX tree.
 * @param {object} accessibility Accessibility tree root.
 * @returns {{root:string,bundle:string}} Temporary root and bundle path.
 */
function createAxBundle(accessibility) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-critique-ax-'));
  const bundle = 'artifacts/ax-fixture';
  const bundlePath = path.join(root, bundle);
  fs.mkdirSync(bundlePath, { recursive: true });
  fs.writeFileSync(path.join(bundlePath, 'accessibility.json'), JSON.stringify(accessibility, null, 2));
  fs.writeFileSync(path.join(bundlePath, 'evidence.json'), JSON.stringify({
    runId: 'ax-fixture',
    createdAt: '2026-06-16T00:00:00.000Z',
    surface: 'AX Fixture',
    runtime: { driver: 'baguette', deviceName: 'iPhone Test', udid: 'TEST' },
    environment: { appearance: 'unspecified' },
    artifacts: {
      screenshot: 'artifacts/ax-fixture/screenshot.jpg',
      accessibilityTree: 'artifacts/ax-fixture/accessibility.json',
      logs: null,
      summary: 'artifacts/ax-fixture/summary.md'
    },
    capture: {
      status: 'complete',
      steps: [
        { name: 'screenshot', ok: true, message: 'ok' },
        { name: 'accessibility-tree', ok: true, message: 'ok' }
      ]
    },
    sourceHints: []
  }, null, 2));
  return { root, bundle };
}

/**
 * Copies an evidence fixture into a temporary root.
 * @param {string} name Fixture name.
 * @returns {{root:string,bundle:string}} Temporary root and bundle path.
 */
function copyFixture(name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `screenslop-critique-${name}-`));
  const source = path.join(repoRoot, 'tests/fixtures/evidence', name);
  const target = path.join(root, 'tests/fixtures/evidence', name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, { recursive: true });
  return { root, bundle: `tests/fixtures/evidence/${name}` };
}
