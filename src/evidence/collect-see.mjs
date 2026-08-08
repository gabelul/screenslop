import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readProjectConfig, resolveTargetConfig } from '../config/project-config.mjs';
import { BaguetteDriver } from '../runtime/baguette.mjs';
import { detectRuntimes } from '../runtime/detect.mjs';
import { loadScreenshotPixels } from '../critique/pixels.mjs';
import { isBooted, resolveCaptureDevice } from '../runtime/device-selection.mjs';
import { compareFrames, describeStability, frameBytesMatch } from './stability.mjs';
import { checkForeground, readFrontmostApp, readScreenTitle, resolveExpectedApp } from './foreground.mjs';
import { createEvidenceBundle, writeEvidenceBundle } from './bundle.mjs';

// Roles the platform uses for editable text. A caret only blinks inside one.
const editableRolePattern = /textfield|securetextfield|textarea|searchfield/i;

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
 * @param {string|null} [options.configuredBundleId] Overrides config `defaultBundleId` (tests).
 * @param {Function} [options.resolveExpectedApp] Frontmost-app resolver override (tests).
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
  const configuredBundleId = options.configuredBundleId ?? configTarget.bundleId;
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

  return captureWithBaguette({ root, bundle, options: { ...options, configuredDevice, configuredBundleId } });
}

/**
 * Reads the capture-relevant slice of project config in one pass.
 *
 * Both the artifact directory and the default device come from the same config
 * read, so a project that names a device gets it honoured by `see` the same way
 * `matrix` already honours it.
 *
 * @param {string} root Project root.
 * @returns {{artifactsDir:string|null, device:string|null, bundleId:string|null}} Capture target defaults.
 */
