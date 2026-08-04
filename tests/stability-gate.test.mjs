import assert from 'node:assert/strict';
import test from 'node:test';
import { applyStabilityGate, readStability } from '../src/verify/stability-gate.mjs';

const fixedItem = {
  status: 'verified-fixed',
  confidence: 'high',
  reason: 'Fresh critique no longer reports this rule.'
};
const presentItem = {
  status: 'still-present',
  confidence: 'high',
  reason: 'Fresh critique still contains contrast.'
};

test('readStability normalizes each recorded verdict', () => {
  assert.equal(readStability({ capture: { stability: { status: 'stable', changedRatio: 0 } } }).status, 'stable');
  assert.equal(readStability({ capture: { stability: { status: 'unstable', changedRatio: 0.4 } } }).status, 'unstable');
  assert.equal(readStability({ capture: { stability: { status: 'nonsense' } } }).status, 'not-measured');
  // A bundle captured before stability existed must be recognizable as such.
  assert.equal(readStability({ capture: { status: 'complete' } }).status, 'not-measured');
  assert.equal(readStability(null).status, 'not-measured');
});

test('a stable fresh capture leaves verification untouched', () => {
  const items = applyStabilityGate([fixedItem, presentItem], { status: 'stable', changedRatio: 0, reason: null });
  assert.deepEqual(items, [fixedItem, presentItem]);
});

test('an unstable fresh capture cannot produce verified-fixed', () => {
  // The whole point: a finding may have vanished because the screenshot caught
  // an animation, not because anyone fixed it.
  const items = applyStabilityGate([fixedItem], { status: 'unstable', changedRatio: 0.4, reason: null });
  assert.equal(items[0].status, 'needs-human-review');
  assert.equal(items[0].confidence, 'low');
  assert.match(items[0].reason, /40\.0% of sampled pixels changed/);
  assert.match(items[0].reason, /rather than because it was fixed/);
});

test('an unstable capture does not weaken a still-present finding', () => {
  // Motion can fake the absence of a problem, never its presence.
  const items = applyStabilityGate([presentItem], { status: 'unstable', changedRatio: 0.4, reason: null });
  assert.deepEqual(items[0], presentItem);
});

test('unmeasured stability downgrades confidence without blocking', () => {
  // Blocking here would retroactively invalidate every bundle captured before
  // the stability check existed.
  const items = applyStabilityGate([fixedItem], readStability({ capture: { status: 'complete' } }));
  assert.equal(items[0].status, 'verified-fixed');
  assert.equal(items[0].confidence, 'medium');
  assert.match(items[0].reason, /not a stability-proven result/);
  assert.match(items[0].reason, /predates capture-stability checks/);
});

test('a failed stability probe is treated as unproven, not as proof', () => {
  const stability = readStability({ capture: { stability: { status: 'unknown', reason: 'probe-capture-failed' } } });
  const items = applyStabilityGate([fixedItem], stability);
  assert.equal(items[0].confidence, 'medium');
  assert.match(items[0].reason, /probe-capture-failed/);
});
