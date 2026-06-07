import { runFor } from '../runtime/shell.mjs';

/**
 * Runs an optional bounded verification command for a fix session.
 * @param {string|null} command Command to run.
 * @param {object} [options] Verification options.
 * @param {number} [options.timeoutMs] Timeout in milliseconds.
 * @returns {Promise<object|null>} Verification result.
 */
export async function verifyFix(command, options = {}) {
  if (!command) return null;
  const result = await runFor(command, { timeoutMs: options.timeoutMs ?? 60000 });
  const passed = result.status === 0 && !result.timedOut;

  return {
    command,
    status: passed ? 'verify-passed' : 'verify-failed',
    exitCode: result.status,
    timedOut: result.timedOut,
    stdout: result.stdout,
    stderr: result.stderr
  };
}
