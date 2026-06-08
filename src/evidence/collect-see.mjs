import fs from 'node:fs';
import path from 'node:path';
import { readProjectConfig, resolveTargetConfig } from '../config/project-config.mjs';
import { BaguetteDriver } from '../runtime/baguette.mjs';
import { detectRuntimes } from '../runtime/detect.mjs';
import { isBooted, selectBaguetteDevice } from '../runtime/device-selection.mjs';
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
  const artifactsDir = resolveCaptureArtifactsDir(root, options.artifactsDir || null);
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

  return captureWithBaguette({ root, bundle, options });
}

/**
 * Resolves the configured capture artifact directory when a valid config exists.
 * @param {string} root Project root.
 * @param {string|null} explicit Explicit artifact directory.
 * @returns {string} Artifact directory path.
 */
function resolveCaptureArtifactsDir(root, explicit) {
  if (explicit) return explicit;
  const read = readProjectConfig(root);
  if (!read.exists) return 'artifacts';
  if (read.error) throw new Error(read.error);
  return path.relative(root, resolveTargetConfig(read.config, { root }).artifactsDir) || '.';
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
  const selection = selectBaguetteDevice(envelope, {
    udid: options.udid || null,
    deviceName: options.device || null
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
  steps.push({ name: 'list-devices', ok: true, message: `${selection.devices.length} simulator(s) found.` });
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
  setCapture(bundle, root, { status: ok ? 'complete' : 'partial', steps });
  return captureResult({ root, bundle, ok, device });
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
