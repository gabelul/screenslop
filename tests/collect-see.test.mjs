import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSee } from '../src/evidence/collect-see.mjs';

test('collectSee writes a dry-run bundle without runtime capture', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-dry-'));
  const result = await collectSee({
    root,
    surface: 'Settings',
    dryRun: true,
    detectRuntimesFn: () => ({ preferred: 'manual', tools: {} })
  });

  assert.equal(result.ok, true);
  assert.equal(result.capture.status, 'dry-run');
  assert.equal(result.artifacts.screenshot, null);
  assert.equal(fs.existsSync(path.join(root, result.evidence)), true);
  assert.equal(fs.existsSync(path.join(root, result.artifacts.summary)), true);
});

test('collectSee captures screenshot and accessibility with a fake Baguette driver', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-live-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: () => new FakeBaguetteDriver()
  });

  assert.equal(result.ok, true);
  assert.equal(result.runtime, 'baguette');
  assert.equal(result.device.name, 'iPhone Test');
  assert.equal(result.capture.status, 'complete');
  assert.match(result.artifacts.screenshot, /screenshot\.jpg$/);
  assert.match(result.artifacts.accessibilityTree, /accessibility\.json$/);
  assert.equal(result.artifacts.logs, null);
  assert.equal(fs.existsSync(path.join(root, result.artifacts.screenshot)), true);
  assert.equal(fs.existsSync(path.join(root, result.artifacts.accessibilityTree)), true);
});

test('collectSee writes optional logs with a fake Baguette driver', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-logs-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    includeLogs: true,
    logDurationMs: 50,
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: () => new FakeBaguetteDriver()
  });

  assert.equal(result.ok, true);
  assert.match(result.artifacts.logs, /logs\.ndjson$/);
  assert.equal(fs.readFileSync(path.join(root, result.artifacts.logs), 'utf8'), '{"event":"fake"}\n');
});

test('collectSee reports non-booted devices without --boot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-shutdown-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: () => new FakeBaguetteDriver({ booted: false })
  });

  assert.equal(result.ok, false);
  assert.equal(result.capture.status, 'failed');
  assert.equal(result.capture.steps.at(-1).name, 'boot');
  assert.match(result.capture.steps.at(-1).message, /not booted/);
});

/**
 * Small fake of the Baguette runtime driver.
 */
class FakeBaguetteDriver {
  /**
   * Creates a fake driver.
   * @param {object} [options] Fake options.
   * @param {boolean} [options.booted] Whether the simulator starts booted.
   */
  constructor(options = {}) {
    this.booted = options.booted ?? true;
  }

  /**
   * Lists fake simulators.
   * @returns {object} Fake Baguette envelope.
   */
  listDevices() {
    const device = { name: 'iPhone Test', runtime: 'iOS Test', state: this.booted ? 'Booted' : 'Shutdown', udid: 'TEST-UDID' };
    return this.booted ? { running: [device], available: [] } : { running: [], available: [device] };
  }

  /**
   * Boots the fake simulator.
   * @returns {{ok:boolean,message:string}} Boot status.
   */
  boot() {
    this.booted = true;
    return { ok: true, message: 'booted' };
  }

  /**
   * Writes a fake screenshot file.
   * @param {string} _udid Ignored UDID.
   * @param {string} outputPath Screenshot path.
   * @returns {{ok:boolean,message:string}} Capture status.
   */
  screenshot(_udid, outputPath) {
    fs.writeFileSync(outputPath, 'fake-jpeg');
    return { ok: true, message: 'screenshot ok' };
  }

  /**
   * Writes a fake accessibility tree.
   * @param {string} _udid Ignored UDID.
   * @param {string} outputPath Accessibility path.
   * @returns {{ok:boolean,message:string}} Capture status.
   */
  accessibilityTree(_udid, outputPath) {
    fs.writeFileSync(outputPath, JSON.stringify({ role: 'window' }));
    return { ok: true, message: 'accessibility ok' };
  }

  /**
   * Writes a fake log sample.
   * @param {string} _udid Ignored UDID.
   * @param {string} outputPath Log path.
   * @returns {Promise<{ok:boolean,message:string,timedOut:boolean}>} Log status.
   */
  async logs(_udid, outputPath) {
    fs.writeFileSync(outputPath, '{"event":"fake"}\n');
    return { ok: true, message: 'logs ok', timedOut: true };
  }
}
