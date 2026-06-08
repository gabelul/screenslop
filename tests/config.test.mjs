import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONFIG_SCHEMA_VERSION,
  createDefaultConfig,
  migrateProjectConfig,
  planInitConfig,
  readProjectConfig,
  resolveTargetConfig,
  validateProjectConfig,
  writeProjectConfig
} from '../src/config/project-config.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..');

test('createDefaultConfig writes schemaVersion 1 and preserves sourceHints as metadata', () => {
  const config = createDefaultConfig({
    detected: { preferred: 'baguette' },
    values: {
      scheme: 'Demo',
      'bundle-id': 'dev.example.Demo',
      'source-root': 'Sources',
      'source-hint': 'SettingsView.swift,HomeView.swift'
    }
  });

  assert.equal(config.schemaVersion, CONFIG_SCHEMA_VERSION);
  assert.equal(config.preferredRuntime, 'baguette');
  assert.equal(config.defaultScheme, 'Demo');
  assert.equal(config.defaultBundleId, 'dev.example.Demo');
  assert.equal(config.sourceRoot, 'Sources');
  assert.deepEqual(config.sourceHints, ['SettingsView.swift', 'HomeView.swift']);
});

test('migrateProjectConfig maps the current shipped config shape', () => {
  const defaults = createDefaultConfig({ detected: { preferred: 'manual' } });
  const migration = migrateProjectConfig({
    runtimePreference: ['baguette', 'manual'],
    preferredRuntime: 'baguette',
    defaultSurface: 'Settings',
    defaultScheme: 'Demo',
    defaultBundleId: 'dev.example.Demo',
    artifactsDir: 'screenslop-artifacts',
    sourceHints: ['SettingsView.swift']
  }, { defaults });

  assert.equal(migration.changed, true);
  assert.equal(migration.config.schemaVersion, 1);
  assert.equal(migration.config.artifactsDir, 'screenslop-artifacts');
  assert.deepEqual(migration.config.sourceHints, ['SettingsView.swift']);
  assert.equal(migration.config.sourceRoot, null);
});

test('validateProjectConfig rejects unsafe configured paths and source/artifact overlap', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-config-paths-'));
  const safe = createDefaultConfig({ detected: { preferred: 'manual' } });

  assert.equal(validateProjectConfig(safe, { root }).ok, true);

  const outsideSource = { ...safe, sourceRoot: '../private-app' };
  assert.match(validateProjectConfig(outsideSource, { root }).errors.join('\n'), /sourceRoot must resolve inside/);

  const outsideArtifacts = { ...safe, artifactsDir: '../screenslop-artifacts' };
  assert.match(validateProjectConfig(outsideArtifacts, { root }).errors.join('\n'), /artifactsDir must resolve inside/);

  const blockedSource = { ...safe, sourceRoot: '.git/hooks' };
  assert.match(validateProjectConfig(blockedSource, { root }).errors.join('\n'), /blocked folders/);

  const overlap = { ...safe, sourceRoot: 'App', artifactsDir: 'App/screenslop-artifacts' };
  assert.match(validateProjectConfig(overlap, { root }).errors.join('\n'), /must not overlap/);
});

test('validateProjectConfig rejects symlink escapes for source and artifacts', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-config-symlink-paths-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-outside-'));
  fs.symlinkSync(outside, path.join(root, 'Sources'));
  fs.symlinkSync(outside, path.join(root, 'linked-artifacts'));
  const safe = createDefaultConfig({ detected: { preferred: 'manual' } });

  const source = { ...safe, sourceRoot: 'Sources' };
  assert.match(validateProjectConfig(source, { root }).errors.join('\n'), /sourceRoot must resolve inside/);

  const artifacts = { ...safe, artifactsDir: 'linked-artifacts' };
  assert.match(validateProjectConfig(artifacts, { root }).errors.join('\n'), /artifactsDir must resolve inside/);
});

test('resolveTargetConfig returns normalized target metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-config-resolve-'));
  const config = {
    ...createDefaultConfig({ detected: { preferred: 'baguette' } }),
    workspacePath: 'Demo.xcworkspace',
    defaultScheme: 'Demo',
    defaultBundleId: 'dev.example.Demo',
    defaultDevice: 'iPhone 17',
    sourceRoot: 'Sources',
    artifactsDir: 'screenslop-artifacts'
  };

  const target = resolveTargetConfig(config, { root });
  const canonicalRoot = fs.realpathSync.native(root);

  assert.equal(target.workspacePath, path.join(canonicalRoot, 'Demo.xcworkspace'));
  assert.equal(target.projectPath, null);
  assert.equal(target.scheme, 'Demo');
  assert.equal(target.bundleId, 'dev.example.Demo');
  assert.equal(target.device, 'iPhone 17');
  assert.equal(target.sourceRoot, path.join(canonicalRoot, 'Sources'));
  assert.equal(target.artifactsDir, path.join(canonicalRoot, 'screenslop-artifacts'));
});

