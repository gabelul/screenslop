import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProjectConfig, resolveTargetConfig } from '../config/project-config.mjs';
import { BaguetteDriver } from '../runtime/baguette.mjs';
import { detectRuntimes } from '../runtime/detect.mjs';
import { loadScreenshotPixels } from '../critique/pixels.mjs';
import { isBooted, resolveCaptureDevice } from '../runtime/device-selection.mjs';
import { compareFrames, describeStability, frameBytesMatch } from './stability.mjs';
import { createEvidenceBundle, writeEvidenceBundle } from './bundle.mjs';

/**
 * Captures evidence for the current screen.
 * @param {object} options Capture options.
 * @param {string} [options.root] Project root.
 * @param {string|null} [options.surface] Human-readable surface name.
 * @param {boolean} [options.dryRun] Create a bundle without runtime capture.
 * @param {boolean} [options.boot] Boot the selected simulator without prompting.
 * @param {boolean} [options.includeLogs] Capture a bounded log sample.
 * @param {string|null} [options.udid] Exact simulator UDID.
 * @param {string|null} [options.device] Exact or partial simulator name.
 * @param {string|null} [options.deviceSet] Custom simulator device set path.
 * @param {string|null} [options.configuredDevice] Overrides config `defaultDevice` (tests).
 * @param {string|null} [options.bundleId] Optional log filter.
 * @param {number} [options.logDurationMs] Log capture duration.
 * @param {string|null} [options.artifactsDir] Explicit artifact directory override.
 * @param {Function} [options.detectRuntimesFn] Runtime detector override.
 * @param {Function} [options.createDriver] Runtime driver factory override.
 * @param {Function} [options.confirmBoot] Interactive boot confirmation callback.
 * @returns {Promise<object>} Machine-readable capture result.
 */
export async function collectSee(options = {}) {
  const root = fs.realpathSync.native(path.resolve(options.root || process.cwd()));
  const detected = (options.detectRuntimesFn || detectRuntimes)();
  const configTarget = readCaptureTarget(root);
  const artifactsDir = options.artifactsDir || configTarget.artifactsDir || 'artifacts';
  const configuredDevice = options.configuredDevice ?? configTarget.device;
  const bundle = createEvidenceBundle({
    surface: options.surface,
    driver: detected.preferred,
    root,
    artifactsDir
  });

  const result = baseResult({ root, bundle, runtime: detected.preferred });

  if (options.dryRun) {
    setCapture(bundle, root, {
      status: 'dry-run',
      steps: [{ name: 'capture', ok: true, message: 'Dry run only. No simulator capture attempted.' }]
    });
    return { ...result, ok: true, artifacts: bundle.manifest.artifacts, capture: bundle.manifest.capture };
  }

  if (detected.preferred !== 'baguette') {
    setCapture(bundle, root, {
      status: 'unavailable',
      steps: [{
        name: 'baguette',
        ok: false,
        message: 'Baguette is not available. Fallback capture is not wired yet.'
      }]
    });
    return { ...result, ok: false, artifacts: bundle.manifest.artifacts, capture: bundle.manifest.capture };
  }

  return captureWithBaguette({ root, bundle, options: { ...options, configuredDevice } });
}

/**
 * Reads the capture-relevant slice of project config in one pass.
 *
 * Both the artifact directory and the default device come from the same config
 * read, so a project that names a device gets it honoured by `see` the same way
 * `matrix` already honours it.
 *
 * @param {string} root Project root.
 * @returns {{artifactsDir:string|null, device:string|null}} Capture target defaults.
 */
function readCaptureTarget(root) {
  const read = readProjectConfig(root);
  if (!read.exists) return { artifactsDir: null, device: null };
  if (read.error) throw new Error(read.error);
  const target = resolveTargetConfig(read.config, { root });
  return {
    artifactsDir: path.relative(root, target.artifactsDir) || '.',
    device: target.device || null
  };
}

/**
 * Captures Baguette-backed artifacts.
 * @param {object} params Capture parameters.
 * @param {string} params.root Project root.
 * @param {object} params.bundle Evidence bundle.
 * @param {object} params.options Capture options.
 * @returns {Promise<object>} Machine-readable capture result.
 */
