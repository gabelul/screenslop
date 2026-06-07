import { spawn, spawnSync } from 'node:child_process';

/**
 * Checks whether a command is available on PATH.
 * @param {string} command Command name to look up.
 * @returns {boolean} True when the command can be executed.
 */
export function hasCommand(command) {
  const result = spawnSync('zsh', ['-lc', `command -v ${quote(command)} >/dev/null 2>&1`], {
    encoding: 'utf8'
  });
  return result.status === 0;
}

/**
 * Runs a command and returns stdout, stderr, and status without throwing.
 * @param {string} command Shell command to execute.
 * @returns {{status:number|null, stdout:string, stderr:string}}
 */
export function run(command) {
  const result = spawnSync('zsh', ['-lc', command], {
    encoding: 'utf8',
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
    const child = spawn('zsh', ['-lc', command], {
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
 * Quotes a single shell token.
 * @param {string} value Token to quote.
 * @returns {string} Shell-safe token.
 */
export function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}
