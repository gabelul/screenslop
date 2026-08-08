import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

/**
 * Answers "which app was actually on screen when this bundle was captured?".
 *
 * `see` photographs whatever the simulator happens to be showing. Nothing made
 * it the app you meant. Pointed at a simulator where the app was not installed,
 * it captured the iOS home screen, labelled it with the configured surface, and
 * reported a complete, stable capture — and critique would then have scored
 * Apple's springboard and filed the findings against the project.
 *
 * Device selection answers "which simulator". This answers "which app", which
 * is a different question and the one that actually decides whether the evidence
 * is about the thing under review.
 */

/**
 * Reads the frontmost app name out of a captured accessibility tree.
 *
 * The root AXApplication node carries the app's display name — "PetPacket" for
 * the app, empty for the springboard — so the answer is already sitting in every
 * bundle we write. Nothing read it until now.
 *
 * @param {string} accessibilityPath Path to a captured accessibility.json.
 * @returns {string|null} Frontmost app display name, or null when absent.
 */
export function readFrontmostApp(accessibilityPath) {
  try {
    const tree = JSON.parse(fs.readFileSync(accessibilityPath, 'utf8'));
    if (!tree || typeof tree !== 'object') return null;
    const label = typeof tree.label === 'string' ? tree.label.trim() : '';
    return label || null;
  } catch {
    return null;
  }
}

/**
 * Reads the screen's own heading out of a captured accessibility tree.
 *
 * `--surface` is a label the operator types; nothing checks it. An app resumed
 * on whatever tab it was last on will happily produce a bundle named "home"
 * showing a different screen, and `verify` will then match findings across two
 * screens that have nothing to do with each other. This records what the screen
 * actually called itself, so the claim can be checked against something.
 *
 * @param {string} accessibilityPath Path to a captured accessibility.json.
 * @returns {string|null} First heading-like label, or null when absent.
 */
export function readScreenTitle(accessibilityPath) {
  try {
    const tree = JSON.parse(fs.readFileSync(accessibilityPath, 'utf8'));
    const headingRole = /statictext|heading/i;
    const walk = (node) => {
      if (!node || typeof node !== 'object') return null;
      const label = typeof node.label === 'string' ? node.label.trim() : '';
      if (label && headingRole.test(String(node.role || ''))) return label;
      for (const child of node.children || []) {
        const found = walk(child);
        if (found) return found;
      }
      return null;
    };
    // Children only: the root is the app, which readFrontmostApp already covers.
    for (const child of tree?.children || []) {
      const found = walk(child);
      if (found) return found;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Looks up an installed app's display name from its bundle id.
 *
 * The accessibility tree reports a display name, config records a bundle id, and
 * comparing them needs a translation the simulator already holds.
 *
 * Distinguishes "this simulator does not have the app" from "the lookup did not
 * work". The first is decisive — an app that is not installed cannot be the app
 * on screen, which is exactly how a bundle full of springboard gets written. The
 * second is only an absence of information.
 *
 * @param {string} udid Target simulator UDID.
 * @param {string} bundleId Bundle identifier to resolve.
 * @param {object} [options] Injection points for tests.
 * @param {Function} [options.runSimctl] Runs `simctl listapps`, returns stdout.
 * @param {Function} [options.runPlutil] Converts a plist string to JSON text.
 * @returns {{status:string, name:string|null}} Resolution outcome.
 */
export function resolveExpectedApp(udid, bundleId, options = {}) {
  if (!udid || !bundleId) return { status: 'unknown', name: null };
  const runSimctl = options.runSimctl
    || ((id) => execFileSync('xcrun', ['simctl', 'listapps', id], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }));
  const runPlutil = options.runPlutil
    || ((plist) => execFileSync('plutil', ['-convert', 'json', '-o', '-', '-'], { input: plist, encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }));

  try {
    const apps = JSON.parse(runPlutil(runSimctl(udid)));
    const entry = apps?.[bundleId];
    // The listing worked and the app is not in it. Nothing on this simulator can
    // be the configured app, whatever the screenshot shows.
    if (!entry) return { status: 'not-installed', name: null };
    // Display name is what the AX tree reports; bundle name is the fallback for
    // apps that never set one.
    const name = entry.CFBundleDisplayName || entry.CFBundleName || null;
    return typeof name === 'string' && name.trim()
      ? { status: 'resolved', name: name.trim() }
      : { status: 'unknown', name: null };
  } catch {
    // No xcrun, no plutil, unparseable output — an absence of information, never
    // a verdict. Guessing here would fail captures for toolchain reasons that
    // have nothing to do with the app on screen.
    return { status: 'unknown', name: null };
  }
}

/**
 * Compares the app that was captured against the app that was configured.
 *
 * @param {object} params Comparison inputs.
 * @param {string|null} params.observed Frontmost app name from the AX tree.
 * @param {{status:string,name:string|null}} params.expected Resolution outcome.
 * @returns {{status:string, observed:string|null, expected:string|null, message:string}} Verdict.
 */
export function checkForeground({ observed, expected }) {
  const resolution = expected || { status: 'unknown', name: null };
  const base = { observed: observed || null, expected: resolution.name || null };

  // An app that is not on this simulator cannot be the app in this screenshot.
  // Reporting that as "unverified" is how a capture of the iOS home screen
  // passes as a capture of the project.
  if (resolution.status === 'not-installed') {
    return {
      ...base,
      status: 'mismatch',
      // The bundle id stays out of the message: it is a redacted identifier in
      // this repo, and the reader configured it, so naming it adds nothing.
      message: `The configured app is not installed on this simulator, so this capture cannot be of it${observed ? ` — "${observed}" was on screen instead` : ''}.`
    };
  }

  if (!resolution.name) {
    return {
      ...base,
      status: 'unverified',
      message: observed
        ? `Captured "${observed}". Could not resolve the configured app's name, so this is recorded but unchecked.`
        : 'Could not read the frontmost app, and could not resolve the configured app to check it against.'
    };
  }

  if (!observed) {
    return {
      ...base,
      status: 'mismatch',
      message: `Expected "${resolution.name}" on screen but no app reported itself frontmost — the simulator was most likely sitting on the home screen.`
    };
  }

  if (observed.toLowerCase() !== resolution.name.toLowerCase()) {
    return {
      ...base,
      status: 'mismatch',
      message: `Captured "${observed}" but the configured app is "${resolution.name}". This bundle is evidence about the wrong app.`
    };
  }

  return { ...base, status: 'match', message: `Captured "${observed}", matching the configured app.` };
}
