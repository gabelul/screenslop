import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { collectSee, readEditableRegions } from '../src/evidence/collect-see.mjs';
import { buildBmp, parseBmp } from '../src/critique/pixels.mjs';

test('collectSee records a stable verdict when the screen holds still', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-stable-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    stabilityDelayMs: 0,
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: () => new FakeBaguetteDriver()
  });

  // The fake driver rewrites identical bytes, so the byte fast path applies.
  assert.equal(result.capture.stability.status, 'stable');
  assert.equal(result.capture.stability.changedRatio, 0);
  assert.equal(result.capture.steps.some((step) => step.name === 'stability' && step.ok), true);
  assert.equal(result.ok, true);
  assert.equal(result.capture.status, 'complete');
});

test('collectSee flags a bundle captured while the screen was still moving', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-unstable-'));
  // Each capture writes different bytes; the injected loader turns them into
  // completely different frames, standing in for a mid-transition screen.
  class DriftingDriver extends FakeBaguetteDriver {
    screenshot(_udid, outputPath) {
      this.frames = (this.frames || 0) + 1;
      fs.writeFileSync(outputPath, `frame-${this.frames}`);
      return { ok: true, message: 'screenshot ok' };
    }
  }

  const result = await collectSee({
    root,
    surface: 'Home',
    stabilityDelayMs: 0,
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: () => new DriftingDriver(),
    loadPixels: (file) => {
      const first = fs.readFileSync(file, 'utf8').endsWith('1');
      const shade = first ? 255 : 0;
      return parseBmp(buildBmp(40, 40, () => ({ r: shade, g: shade, b: shade })));
    }
  });

  assert.equal(result.capture.stability.status, 'unstable');
  assert.equal(result.capture.stability.changedRatio, 1);
  // The load-bearing part: a capture that cannot be trusted must not report
  // success, or a matrix cell, an agent, or CI carries on with it.
  assert.equal(result.ok, false, 'an unproven capture must not report success');
  assert.equal(result.capture.status, 'partial');
  const step = result.capture.steps.find((entry) => entry.name === 'stability');
  assert.equal(step.ok, false);
  assert.match(step.message, /still moving/);
});

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

test('collectSee honors the configured artifactsDir for dry-run bundles', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-config-artifacts-'));
  writeConfig(root, { artifactsDir: 'custom-artifacts' });

  const result = await collectSee({
    root,
    surface: 'Settings',
    dryRun: true,
    detectRuntimesFn: () => ({ preferred: 'manual', tools: {} })
  });

  assert.match(result.dir, /^custom-artifacts\//);
  assert.match(result.evidence, /^custom-artifacts\//);
  assert.match(result.artifacts.summary, /^custom-artifacts\//);
  assert.equal(fs.existsSync(path.join(root, result.evidence)), true);
});

test('collectSee rejects invalid config instead of hiding the artifact root error', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-invalid-config-'));
  writeConfig(root, { artifactsDir: '../outside-artifacts' });

  await assert.rejects(
    () => collectSee({
      root,
      surface: 'Settings',
      dryRun: true,
      detectRuntimesFn: () => ({ preferred: 'manual', tools: {} })
    }),
    /artifactsDir must resolve inside the project root/
  );
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

/**
 * Writes a minimal valid Screenslop config for capture tests.
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
    defaultScheme: null,
    defaultBundleId: null,
    defaultDevice: null,
    workspacePath: null,
    projectPath: null,
    sourceRoot: null,
    artifactsDir: 'artifacts',
    sourceHints: [],
    ...overrides
  }, null, 2)}\n`);
}

/**
 * Fake driver that writes an accessibility tree for a named frontmost app.
 * @param {string} label Root AXApplication label ('' for the home screen).
 * @returns {Function} Driver factory.
 */
function driverShowing(label) {
  return () => {
    const driver = new FakeBaguetteDriver();
    driver.accessibilityTree = (_udid, outputPath) => {
      fs.writeFileSync(outputPath, JSON.stringify({ role: 'AXApplication', label }));
      return { ok: true, message: 'accessibility ok' };
    };
    return driver;
  };
}

test('a capture of the wrong app does not report success', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-wrong-app-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    stabilityDelayMs: 0,
    configuredBundleId: 'com.example.petpacket',
    resolveExpectedApp: () => ({ status: 'resolved', name: 'PetPacket' }),
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: driverShowing('Settings')
  });

  assert.equal(result.ok, false, 'evidence about a different app must not report success');
  assert.equal(result.capture.status, 'partial');
  assert.equal(result.capture.foreground.status, 'mismatch');
  assert.equal(result.capture.foreground.observed, 'Settings');
  const step = result.capture.steps.find((entry) => entry.name === 'foreground-app');
  assert.equal(step.ok, false);
});

