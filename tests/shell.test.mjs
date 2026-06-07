import test from 'node:test';
import assert from 'node:assert/strict';
import { runFor } from '../src/runtime/shell.mjs';

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
