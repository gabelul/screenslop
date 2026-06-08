import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectCritique } from '../src/critique/collect-critique.mjs';
import { collectVerify } from '../src/verify/collect-verify.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');
const missingId = 'ax-missing-name-a21707c7';
const touchId = 'layout-touch-target-81b024fb';

test('screenslop verify --json compares temp bundles and writes artifacts', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();
  setFindingIdentifier(path.join(root, baseline, 'findings.json'), missingId, 'settings.saveButton');
  setFindingIdentifier(path.join(root, fresh, 'findings.json'), missingId, 'settings.saveButton');

  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'verify',
    baseline,
    '--fresh-bundle',
    fresh,
    '--finding',
    missingId,
    '--json'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.command, 'verify');
  assert.equal(payload.items[0].status, 'still-present');
  assert.equal(fs.existsSync(path.join(root, baseline, 'verification.json')), true);
  assert.equal(fs.existsSync(path.join(root, baseline, 'verification.md')), true);
});

test('missing fresh bundle fails with JSON error', async () => {
  const { root, baseline } = await verifyWorkspace();
  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'verify', baseline, '--json'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /fresh-bundle/);
});

test('missing baseline findings fails with JSON error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-verify-missing-baseline-'));
  const baseline = path.join(root, 'baseline');
  const fresh = path.join(root, 'fresh');
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), baseline, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), fresh, { recursive: true });
  purgeGeneratedArtifacts(baseline);
  purgeGeneratedArtifacts(fresh);

  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'verify', baseline, '--fresh-bundle', fresh, '--json'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.error, /Baseline findings file not found/);
});

test('fresh bundle without findings is critiqued before comparison', async () => {
  const { root, baseline, fresh } = await verifyWorkspace({ freshCritique: false });
  assert.equal(fs.existsSync(path.join(root, fresh, 'findings.json')), false);

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [missingId] });

  assert.equal(result.freshCritiqueRefreshed, true);
  assert.equal(fs.existsSync(path.join(root, fresh, 'findings.json')), true);
});

test('identifier match returns still-present', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();
  setFindingIdentifier(path.join(root, baseline, 'findings.json'), missingId, 'settings.saveButton');
  setFindingIdentifier(path.join(root, fresh, 'findings.json'), missingId, 'settings.saveButton');

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [missingId] });

  assert.equal(result.items[0].status, 'still-present');
  assert.match(result.items[0].matchKey, /settings.saveButton/);
});

test('missing strong fresh match returns verified-fixed', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();
  setFindingIdentifier(path.join(root, baseline, 'findings.json'), missingId, 'settings.saveButton');
  removeFinding(path.join(root, fresh, 'findings.json'), missingId);

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [missingId] });

  assert.equal(result.items[0].status, 'verified-fixed');
});

test('same rule with different identifier returns changed', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();
  setFindingIdentifier(path.join(root, baseline, 'findings.json'), missingId, 'settings.saveButton');
  setFindingIdentifier(path.join(root, fresh, 'findings.json'), missingId, 'settings.otherButton');

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [missingId] });

  assert.equal(result.items[0].status, 'changed');
});

test('weak baseline evidence returns unknown when related fresh rule remains', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();
  clearStrongEvidence(path.join(root, baseline, 'findings.json'), touchId);

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [touchId] });

  assert.equal(result.items[0].status, 'unknown');
});

test('evidence quality disappearance returns verified-fixed', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-verify-evidence-'));
  const baseline = 'baseline';
  const fresh = 'fresh';
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/missing-ax'), path.join(root, baseline), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/clean'), path.join(root, fresh), { recursive: true });
  await collectCritique({ root, bundlePath: baseline });
  await collectCritique({ root, bundlePath: fresh });
  const id = firstFindingByRule(path.join(root, baseline, 'findings.json'), 'evidence.missing-ax-tree').id;

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [id] });

  assert.equal(result.items[0].status, 'verified-fixed');
});

test('selected missing baseline ID returns missing-baseline', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: ['missing-id'] });

  assert.equal(result.items[0].status, 'missing-baseline');
});


test('fix-session context is attached when present', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();
  setFindingIdentifier(path.join(root, baseline, 'findings.json'), missingId, 'settings.saveButton');
  setFindingIdentifier(path.join(root, fresh, 'findings.json'), missingId, 'settings.saveButton');
  fs.writeFileSync(path.join(root, baseline, 'fix-session.json'), `${JSON.stringify({
    bundle: baseline,
    createdAt: '2026-06-08T00:00:00.000Z',
    appliedPatches: [{ findingId: missingId, file: 'SettingsView.swift', line: 9 }],
    verification: { status: 'verify-passed' }
  }, null, 2)}\n`);

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [missingId] });

  assert.equal(result.fixSessionPath, path.join(baseline, 'fix-session.json'));
  assert.equal(result.items[0].fixSessionItem.status, 'verify-passed');
  assert.equal(result.items[0].fixSessionItem.file, 'SettingsView.swift');
});