function readCaptureTarget(root) {
  const read = readProjectConfig(root);
  if (!read.exists) return { artifactsDir: null, device: null, bundleId: null };
  if (read.error) throw new Error(read.error);
  const target = resolveTargetConfig(read.config, { root });
  return {
    artifactsDir: path.relative(root, target.artifactsDir) || '.',
    device: target.device || null,
    bundleId: target.bundleId || null
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
  const screenshotAt = Date.now();
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

  // Which app was actually on screen. Picking the right simulator does not mean
  // the right app was running on it — capture the home screen and every other
  // signal here still reads clean.
  let foreground = null;
  if (accessibilityOk) {
    const resolve = options.resolveExpectedApp || resolveExpectedApp;
    foreground = checkForeground({
      observed: readFrontmostApp(accessibilityPath),
      expected: resolve(device.udid, options.configuredBundleId || null)
    });
    // What the screen called itself, beside what the operator called it. No
    // verdict here — there is no ground truth mapping a surface name to a
    // heading — but a bundle that records both can be checked later.
    foreground.declaredSurface = options.surface || null;
    foreground.screenTitle = readScreenTitle(accessibilityPath);
    steps.push({
      // 'unverified' is not a failure: with no configured bundle id there is
      // nothing to compare against, and inventing a verdict from that would
      // fail captures for a missing config field rather than a wrong app.
      name: 'foreground-app',
      ok: foreground.status !== 'mismatch',
      message: foreground.message
    });
  }

  // The stability probe runs after the AX capture, not between it and the
  // screenshot. Putting the 250ms wait in the middle pushed the AX tree further
  // from the frame it describes — widening exactly the screenshot-to-AX gap
  // this tool depends on, in the name of proving the screen was still.
  let stability = null;
  if (screenshotOk) {
    stability = await measureStability({
      driver,
      device,
      screenshotPath,
      options,
      capturedAt: screenshotAt,
      editableRegions: accessibilityOk ? readEditableRegions(accessibilityPath) : []
    });
    steps.push({
      name: 'stability',
      // Only a measured 'stable' is a pass. 'unknown' means the probe failed,
      // and reporting that as ok is how an unproven capture starts looking
      // like a proven one.
      ok: stability.status === 'stable',
      message: describeStability(stability, stability.delayMs)
    });
  }

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

  // Stability is part of whether this bundle can be used as proof, not a note
  // beside it. Reporting success while the stability step failed meant a
  // caller — a matrix cell, an agent, CI — saw a clean capture and carried on
  // with evidence photographed mid-animation. The bundle is still written and
  // still inspectable; it just stops claiming to be a settled capture.
  const stabilityProven = !stability || stability.status === 'stable';
  // A confirmed wrong app is worse than a shaky capture: the bundle is not weak
  // evidence about this app, it is confident evidence about a different one.
  const rightApp = !foreground || foreground.status !== 'mismatch';
  const ok = screenshotOk && accessibilityOk && stabilityProven && rightApp;
  setCapture(bundle, root, {
    status: ok ? 'complete' : 'partial',
    steps,
    ...(stability ? { stability } : {}),
    ...(foreground ? { foreground } : {})
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
async function measureStability({ driver, device, screenshotPath, options, capturedAt, editableRegions }) {
  const sleepMs = Number.isFinite(options.stabilityDelayMs) ? Number(options.stabilityDelayMs) : 250;
  // The AX capture happens between the screenshot and this probe, so the frames
  // are further apart than the sleep alone. Reporting the configured sleep as
  // the gap described a 250ms comparison that was really seconds wide.
  const elapsed = () => (Number.isFinite(capturedAt) ? Math.max(0, Date.now() - capturedAt) : sleepMs);
  const loadPixels = options.loadPixels || loadScreenshotPixels;
  let probeDir = null;

  try {
    await sleep(sleepMs);
    probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-stability-'));
    const probePath = path.join(probeDir, 'probe.jpg');
    const probeStatus = driver.screenshot(device.udid, probePath);
    if (!probeStatus.ok || !fs.existsSync(probePath)) {
      return { status: 'unknown', changedRatio: null, delayMs: elapsed(), reason: 'probe-capture-failed' };
    }

    // Opportunistic: identical bytes prove stillness without decoding, but a
    // live simulator usually changes something across the gap, so this is a
    // shortcut rather than the expected path.
    if (frameBytesMatch(fs.readFileSync(screenshotPath), fs.readFileSync(probePath))) {
      // Same shape as the sampled path so consumers see one contract.
      return { status: 'stable', changedRatio: 0, busiestTileRatio: 0, delayMs: elapsed() };
    }

    const captured = loadPixels(screenshotPath);
    const verdict = compareFrames(captured, loadPixels(probePath), {
      editableRegions: scaleRegions(editableRegions, captured)
    });
    // Both frames captured but neither decodable — sips missing, or a format the
    // parser cannot read. Distinct from a failed probe capture.
    if (verdict.status === 'unknown') return { ...verdict, delayMs: elapsed(), reason: 'frames-not-decodable' };
    return { ...verdict, delayMs: elapsed() };
  } catch (error) {
    return { status: 'unknown', changedRatio: null, delayMs: elapsed(), reason: `probe-error: ${error.message}` };
  } finally {
    if (probeDir) fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

/**
 * Finds the focused editable field in a captured accessibility tree.
 *
 * Used only to exempt caret blink from the stability check, so it must be as
 * narrow as the evidence allows. Baguette reports a `focused` boolean per node;
 * an earlier version of this claimed it did not and fell back to exempting
 * *every* text field on screen, which is far too broad for something that
 * suppresses a proof signal. If nothing is focused, there is no caret to
 * exempt and the exemption is simply unavailable.
 *
 * @param {string} accessibilityPath Path to the captured AX tree.
 * @returns {{frame:object, rootWidth:number}[]} At most one focused field, in point space.
 */
export function readEditableRegions(accessibilityPath) {
  try {
    const tree = JSON.parse(fs.readFileSync(accessibilityPath, 'utf8'));
    const rootWidth = Number(tree?.frame?.width) || 0;
    if (!rootWidth) return [];
    const frames = [];
    const walk = (node) => {
      if (!node || typeof node !== 'object') return;
      const editable = editableRolePattern.test(String(node.role || ''))
        || editableRolePattern.test(String(node.subrole || ''));
      if (editable && node.focused === true && node.frame) frames.push(node.frame);
      for (const child of node.children || []) walk(child);
    };
    walk(tree);
    // More than one field claiming focus is a contradiction, not a caret.
    return frames.length === 1 ? [{ frame: frames[0], rootWidth }] : [];
  } catch {
    return [];
  }
}

/**
 * Converts point-space editable frames into capture pixel coordinates.
 * @param {{frame:object, rootWidth:number}[]} regions Editable frames.
 * @param {object|null} image Captured pixel accessor.
 * @returns {{x:number,y:number,width:number,height:number}[]} Pixel regions.
 */
function scaleRegions(regions, image) {
  if (!Array.isArray(regions) || regions.length === 0 || !image?.width) return [];
  return regions
    .filter((entry) => entry.rootWidth > 0)
    .map(({ frame, rootWidth }) => {
      const scale = image.width / rootWidth;
      return {
        x: Number(frame.x) * scale,
        y: Number(frame.y) * scale,
        width: Number(frame.width) * scale,
        height: Number(frame.height) * scale
      };
    })
    .filter((region) => Number.isFinite(region.x) && region.width > 0 && region.height > 0);
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
