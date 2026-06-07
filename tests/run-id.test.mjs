import test from 'node:test';
import assert from 'node:assert/strict';
import { createRunId } from '../src/evidence/run-id.mjs';

test('createRunId builds stable slugs', () => {
  const id = createRunId('Settings Screen', new Date('2026-06-07T10:30:00.000Z'));
  assert.equal(id, '2026-06-07T10-30-00Z-settings-screen');
});