test('bare-array findings payload is accepted', async () => {
  const { root, baseline, fresh } = await verifyWorkspace();
  for (const bundle of [baseline, fresh]) {
    const file = path.join(root, bundle, 'findings.json');
    const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify(payload.findings, null, 2)}\n`);
  }

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [missingId] });

  assert.equal(result.ok, true);
});

test('external bundle paths remain absolute in JSON artifacts', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-verify-external-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-verify-external-bundles-'));
  const baseline = path.join(outside, 'baseline');
  const fresh = path.join(outside, 'fresh');
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), baseline, { recursive: true });
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), fresh, { recursive: true });
  await collectCritique({ root, bundlePath: baseline });
  await collectCritique({ root, bundlePath: fresh });

  const result = await collectVerify({ root, baselineBundle: baseline, freshBundle: fresh, findingIds: [missingId] });

  assert.equal(path.isAbsolute(result.baselineBundle), true);
  assert.equal(path.isAbsolute(result.artifacts.verificationPath), true);
});

/**
 * Creates temp baseline/fresh bundles with baseline critique artifacts.
 * @param {object} [options] Fixture options.
 * @param {boolean} [options.freshCritique] Whether to create fresh findings.
 * @returns {Promise<{root:string,baseline:string,fresh:string}>} Workspace paths.
 */
async function verifyWorkspace(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-verify-'));
  const baseline = 'baseline';
  const fresh = 'fresh';
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), path.join(root, baseline), { recursive: true });
  fs.cpSync(path.join(repoRoot, 'tests/fixtures/evidence/problem'), path.join(root, fresh), { recursive: true });
  purgeGeneratedArtifacts(path.join(root, baseline));
  purgeGeneratedArtifacts(path.join(root, fresh));
  await collectCritique({ root, bundlePath: baseline });
  if (options.freshCritique !== false) await collectCritique({ root, bundlePath: fresh });
  return { root, baseline, fresh };
}

/**
 * Updates a copied finding with an AX identifier.
 * @param {string} file Findings file.
 * @param {string} findingId Finding ID.
 * @param {string} identifier Identifier value.
 * @returns {void}
 */
function setFindingIdentifier(file, findingId, identifier) {
  mutateFindings(file, (findings) => {
    const finding = findings.find((item) => item.id === findingId);
    assert.ok(finding, `missing finding ${findingId}`);
    finding.evidence.node = { ...(finding.evidence.node || {}), identifier };
  });
}

/**
 * Clears stable evidence keys from a copied finding.
 * @param {string} file Findings file.
 * @param {string} findingId Finding ID.
 * @returns {void}
 */
function clearStrongEvidence(file, findingId) {
  mutateFindings(file, (findings) => {
    const finding = findings.find((item) => item.id === findingId);
    assert.ok(finding, `missing finding ${findingId}`);
    if (finding.evidence.node) delete finding.evidence.node.identifier;
    delete finding.evidence.sourceHint;
    delete finding.evidence.line;
    delete finding.evidence.snippet;
  });
}

/**
 * Removes a finding from a copied findings file.
 * @param {string} file Findings file.
 * @param {string} findingId Finding ID.
 * @returns {void}
 */
function removeFinding(file, findingId) {
  mutateFindings(file, (findings) => {
    const index = findings.findIndex((item) => item.id === findingId);
    if (index >= 0) findings.splice(index, 1);
  });
}

/**
 * Returns first finding by rule ID.
 * @param {string} file Findings file.
 * @param {string} ruleId Rule ID.
 * @returns {object} Finding.
 */
function firstFindingByRule(file, ruleId) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const findings = Array.isArray(payload) ? payload : payload.findings;
  return findings.find((finding) => finding.ruleId === ruleId);
}

/**
 * Mutates a copied findings file while preserving payload shape.
 * @param {string} file Findings file.
 * @param {(findings:object[]) => void} callback Mutation callback.
 * @returns {void}
 */
function mutateFindings(file, callback) {
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const findings = Array.isArray(payload) ? payload : payload.findings;
  callback(findings);
  const nextPayload = Array.isArray(payload) ? findings : { ...payload, findings };
  fs.writeFileSync(file, `${JSON.stringify(nextPayload, null, 2)}\n`);
}

/**
 * Removes derived reports from copied fixture bundles before tests run.
 * @param {string} bundle Copied bundle directory.
 * @returns {void}
 */
function purgeGeneratedArtifacts(bundle) {
  for (const file of ['findings.json', 'critique.md', 'fix-plan.json', 'fix.md', 'fix-session.json', 'verification.json', 'verification.md']) {
    const artifact = path.join(bundle, file);
    if (fs.existsSync(artifact)) fs.rmSync(artifact);
  }
}
