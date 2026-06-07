import fs from 'node:fs';
import { run, runFor, quote } from './shell.mjs';

/**
 * Thin wrapper around the Baguette CLI.
 */
export class BaguetteDriver {
  /**
   * Creates a Baguette driver.
   * @param {object} [options] Driver options.
   * @param {string|null} [options.deviceSet] Custom simulator device set path.
   */
  constructor(options = {}) {
    this.deviceSet = options.deviceSet || null;
  }

  /**
   * Lists simulators known to Baguette.
   * @returns {object|null} Parsed JSON when available.
   */
  listDevices() {
    const result = run(`baguette list --json${this.deviceSetArg()}`);
    if (result.status !== 0) return null;
    try {
      return JSON.parse(result.stdout);
    } catch {
      return null;
    }
  }

  /**
   * Boots a simulator through Baguette.
   * @param {string} udid Simulator UDID.
   * @returns {{ok:boolean, message:string}}
   */
  boot(udid) {
    const result = run(`baguette boot --udid ${quote(udid)}${this.deviceSetArg()}`);
    return toStatus(result);
  }

  /**
   * Captures a simulator screenshot.
   * @param {string} udid Simulator UDID.
   * @param {string} outputPath Output image path.
   * @returns {{ok:boolean, message:string}}
   */
  screenshot(udid, outputPath) {
    const result = run(`baguette screenshot --udid ${quote(udid)} --output ${quote(outputPath)}${this.deviceSetArg()}`);
    return toStatus(result);
  }

  /**
   * Captures the on-screen accessibility tree.
   * @param {string} udid Simulator UDID.
   * @param {string} outputPath Output JSON path.
   * @returns {{ok:boolean, message:string}}
   */
  accessibilityTree(udid, outputPath) {
    const result = run(`baguette describe-ui --udid ${quote(udid)} --output ${quote(outputPath)}${this.deviceSetArg()}`);
    return toStatus(result);
  }

  /**
   * Collects a bounded sample of simulator logs.
   * @param {string} udid Simulator UDID.
   * @param {string} outputPath Output log path.
   * @param {object} [options] Log options.
   * @param {number} [options.durationMs] Capture duration in milliseconds.
   * @param {string|null} [options.bundleId] Optional process/bundle filter.
   * @returns {Promise<{ok:boolean, message:string, timedOut:boolean}>}
   */
  async logs(udid, outputPath, options = {}) {
    const durationMs = options.durationMs ?? 3000;
    const bundleIdArg = options.bundleId ? ` --bundle-id ${quote(options.bundleId)}` : '';
    const command = `baguette logs --udid ${quote(udid)} --style json${bundleIdArg}${this.deviceSetArg()}`;
    const result = await runFor(command, { timeoutMs: durationMs });

    fs.writeFileSync(outputPath, result.stdout);

    return {
      ok: result.timedOut || result.status === 0,
      message: trimMessage(result.stderr || result.stdout || ''),
      timedOut: result.timedOut
    };
  }

  /**
   * Builds the optional `--device-set` argument.
   * @returns {string} Shell-ready argument suffix.
   */
  deviceSetArg() {
    return this.deviceSet ? ` --device-set ${quote(this.deviceSet)}` : '';
  }
}

/**
 * Converts a shell result to a small status object.
 * @param {{status:number|null, stdout:string, stderr:string}} result Shell result.
 * @returns {{ok:boolean, message:string}}
 */
function toStatus(result) {
  return {
    ok: result.status === 0,
    message: trimMessage(result.stdout || result.stderr || '')
  };
}

/**
 * Keeps status messages readable inside evidence manifests.
 * @param {string} value Raw command output.
 * @returns {string} Trimmed status text.
 */
function trimMessage(value) {
  const text = value.trim();
  return text.length > 500 ? `${text.slice(0, 497)}...` : text;
}
