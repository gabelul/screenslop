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
import { chooseSetupDefaults, detectAppleProject } from '../src/config/project-detection.mjs';

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

test('detectAppleProject chooses a single app project without shelling out', () => {
  const root = makeXcodeFixture({ name: 'PetPacket', bundleIds: ['com.booplex.petpacket'] });
  const detection = detectAppleProject(root);
  const choice = chooseSetupDefaults(detection, { surface: 'Onboarding' });

  assert.equal(detection.status, 'single-match');
  assert.deepEqual(detection.projects, ['PetPacket.xcodeproj']);
  assert.deepEqual(detection.schemes, ['PetPacket']);
  assert.deepEqual(detection.bundleIds, ['com.booplex.petpacket']);
  assert.deepEqual(detection.sourceRoots, ['PetPacket']);
  assert.equal(choice.ok, true);
  assert.equal(choice.values.project, 'PetPacket.xcodeproj');
  assert.equal(choice.values.scheme, 'PetPacket');
  assert.equal(choice.values['bundle-id'], 'com.booplex.petpacket');
  assert.equal(choice.values['source-root'], 'PetPacket');
});

test('screenslop setup --json --dry-run detects project config without writing', () => {
  const root = makeXcodeFixture({ name: 'PetPacket', bundleIds: ['com.booplex.petpacket'] });
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'setup',
    '--json',
    '--dry-run',
    '--surface',
    'Onboarding'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'setup');
  assert.equal(payload.status, 'ready');
  assert.equal(payload.wrote, false);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.pathDisplayMode, 'redacted');
  assert.equal(result.stdout.includes('PetPacket'), false);
  assert.equal(result.stdout.includes('com.booplex.petpacket'), false);
  assert.equal(payload.config.defaultScheme, '<scheme>');
  assert.equal(payload.config.defaultBundleId, '<bundle-id>');
  assert.equal(payload.config.defaultSurface, '<surface>');
  assert.equal(payload.config.projectPath, '<project>');
  assert.equal(payload.config.sourceRoot, '<source-root>');
  assert.equal(payload.values['bundle-id'], '<bundle-id>');
  assert.equal(payload.values.scheme, '<scheme>');
  assert.equal(payload.values.project, '<project>');
  assert.equal(payload.values['source-root'], '<source-root>');
  assert.equal(payload.values.surface, '<surface>');
  assert.match(payload.next.join('\n'), /screenslop doctor/);
  assert.match(payload.next.join('\n'), /screenslop see --surface <surface> --boot --json/);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'config.json')), false);
});

test('screenslop setup --json --yes writes a private project config', () => {
  const root = makeXcodeFixture({ name: 'PetPacket', bundleIds: ['com.booplex.petpacket'] });
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'setup',
    '--json',
    '--yes',
    '--surface',
    'Onboarding'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.wrote, true);
  const configPath = path.join(root, '.screenslop', 'config.json');
  const config = readProjectConfig(root).config;
  assert.equal(config.schemaVersion, 1);
  assert.equal(config.projectPath, 'PetPacket.xcodeproj');
  assert.equal(config.defaultScheme, 'PetPacket');
  assert.equal(config.defaultBundleId, 'com.booplex.petpacket');
  assert.equal(config.defaultSurface, 'Onboarding');
  assert.equal(config.sourceRoot, 'PetPacket');
  if (process.platform !== 'win32') {
    assert.equal((fs.statSync(configPath).mode & 0o777), 0o600);
  }
});

test('screenslop setup refuses ambiguous app targets without explicit flags', () => {
  const root = makeXcodeFixture({ name: 'PetPacket', bundleIds: ['com.booplex.petpacket', 'com.booplex.reader'] });
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'setup',
    '--json',
    '--dry-run'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.command, 'setup');
  assert.equal(payload.status, 'needs-selection');
  assert.deepEqual(payload.ambiguous['bundle-id'], ['<bundle-id>', '<bundle-id>']);
  assert.match(payload.next.join('\n'), /--bundle-id <bundle-id>/);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'config.json')), false);
});

test('screenslop setup refuses ambiguous project and workspace containers', () => {
  const root = makeXcodeFixture({
    name: 'PetPacket',
    bundleIds: ['com.booplex.petpacket'],
    workspace: true
  });
  const result = spawnSync('node', [
    path.join(repoRoot, 'bin/screenslop.mjs'),
    'setup',
    '--json',
    '--dry-run'
  ], { cwd: root, encoding: 'utf8' });

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'needs-selection');
  assert.equal(result.stdout.includes('PetPacket'), false);
  assert.deepEqual(payload.ambiguous['workspace-or-project'], ['<project-or-workspace>', '<project-or-workspace>']);
  assert.match(payload.next.join('\n'), /--workspace <App\.xcworkspace>/);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'config.json')), false);
});

test('detectAppleProject does not misclassify app names ending in test', () => {
  const root = makeXcodeFixture({ name: 'Contest', bundleIds: ['com.example.contest'] });
  const detection = detectAppleProject(root);
  const choice = chooseSetupDefaults(detection, { surface: 'Overview' });

  assert.equal(detection.status, 'single-match');
  assert.deepEqual(detection.projects, ['Contest.xcodeproj']);
  assert.deepEqual(detection.schemes, ['Contest']);
  assert.deepEqual(detection.bundleIds, ['com.example.contest']);
  assert.deepEqual(detection.sourceRoots, ['Contest']);
  assert.equal(choice.ok, true);
});

/**
 * Creates a minimal Xcode project fixture for setup tests.
 *
 * @param {object} options Fixture options.
 * @param {string} options.name App/project name.
 * @param {string[]} options.bundleIds Bundle identifiers to emit.
 * @param {boolean} [options.workspace=false] Whether to add a workspace bundle.
 * @returns {string} Fixture root.
 */
function makeXcodeFixture(options) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-setup-fixture-'));
  const projectDir = path.join(root, `${options.name}.xcodeproj`);
  const schemeDir = path.join(projectDir, 'xcshareddata', 'xcschemes');
  fs.mkdirSync(schemeDir, { recursive: true });
  fs.mkdirSync(path.join(root, options.name), { recursive: true });
  if (options.workspace) {
    const workspaceSchemeDir = path.join(root, `${options.name}.xcworkspace`, 'xcshareddata', 'xcschemes');
    fs.mkdirSync(workspaceSchemeDir, { recursive: true });
    fs.writeFileSync(path.join(workspaceSchemeDir, `${options.name}.xcscheme`), '<Scheme></Scheme>\n');
  }
  fs.writeFileSync(path.join(schemeDir, `${options.name}.xcscheme`), '<Scheme></Scheme>\n');
  fs.writeFileSync(path.join(projectDir, 'project.pbxproj'), `${options.bundleIds.map((bundleId, index) => `
/* target ${index} */
PRODUCT_BUNDLE_IDENTIFIER = ${bundleId};
`).join('\n')}
PRODUCT_BUNDLE_IDENTIFIER = ${options.bundleIds[0]}Tests;
`);
  return root;
}
