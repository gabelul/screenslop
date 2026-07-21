import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(repoRoot, 'bin/screenslop.mjs');
const fixtureBundle = path.join(repoRoot, 'tests/fixtures/evidence/problem');

/**
 * Copies the problem fixture into an isolated project root so profile
 * presence/absence can be controlled without touching repo state.
 * @param {boolean} withProfile Whether to plant a design profile.
 * @returns {{root:string, bundle:string}} Temp project paths.
 */
function createProjectRoot(withProfile) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-nudge-'));
  const bundle = path.join(root, 'bundle');
  fs.cpSync(fixtureBundle, bundle, { recursive: true });
  fs.rmSync(path.join(bundle, 'trend.json'), { force: true });
  if (withProfile) {
    fs.mkdirSync(path.join(root, '.screenslop'), { recursive: true });
    fs.writeFileSync(path.join(root, '.screenslop/design-profile.json'), JSON.stringify({ schemaVersion: 1 }));
  }
  return { root, bundle };
}

test('critique JSON reports a missing design profile with learn next steps', () => {
  const { root, bundle } = createProjectRoot(false);
  try {
    const result = spawnSync('node', [cli, 'critique', bundle, '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.designProfile.status, 'missing');
    assert.ok(payload.designProfile.next.some((command) => command.includes('screenslop learn')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('critique human output nudges toward learn when the profile is missing', () => {
  const { root, bundle } = createProjectRoot(false);
  try {
    const result = spawnSync('node', [cli, 'critique', bundle], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /No design profile yet/);
    assert.match(result.stdout, /screenslop learn --json --dry-run/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('critique stays quiet about learn when a profile exists', () => {
  const { root, bundle } = createProjectRoot(true);
  try {
    const result = spawnSync('node', [cli, 'critique', bundle, '--json'], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.designProfile.status, 'present');
    assert.equal(payload.designProfile.next, undefined);

    const human = spawnSync('node', [cli, 'critique', bundle], { cwd: root, encoding: 'utf8' });
    assert.doesNotMatch(human.stdout, /No design profile yet/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