async function captureWithBaguette({ root, bundle, options }) {
  const driver = options.createDriver
    ? options.createDriver(options)
    : new BaguetteDriver({ deviceSet: options.deviceSet || null });
  const steps = [];
  const envelope = driver.listDevices();
  const selection = resolveCaptureDevice(envelope, {
    udid: options.udid || null,
    deviceName: options.device || null,
    configuredDeviceName: options.configuredDevice || null
  });

  if (!selection.device) {
    steps.push({
      name: 'list-devices',
      ok: false,
      message: `No simulator matched this request (${selection.reason || 'unknown'}).`
    });
    setCapture(bundle, root, { status: 'failed', steps });
    return captureResult({ root, bundle, ok: false });
  }

  let device = selection.device;
  steps.push({
    name: 'list-devices',
    ok: true,
    message: `${selection.devices.length} simulator(s) found. Target chosen by ${selection.source}.`
  });
  // Surface config-vs-booted disagreement instead of silently capturing the wrong device.
  for (const note of selection.notes) {
    steps.push({ name: 'device-selection', ok: true, message: note });
  }
  setDevice(bundle, device);

  if (!isBooted(device)) {
    const shouldBoot = Boolean(options.boot) || await maybeConfirmBoot(options.confirmBoot, device);
    if (!shouldBoot) {
      steps.push({
        name: 'boot',
        ok: false,
        message: `${device.name} is not booted. Re-run with --boot or boot a simulator first.`
      });
      setCapture(bundle, root, { status: 'failed', steps });
      return captureResult({ root, bundle, ok: false, device });
    }

    const bootStatus = driver.boot(device.udid);
    steps.push({
      name: 'boot',
      ok: bootStatus.ok,
      message: bootStatus.message || `Requested boot for ${device.name}.`
    });

    if (!bootStatus.ok) {
      setCapture(bundle, root, { status: 'failed', steps });
      return captureResult({ root, bundle, ok: false, device });
    }

    device = { ...device, state: 'Booted', bucket: 'running' };
    setDevice(bundle, device);
  }

  const screenshotPath = path.join(bundle.dir, 'screenshot.jpg');
  const screenshotStatus = driver.screenshot(device.udid, screenshotPath);
  const screenshotOk = screenshotStatus.ok && fs.existsSync(screenshotPath);
  steps.push({
    name: 'screenshot',
    ok: screenshotOk,
    message: screenshotStatus.message || (screenshotOk ? 'Captured screenshot.' : 'Screenshot capture failed.')
  });
  if (screenshotOk) bundle.manifest.artifacts.screenshot = path.relative(root, screenshotPath);

  let stability = null;
  if (screenshotOk) {
    stability = await measureStability({ driver, device, screenshotPath, options });
    steps.push({
      name: 'stability',
      ok: stability.status !== 'unstable',
      message: describeStability(stability, stability.delayMs)
    });
  }

  const accessibilityPath = path.join(bundle.dir, 'accessibility.json');
  const accessibilityStatus = driver.accessibilityTree(device.udid, accessibilityPath);
  const accessibilityOk = accessibilityStatus.ok && fs.existsSync(accessibilityPath);
  steps.push({
    name: 'accessibility-tree',
    ok: accessibilityOk,
    message: accessibilityStatus.message || (accessibilityOk ? 'Captured accessibility tree.' : 'Accessibility capture failed.')
  });
  if (accessibilityOk) bundle.manifest.artifacts.accessibilityTree = path.relative(root, accessibilityPath);

  if (options.includeLogs) {
    const logsPath = path.join(bundle.dir, 'logs.ndjson');
    const durationMs = Number(options.logDurationMs || 3000);
    const logsStatus = await driver.logs(device.udid, logsPath, {
      durationMs,
      bundleId: options.bundleId || null
    });
    const logsOk = logsStatus.ok && fs.existsSync(logsPath);
    steps.push({
      name: 'logs',
      ok: logsOk,
      message: logsStatus.message || `Collected ${durationMs}ms log sample.`
    });
    if (logsOk) bundle.manifest.artifacts.logs = path.relative(root, logsPath);
  }

  const ok = screenshotOk && accessibilityOk;
  setCapture(bundle, root, {
    status: ok ? 'complete' : 'partial',
    steps,
    ...(stability ? { stability } : {})
  });
  return captureResult({ root, bundle, ok, device });
}

