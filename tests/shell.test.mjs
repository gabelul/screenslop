import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCommand, resolveShell, run, runFor } from '../src/runtime/shell.mjs';

test('runFor captures normal command output', async () => {
  const result = await runFor('/bin/echo hello', { timeoutMs: 5000 });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'hello\n');
  assert.equal(result.stderr, '');
  assert.equal(result.timedOut, false);
});

test('runFor marks timed out commands', async () => {
  const result = await runFor('node -e "setInterval(() => {}, 1000)"', { timeoutMs: 100 });
  assert.equal(result.timedOut, true);
});

test('resolveShell falls back when configured shell is missing', () => {
  const originalScreenslopShell = process.env.SCREENSLOP_SHELL;
  const originalShell = process.env.SHELL;
  process.env.SCREENSLOP_SHELL = '';
  process.env.SHELL = '/screenslop/missing/zsh';

  try {
    assert.equal(resolveShell(), '/bin/sh');
  } finally {
    restoreEnv('SCREENSLOP_SHELL', originalScreenslopShell);
    restoreEnv('SHELL', originalShell);
  }
});

test('run and hasCommand use the missing-shell fallback', () => {
  const originalScreenslopShell = process.env.SCREENSLOP_SHELL;
  const originalShell = process.env.SHELL;
  process.env.SCREENSLOP_SHELL = '';
  process.env.SHELL = '/screenslop/missing/zsh';

  try {
    const result = run('/bin/echo fallback');
    assert.equal(result.status, 0);
    assert.equal(result.stdout, 'fallback\n');
    assert.equal(hasCommand('node'), true);
  } finally {
    restoreEnv('SCREENSLOP_SHELL', originalScreenslopShell);
    restoreEnv('SHELL', originalShell);
  }
});

/**
 * Restores an environment variable without converting undefined to a string.
 * @param {string} name Environment variable name.
 * @param {string|undefined} value Original value.
 * @returns {void}
 */
function restoreEnv(name, value) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
