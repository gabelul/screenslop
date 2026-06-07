import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCritique } from '../src/critique/collect-critique.mjs';
import { collectFix } from '../src/fix/collect-fix.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const missingId = 'ax-missing-name-a21707c7';
const genericId = 'ax-generic-name-caa7d73a';
const touchId = 'layout-touch-target-81b024fb';
const offscreenId = 'layout-offscreen-frame-a9e77282';

test('collectFix dry-run writes artifacts and does not edit source', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const before = readSettings(sourceRoot);

  const result = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [missingId],
    dryRun: true,
    label: 'Save settings'
  });

  assert.equal(result.ok, true);
  assert.equal(result.items[0].status, 'planned');
  assert.match(result.items[0].patchPreview, /accessibilityLabel/);
  assert.equal(readSettings(sourceRoot), before);
  assert.equal(fs.existsSync(path.join(root, bundle, 'fix-plan.json')), true);
  assert.equal(fs.existsSync(path.join(root, bundle, 'fix.md')), true);
  assert.equal(fs.existsSync(path.join(root, bundle, 'fix-session.json')), false);
});

test('screenslop fix --json returns parseable dry-run output', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'fix',
    bundle,
    '--finding',
    missingId,
    '--source-root',
    sourceRoot,
    '--dry-run',
    '--label',
    'Save settings',
    '--json'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, 'fix');
  assert.equal(payload.items[0].findingId, missingId);
  assert.equal(payload.items[0].status, 'planned');
});

test('missing findings file fails cleanly through CLI JSON', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-fix-missing-findings-'));
  const bundle = path.join(root, 'problem');
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), bundle, { recursive: true });
  fs.rmSync(path.join(bundle, 'findings.json'), { force: true });

  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'fix', bundle, '--json'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /Findings file not found/);
});


test('JSON apply without yes fails without prompt text', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'fix',
    bundle,
    '--finding',
    missingId,
    '--source-root',
    sourceRoot,
    '--apply',
    '--label',
    'Save settings',
    '--json'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes('Apply Screenslop source patches'), false);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /JSON apply without --yes/);
});

test('unknown finding IDs fail instead of producing an empty success', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  await assert.rejects(
    collectFix({ root, bundlePath: bundle, sourceRoot, findingIds: ['missing-id'], dryRun: true }),
    /Unknown finding ID/
  );
});



test('apply requires explicit finding selection', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const before = readSettings(sourceRoot);

  await assert.rejects(
    collectFix({ root, bundlePath: bundle, sourceRoot, apply: true, yes: true, label: 'Save settings' }),
    /without --finding/
  );
  assert.equal(readSettings(sourceRoot), before);
});

test('dry-run wins over apply and does not edit source', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const before = readSettings(sourceRoot);

  const result = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [missingId],
    apply: true,
    dryRun: true,
    yes: true,
    label: 'Save settings'
  });

  assert.equal(result.items[0].status, 'planned');
  assert.equal(readSettings(sourceRoot), before);
  assert.equal(fs.existsSync(path.join(root, bundle, 'fix-session.json')), false);
});

test('accessibility label apply is idempotent', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();

  const first = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [missingId],
    apply: true,
    yes: true,
    label: 'Save settings'
  });
  const second = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [missingId],
    apply: true,
    yes: true,
    label: 'Save settings'
  });

  const source = readSettings(sourceRoot);
  assert.equal(first.items[0].status, 'applied');
  assert.equal(second.items[0].status, 'skipped');
  assert.equal(count(source, '.accessibilityLabel("Save settings")'), 1);
});


test('accessibility label replacement sees labels before identifier', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const file = path.join(sourceRoot, 'SettingsView.swift');
  const source = fs.readFileSync(file, 'utf8').replace(
    '.accessibilityIdentifier("settings.saveButton")',
    '.accessibilityLabel("Old save")\n            .accessibilityIdentifier("settings.saveButton")'
  );
  fs.writeFileSync(file, source);

  const result = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [missingId],
    apply: true,
    yes: true,
    label: 'Save settings'
  });

  const after = readSettings(sourceRoot);
  assert.equal(result.items[0].status, 'applied');
  assert.equal(count(after, '.accessibilityLabel("Save settings")'), 1);
  assert.equal(after.includes('.accessibilityLabel("Old save")'), false);
});

test('generic accessibility label replacement is idempotent', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();

  const first = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [genericId],
    apply: true,
    yes: true,
    label: 'Add gift'
  });
  const second = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [genericId],
    apply: true,
    yes: true,
    label: 'Add gift'
  });

  const source = readSettings(sourceRoot);
  assert.equal(first.items[0].status, 'applied');
  assert.equal(second.items[0].status, 'skipped');
  assert.equal(count(source, '.accessibilityLabel("Add gift")'), 1);
  assert.equal(source.includes('.accessibilityLabel("Button")'), false);
});

test('touch target apply is idempotent', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();

  const first = await collectFix({ root, bundlePath: bundle, sourceRoot, findingIds: [touchId], apply: true, yes: true });
  const second = await collectFix({ root, bundlePath: bundle, sourceRoot, findingIds: [touchId], apply: true, yes: true });

  const source = readSettings(sourceRoot);
  assert.equal(first.items[0].status, 'applied');
  assert.equal(second.items[0].status, 'skipped');
  assert.equal(count(source, '.frame(minWidth: 44, minHeight: 44)'), 1);
});


