import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(repoRoot, 'bin/screenslop.mjs');

test('critique --design reports a profile gap when the design profile is missing', () => {
  const root = createProjectWithBundle('clean');
  const result = runScreenslop(root, ['critique', 'artifacts/clean', '--design', '--json']);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.design.enabled, true);
  assert.equal(payload.design.profileStatus, 'missing-profile');
  assert.equal(payload.design.localFindings, 1);
  assert.ok(payload.findings.some((finding) => finding.kind === 'profile-gap'));
  assert.ok(payload.findings.some((finding) => finding.proofLevel === 'profile-informed'));
});

test('critique --design --agent-packet writes a packet with profile and evidence summaries', () => {
  const root = createProjectWithBundle('problem');
  assert.equal(runScreenslop(root, ['learn', '--write', '--yes', '--json']).status, 0);

  const result = runScreenslop(root, ['critique', 'artifacts/problem', '--design', '--agent-packet', '--json']);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.design.profileStatus, 'current');
  assert.equal(payload.design.localFindings, 0);
  assert.match(payload.artifacts.designPacketPath, /design-review-packet\.json$/);
  assert.match(payload.artifacts.designPromptPath, /design-review-prompt\.md$/);

  const packet = JSON.parse(fs.readFileSync(path.join(root, payload.artifacts.designPacketPath), 'utf8'));
  assert.equal(packet.kind, 'design-review-packet');
  assert.equal(packet.profile.project.name, path.basename(root));
  assert.equal(packet.accessibilitySummary.available, true);
  assert.ok(packet.accessibilitySummary.nodeCount > 0);
  assert.equal(packet.outputSchema.findingKind.includes('product-logic'), true);
});

test('critique imports agent-produced design findings without calling them measured', () => {
  const root = createProjectWithBundle('clean');
  fs.writeFileSync(path.join(root, 'design-findings.json'), `${JSON.stringify({
    findings: [
      {
        kind: 'product-logic',
        proofLevel: 'agent-judgment',
        severity: 'P2',
        pillar: 'slop',
        title: 'Badge contradicts visible state',
        detail: 'The badge says complete while the screen still asks for setup.',
        judgment: 'Visible copy and state do not agree.',
        suggestedFix: 'Change the badge copy or the state shown on the screen.',
        alternatives: ['Use Pending', 'Hide the badge until setup finishes']
      }
    ]
  }, null, 2)}\n`);

  const result = runScreenslop(root, [
    'critique',
    'artifacts/clean',
    '--import-design-findings',
    'design-findings.json',
    '--json'
  ]);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const payload = JSON.parse(result.stdout);
  const imported = payload.findings.find((finding) => finding.kind === 'product-logic');

  assert.equal(payload.design.importedFindings, 1);
  assert.equal(imported.proofLevel, 'agent-judgment');
  assert.equal(imported.requiresHumanReview, true);
  assert.notEqual(imported.proofLevel, 'measured');
  assert.deepEqual(imported.alternatives, ['Use Pending', 'Hide the badge until setup finishes']);
});

/**
 * Runs Screenslop in a temp project.
 * @param {string} cwd Working directory.
 * @param {string[]} args CLI args.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Spawn result.
 */
function runScreenslop(cwd, args) {
  return spawnSync(process.execPath, [cliPath, ...args], { cwd, encoding: 'utf8' });
}

/**
 * Creates a small app-like project and copies an evidence fixture under artifacts/.
 * @param {string} fixtureName Fixture name.
 * @returns {string} Temp project root.
 */
function createProjectWithBundle(fixtureName) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-design-review-'));
  fs.mkdirSync(path.join(root, 'Sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Sources', 'SettingsView.swift'), 'import SwiftUI\nstruct SettingsView: View { var body: some View { Text("Settings") } }\n');
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# Design\n\nClear hierarchy and honest status copy.\n');
  copyDir(path.join(repoRoot, 'tests', 'fixtures', 'evidence', fixtureName), path.join(root, 'artifacts', fixtureName));
  rewriteManifestArtifacts(path.join(root, 'artifacts', fixtureName, 'evidence.json'), fixtureName);
  return root;
}

/**
 * Copies a fixture directory.
 * @param {string} from Source directory.
 * @param {string} to Destination directory.
 * @returns {void}
 */
function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, dest);
    else fs.copyFileSync(source, dest);
  }
}

/**
 * Rewrites fixture artifact paths for the temp project.
 * @param {string} manifestPath Manifest path.
 * @param {string} fixtureName Fixture name.
 * @returns {void}
 */
function rewriteManifestArtifacts(manifestPath, fixtureName) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.artifacts = Object.fromEntries(Object.entries(manifest.artifacts).map(([key, value]) => [
    key,
    value ? `artifacts/${fixtureName}/${path.basename(value)}` : value
  ]));
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
