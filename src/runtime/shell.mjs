import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Checks whether a command is available on PATH.
 * @param {string} command Command name to look up.
 * @returns {boolean} True when the command can be executed.
 */
export function hasCommand(command) {
  const result = spawnShellSync(`command -v ${quote(command)} >/dev/null 2>&1`);
  return result.status === 0;
}

/**
 * Runs a command and returns stdout, stderr, and status without throwing.
 * @param {string} command Shell command to execute.
 * @returns {{status:number|null, stdout:string, stderr:string}}
 */
export function run(command) {
  const result = spawnShellSync(command, {
    maxBuffer: 10 * 1024 * 1024
  });
  return {
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? ''
  };
}

/**
 * Runs a command for a bounded amount of time and returns captured output.
 * @param {string} command Shell command to execute.
 * @param {object} [options] Runtime options.
 * @param {number} [options.timeoutMs] Maximum time before SIGTERM.
 * @returns {Promise<{status:number|null, stdout:string, stderr:string, timedOut:boolean}>}
 */
export function runFor(command, options = {}) {
  const timeoutMs = options.timeoutMs ?? 3000;

  return new Promise((resolve) => {
    const child = spawn(resolveShell(), ['-c', command], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });

    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, stdout, stderr, timedOut });
    });
  });
}

/**
 * Returns the shell used for small local commands.
 * @returns {string} Absolute shell path or shell name.
 */
export function resolveShell() {
  const configuredShell = process.env.SCREENSLOP_SHELL || process.env.SHELL;
  if (configuredShell && shellExists(configuredShell)) {
    return configuredShell;
  }
  return '/bin/sh';
}

/**
 * Runs a command through the resolved shell without assuming zsh is installed.
 * @param {string} command Shell command to execute.
 * @param {object} [options] spawnSync options.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Spawn result.
 */
function spawnShellSync(command, options = {}) {
  return spawnSync(resolveShell(), ['-c', command], {
    encoding: 'utf8',
    ...options
  });
}

/**
 * Checks whether a configured shell can be spawned on this machine.
 * @param {string} shell Shell path or command name.
 * @returns {boolean} True when the shell exists.
 */
function shellExists(shell) {
  if (path.isAbsolute(shell)) {
    return existsSync(shell);
  }

  return (process.env.PATH ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .some((directory) => existsSync(path.join(directory, shell)));
}

/**
 * Quotes a single shell token.
 * @param {string} value Token to quote.
 * @returns {string} Shell-safe token.
 */
export function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}