test('a capture of the home screen does not pass as the app', async () => {
  // The original defect: pointed at a simulator without the app installed, every
  // other signal read clean and the bundle claimed to be the configured surface.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-springboard-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    stabilityDelayMs: 0,
    configuredBundleId: 'com.example.petpacket',
    resolveExpectedApp: () => ({ status: 'resolved', name: 'PetPacket' }),
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: driverShowing('')
  });

  assert.equal(result.ok, false);
  assert.equal(result.capture.foreground.status, 'mismatch');
  assert.equal(result.capture.foreground.observed, null);
});

test('the configured app on screen captures clean and records what it saw', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-right-app-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    stabilityDelayMs: 0,
    configuredBundleId: 'com.example.petpacket',
    resolveExpectedApp: () => ({ status: 'resolved', name: 'PetPacket' }),
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: driverShowing('PetPacket')
  });

  assert.equal(result.ok, true);
  assert.equal(result.capture.status, 'complete');
  assert.equal(result.capture.foreground.status, 'match');
  assert.equal(result.capture.foreground.observed, 'PetPacket');
});

test('an unconfigured project still records the app it captured', async () => {
  // No bundle id means no verdict is possible, but the bundle should still say
  // what it saw — otherwise nothing downstream can ever tell.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-see-unverified-'));
  const result = await collectSee({
    root,
    surface: 'Home',
    stabilityDelayMs: 0,
    detectRuntimesFn: () => ({ preferred: 'baguette', tools: {} }),
    createDriver: driverShowing('PetPacket')
  });

  assert.equal(result.ok, true);
  assert.equal(result.capture.foreground.status, 'unverified');
  assert.equal(result.capture.foreground.observed, 'PetPacket');
});

test('caret exemption only sees exactly one focused editable field', () => {
  // The parser was previously bypassed entirely: stability tests injected
  // regions directly, so dropping the focus requirement would have gone unseen.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-focus-'));
  const write = (tree) => {
    const file = path.join(dir, `${Math.random().toString(36).slice(2)}.json`);
    fs.writeFileSync(file, JSON.stringify(tree));
    return file;
  };
  const root = (children) => ({ role: 'AXApplication', frame: { x: 0, y: 0, width: 402, height: 874 }, children });
  const field = (extra) => ({ role: 'AXTextField', frame: { x: 10, y: 20, width: 200, height: 40 }, ...extra });

  // One focused editable field: usable.
  assert.equal(readEditableRegions(write(root([field({ focused: true })]))).length, 1);

  // Unfocused, or focus expressed as anything other than true: no exemption.
  assert.equal(readEditableRegions(write(root([field({ focused: false })]))).length, 0);
  assert.equal(readEditableRegions(write(root([field({})]))).length, 0);
  assert.equal(readEditableRegions(write(root([field({ focused: 'yes' })]))).length, 0);
  assert.equal(readEditableRegions(write(root([field({ focused: 1 })]))).length, 0);

  // Two fields both claiming focus is a contradiction, not a caret.
  assert.equal(readEditableRegions(write(root([field({ focused: true }), field({ focused: true })]))).length, 0);

  // A focused non-editable node is not a caret host.
  assert.equal(readEditableRegions(write(root([{ role: 'AXButton', focused: true, frame: field({}).frame }]))).length, 0);

  // Unreadable or shapeless trees degrade to no exemption.
  assert.equal(readEditableRegions(path.join(dir, 'missing.json')).length, 0);
  assert.equal(readEditableRegions(write({ role: 'AXApplication', children: [field({ focused: true })] })).length, 0);

  fs.rmSync(dir, { recursive: true, force: true });
});