/**
 * Takes a second capture a moment later and reports whether the screen moved.
 *
 * The probe frame is written outside the bundle and deleted: it is a
 * measurement, not evidence, and shipping a second screenshot would double
 * every bundle for no reviewer benefit.
 *
 * @param {object} params Probe parameters.
 * @param {object} params.driver Runtime driver.
 * @param {object} params.device Selected simulator.
 * @param {string} params.screenshotPath Path of the captured screenshot.
 * @param {object} params.options Capture options.
 * @returns {Promise<{status:string, changedRatio:number|null, delayMs:number}>} Stability verdict.
 */
async function measureStability({ driver, device, screenshotPath, options }) {
  const delayMs = Number.isFinite(options.stabilityDelayMs) ? Number(options.stabilityDelayMs) : 250;
  const loadPixels = options.loadPixels || loadScreenshotPixels;
  let probeDir = null;

  try {
    await sleep(delayMs);
    probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-stability-'));
    const probePath = path.join(probeDir, 'probe.jpg');
    const probeStatus = driver.screenshot(device.udid, probePath);
    if (!probeStatus.ok || !fs.existsSync(probePath)) {
      return { status: 'unknown', changedRatio: null, delayMs };
    }

    // Opportunistic: identical bytes prove stillness without decoding, but a
    // live simulator usually changes something across the gap, so this is a
    // shortcut rather than the expected path.
    if (frameBytesMatch(fs.readFileSync(screenshotPath), fs.readFileSync(probePath))) {
      return { status: 'stable', changedRatio: 0, delayMs };
    }

    const verdict = compareFrames(loadPixels(screenshotPath), loadPixels(probePath));
    return { ...verdict, delayMs };
  } catch {
    return { status: 'unknown', changedRatio: null, delayMs };
  } finally {
    if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

/**
 * Waits without blocking the event loop.
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} Resolves after the delay.
 */
function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

/**
 * Builds a common result payload.
 * @param {object} params Result params.
 * @param {string} params.root Project root.
 * @param {object} params.bundle Evidence bundle.
 * @param {string} params.runtime Runtime driver name.
 * @returns {object} Base result.
 */
function baseResult({ root, bundle, runtime }) {
  return {
    ok: true,
    command: 'see',
    runtime,
    runId: bundle.runId,
    dir: path.relative(root, bundle.dir),
    evidence: path.relative(root, bundle.manifestPath),
    artifacts: bundle.manifest.artifacts,
    capture: bundle.manifest.capture || null
  };
}

/**
 * Builds a Baguette capture result after manifest updates.
 * @param {object} params Result params.
 * @param {string} params.root Project root.
 * @param {object} params.bundle Evidence bundle.
 * @param {boolean} params.ok Whether capture met the required artifact bar.
 * @param {object} [params.device] Selected simulator device.
 * @returns {object} Capture result.
 */
function captureResult({ root, bundle, ok, device }) {
  return {
    ...baseResult({ root, bundle, runtime: 'baguette' }),
    ok,
    device: device ? publicDevice(device) : undefined,
    artifacts: bundle.manifest.artifacts,
    capture: bundle.manifest.capture
  };
}

/**
 * Persists capture status to the bundle.
 * @param {object} bundle Evidence bundle.
 * @param {string} root Project root.
 * @param {object} capture Capture status.
 * @returns {void}
 */
function setCapture(bundle, root, capture) {
  bundle.manifest.capture = capture;
  writeEvidenceBundle({ root, dir: bundle.dir, manifestPath: bundle.manifestPath, manifest: bundle.manifest });
}

/**
 * Stores selected simulator metadata in the manifest.
 * @param {object} bundle Evidence bundle.
 * @param {object} device Simulator device.
 * @returns {void}
 */
function setDevice(bundle, device) {
  bundle.manifest.runtime.driver = 'baguette';
  bundle.manifest.runtime.deviceName = device.name;
  bundle.manifest.runtime.udid = device.udid;
}

/**
 * Runs the optional interactive boot callback.
 * @param {Function|undefined} confirmBoot Callback that returns a boolean.
 * @param {object} device Selected simulator.
 * @returns {Promise<boolean>} True when booting is approved.
 */
async function maybeConfirmBoot(confirmBoot, device) {
  if (!confirmBoot) return false;
  return Boolean(await confirmBoot(device));
}

/**
 * Removes internal selection fields from device output.
 * @param {object} device Simulator device.
 * @returns {object} Public device summary.
 */
function publicDevice(device) {
  return {
    name: device.name,
    runtime: device.runtime,
    state: device.state,
    udid: device.udid
  };
}