test('sourceHint line can drive a unique safe accessibility patch', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const findingsPath = path.join(root, bundle, 'findings.json');
  const payload = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  const findings = Array.isArray(payload) ? payload : payload.findings;
  const finding = findings.find((item) => item.id === missingId);
  finding.evidence.node.identifier = null;
  finding.evidence.sourceHint = 'SettingsView.swift:9';
  fs.writeFileSync(findingsPath, `${JSON.stringify({ ...payload, findings }, null, 2)}\n`);

  const result = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [missingId],
    apply: true,
    yes: true,
    label: 'Save settings'
  });

  assert.equal(result.items[0].status, 'applied');
  assert.equal(count(readSettings(sourceRoot), '.accessibilityLabel("Save settings")'), 1);
});

test('ambiguous identifiers do not edit source', async () => {
  const { root, bundle } = await fixtureWorkspace();
  const sourceRoot = copySource(root, 'ambiguous-swiftui');
  const before = readTree(sourceRoot);

  const result = await collectFix({
    root,
    bundlePath: bundle,
    sourceRoot,
    findingIds: [missingId],
    apply: true,
    yes: true,
    label: 'Save settings'
  });

  assert.equal(result.items[0].status, 'ambiguous');
  assert.equal(readTree(sourceRoot), before);
});

test('unsupported findings produce manual plan items without edits', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const before = readSettings(sourceRoot);

  const result = await collectFix({ root, bundlePath: bundle, sourceRoot, findingIds: [offscreenId], apply: true, yes: true });

  assert.equal(result.items[0].status, 'unsupported');
  assert.equal(result.items[0].fixability, 'unsupported');
  assert.equal(readSettings(sourceRoot), before);
});

test('apply without confirmation fails before editing', async () => {
  const { root, bundle, sourceRoot } = await fixtureWorkspace();
  const before = readSettings(sourceRoot);

  await assert.rejects(
    collectFix({ root, bundlePath: bundle, sourceRoot, findingIds: [missingId], apply: true, label: 'Save settings' }),
    /without --yes/
  );
  assert.equal(readSettings(sourceRoot), before);
});

test('verify command records pass and fail status separately from apply', async () => {
  const passing = await fixtureWorkspace();
  const passResult = await collectFix({
    root: passing.root,
    bundlePath: passing.bundle,
    sourceRoot: passing.sourceRoot,
    findingIds: [missingId],
    apply: true,
    yes: true,
    label: 'Save settings',
    verifyCommand: 'node -e "process.exit(0)"'
  });

  const failing = await fixtureWorkspace();
  const failResult = await collectFix({
    root: failing.root,
    bundlePath: failing.bundle,
    sourceRoot: failing.sourceRoot,
    findingIds: [missingId],
    apply: true,
    yes: true,
    label: 'Save settings',
    verifyCommand: 'node -e "process.exit(7)"'
  });

  assert.equal(passResult.items[0].status, 'verify-passed');
  assert.equal(passResult.session.verification.exitCode, 0);
  assert.equal(failResult.items[0].status, 'verify-failed');
  assert.equal(failResult.session.verification.exitCode, 7);
});

/**
 * Creates a temp workspace with copied evidence, generated findings, and source fixtures.
 * @returns {Promise<{root:string,bundle:string,sourceRoot:string}>} Fixture paths.
 */
async function fixtureWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-fix-'));
  const bundle = 'problem';
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), path.join(root, bundle), { recursive: true });
  await collectCritique({ root, bundlePath: bundle });
  patchFindingIdentifiers(path.join(root, bundle, 'findings.json'));
  const sourceRoot = copySource(root, 'simple-swiftui');
  return { root, bundle, sourceRoot };
}

/**
 * Copies a source fixture into a temp workspace.
 * @param {string} root Workspace root.
 * @param {string} name Fixture source name.
 * @returns {string} Copied source root.
 */
function copySource(root, name) {
  const sourceRoot = path.join(root, 'source');
  fs.rmSync(sourceRoot, { recursive: true, force: true });
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/source', name), sourceRoot, { recursive: true });
  return sourceRoot;
}

/**
 * Adds stable identifiers to copied critique findings so source mapping can be tested.
 * @param {string} findingsPath Path to copied findings.json.
 * @returns {void}
 */
function patchFindingIdentifiers(findingsPath) {
  const payload = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  const findings = Array.isArray(payload) ? payload : payload.findings;
  for (const finding of findings) {
    if (finding.id === missingId) finding.evidence.node.identifier = 'settings.saveButton';
    if (finding.id === genericId) finding.evidence.node.identifier = 'settings.genericButton';
    if (finding.id === touchId) finding.evidence.node.identifier = 'settings.smallButton';
  }
  if (Array.isArray(payload)) fs.writeFileSync(findingsPath, `${JSON.stringify(findings, null, 2)}\n`);
  else fs.writeFileSync(findingsPath, `${JSON.stringify({ ...payload, findings }, null, 2)}\n`);
}

/**
 * Reads the primary Swift fixture.
 * @param {string} sourceRoot Source root.
 * @returns {string} Source content.
 */
function readSettings(sourceRoot) {
  return fs.readFileSync(path.join(sourceRoot, 'SettingsView.swift'), 'utf8');
}

/**
 * Reads every file in a source tree for edit comparisons.
 * @param {string} sourceRoot Source root.
 * @returns {string} Combined source content.
 */
function readTree(sourceRoot) {
  return fs.readdirSync(sourceRoot).sort().map((file) => fs.readFileSync(path.join(sourceRoot, file), 'utf8')).join('\n---\n');
}

/**
 * Counts exact substring matches.
 * @param {string} source Source text.
 * @param {string} needle Text to find.
 * @returns {number} Match count.
 */
function count(source, needle) {
  return source.split(needle).length - 1;
}