test('writeProjectConfig refuses symlinked config files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-config-symlink-'));
  fs.mkdirSync(path.join(root, '.screenslop'));
  fs.symlinkSync(path.join(root, 'outside.json'), path.join(root, '.screenslop', 'config.json'));

  assert.throws(() => writeProjectConfig(root, createDefaultConfig()), /must not be a symlink/);
});

test('screenslop init --json --dry-run prints schemaVersion 1 without writing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-init-dry-'));
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'init',
    '--json',
    '--dry-run',
    '--scheme',
    'Demo',
    '--bundle-id',
    'dev.example.Demo',
    '--source-root',
    'Sources',
    '--artifacts-dir',
    'screenslop-artifacts'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.action, 'create');
  assert.equal(payload.wrote, false);
  assert.equal(payload.schemaVersion, 1);
  assert.equal(payload.config.defaultScheme, 'Demo');
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'config.json')), false);
});

test('screenslop init requires explicit migrate flag for existing legacy config in JSON mode', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-init-migrate-refuse-'));
  fs.mkdirSync(path.join(root, '.screenslop'));
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    runtimePreference: ['baguette', 'manual'],
    preferredRuntime: 'baguette',
    defaultSurface: null,
    defaultScheme: 'Demo',
    defaultBundleId: 'dev.example.Demo',
    artifactsDir: 'artifacts',
    sourceHints: []
  }, null, 2)}\n`);

  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'init', '--json'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.action, 'migrate');
  assert.equal(payload.status, 'requires-migration-confirmation');
  assert.equal(payload.wrote, false);
  assert.equal(readProjectConfig(root).config.schemaVersion, undefined);
});

test('screenslop init --json --migrate --yes rewrites legacy config safely', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-init-migrate-write-'));
  fs.mkdirSync(path.join(root, '.screenslop'));
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    runtimePreference: ['baguette', 'manual'],
    preferredRuntime: 'baguette',
    defaultSurface: 'Settings',
    defaultScheme: 'Demo',
    defaultBundleId: 'dev.example.Demo',
    artifactsDir: 'screenslop-artifacts',
    sourceHints: ['SettingsView.swift']
  }, null, 2)}\n`);

  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'init',
    '--json',
    '--migrate',
    '--yes'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.action, 'migrate');
  assert.equal(payload.wrote, true);
  const config = readProjectConfig(root).config;
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.defaultScheme, 'Demo');
  assert.deepEqual(config.sourceHints, ['SettingsView.swift']);
});

test('planInitConfig treats reordered valid v1 config as already current', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-init-existing-v1-'));
  fs.mkdirSync(path.join(root, '.screenslop'));
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    sourceHints: [],
    artifactsDir: 'artifacts',
    sourceRoot: null,
    projectPath: null,
    workspacePath: null,
    defaultDevice: null,
    defaultBundleId: null,
    defaultScheme: null,
    defaultSurface: null,
    preferredRuntime: 'manual',
    runtimePreference: ['baguette', 'xcodebuildmcp', 'simctl', 'manual'],
    schemaVersion: 1
  }, null, 2)}\n`);

  const plan = planInitConfig({ root, detected: { preferred: 'manual' } });
  assert.equal(plan.action, 'exists');
});

test('screenslop init -h prints help without writing config', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-init-help-'));
  const result = spawnSync('node', [path.join(repoRoot, 'bin/screenslop.mjs'), 'init', '-h'], {
    cwd: root,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /Screenslop init/);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'config.json')), false);
});

test('screenslop init JSON redacts private absolute path values', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-init-redact-'));
  const privatePath = path.join(os.homedir(), 'PrivateApp');
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'init',
    '--json',
    '--dry-run',
    '--source-root',
    privatePath,
    '--bundle-id',
    'com.private.Secret'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  assert.equal(result.stdout.includes(privatePath), false);
  assert.equal(result.stdout.includes('com.private.Secret'), false);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.pathDisplayMode, 'redacted');
  assert.equal(payload.config.sourceRoot, '<home>/PrivateApp');
  assert.equal(payload.config.defaultBundleId, '<bundle-id>');
});

test('screenslop fix --apply refuses to use repo root as implicit source root', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-fix-source-root-'));
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'fix',
    path.join(repoRoot, 'tests/fixtures/evidence/problem'),
    '--finding',
    'any-finding',
    '--apply',
    '--yes',
    '--json'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.match(payload.error, /requires --source-root/);
});
