import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(repoRoot, 'bin/screenslop.mjs');

test('screenslop learn --dry-run plans a private design profile without writing', () => {
  const root = createSwiftUiProject();
  const result = runLearn(root, ['--json', '--dry-run', '--surface', 'Settings']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'learn');
  assert.equal(payload.action, 'plan');
  assert.equal(payload.wrote, false);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.profile, undefined);
  assert.equal(payload.profileSummary.schemaVersion, 1);
  assert.equal(payload.profileSummary.freshnessStatus, 'current');
  assert.equal(payload.profileSummary.sourceCount >= 2, true);
  assert.equal(payload.pathDisplayMode, 'redacted');
  assert.match(payload.profilePath, /^<repo>\/\.screenslop\/design-profile\.json$/);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'design-profile.json')), false);
});

test('screenslop learn refuses JSON writes without explicit confirmation', () => {
  const root = createSwiftUiProject();
  const result = runLearn(root, ['--json', '--write']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'requires-write-confirmation');
  assert.equal(payload.wrote, false);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'design-profile.json')), false);
});

test('screenslop learn writes and checks the current profile', () => {
  const root = createSwiftUiProject();
  const write = runLearn(root, ['--json', '--write', '--yes']);

  assert.equal(write.status, 0, write.stderr || write.stdout);
  const written = JSON.parse(write.stdout);
  assert.equal(written.ok, true);
  assert.equal(written.status, 'written');
  assert.equal(written.wrote, true);

  const file = path.join(root, '.screenslop', 'design-profile.json');
  assert.equal(fs.existsSync(file), true);
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(profile.schemaVersion, 1);
  assert.ok(profile.sources.some((source) => source.path === 'Sources/SettingsView.swift'));
  assert.ok(profile.components.some((component) => component.name === 'SettingsView'));

  const check = runLearn(root, ['--json', '--check']);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const checked = JSON.parse(check.stdout);
  assert.equal(checked.ok, true);
  assert.equal(checked.status, 'current');
  assert.deepEqual(checked.next, []);
});

test('screenslop learn detects stale profiles and refreshes while preserving user rules', () => {
  const root = createSwiftUiProject();
  assert.equal(runLearn(root, ['--json', '--write', '--yes']).status, 0);

  const file = path.join(root, '.screenslop', 'design-profile.json');
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  profile.reviewRules.unshift({
    id: 'custom.brand.voice',
    pillar: 'slop',
    severity: 'P3',
    description: 'Keep the project voice direct and calm.'
  });
  fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);

  fs.appendFileSync(path.join(root, 'Sources', 'SettingsView.swift'), '\nstruct HelpView: View { var body: some View { Text("Help") } }\n');

  const stale = runLearn(root, ['--json', '--check']);
  assert.equal(stale.status, 1);
  const stalePayload = JSON.parse(stale.stdout);
  assert.equal(stalePayload.status, 'stale');
  assert.deepEqual(stalePayload.next, ['screenslop learn --refresh --json --dry-run']);

  const dryRefresh = runLearn(root, ['--json', '--refresh', '--dry-run']);
  assert.equal(dryRefresh.status, 0, dryRefresh.stderr || dryRefresh.stdout);
  const dryPayload = JSON.parse(dryRefresh.stdout);
  assert.equal(dryPayload.action, 'refresh');
  assert.equal(dryPayload.wrote, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).freshness.sourceHash, profile.freshness.sourceHash);

  const refresh = runLearn(root, ['--json', '--refresh', '--write', '--yes']);
  assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout);
  const refreshed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.notEqual(refreshed.freshness.sourceHash, profile.freshness.sourceHash);
  assert.ok(refreshed.reviewRules.some((rule) => rule.id === 'custom.brand.voice'));
  assert.ok(refreshed.components.some((component) => component.name === 'HelpView'));
});

test('screenslop learn rejects profile paths through symlink ancestors', () => {
  const root = createSwiftUiProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-profile-outside-'));
  fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'dir');

  const result = runLearn(root, ['--json', '--dry-run', '--profile', 'linked-outside/design-profile.json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.error, /symlinks|project root/);
});

test('screenslop learn refuses invalid existing config instead of falling back', () => {
  const root = createSwiftUiProject();
  fs.mkdirSync(path.join(root, '.screenslop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    schemaVersion: 1,
    runtimePreference: ['baguette'],
    preferredRuntime: 'baguette',
    defaultSurface: 'Settings',
    defaultScheme: 'App',
    defaultBundleId: 'dev.example.App',
    sourceRoot: '../outside'
  }, null, 2)}\n`);

  const result = runLearn(root, ['--json', '--dry-run']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'config-invalid');
  assert.equal(payload.profile, undefined);
});

/**
 * Runs the learn command inside a temp project.
 * @param {string} cwd Working directory.
 * @param {string[]} args CLI args after `learn`.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} CLI result.
 */
function runLearn(cwd, args) {
  return spawnSync(process.execPath, [cliPath, 'learn', ...args], { cwd, encoding: 'utf8' });
}

/**
 * Creates a tiny SwiftUI-like project fixture.
 * @returns {string} Temp project root.
 */
function createSwiftUiProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-learn-'));
  fs.mkdirSync(path.join(root, 'Sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Sources', 'SettingsView.swift'), `
import SwiftUI

struct SettingsView: View {
  var body: some View {
    VStack { Text("Settings") }
  }
}
`);
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# Design\n\nClear, calm, practical.\n');
  return root;
}
