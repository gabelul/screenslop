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

test('an unstable capture keeps still-present but stops calling it high confidence', () => {
  // A label caught mid-fade measures a contrast it never has at rest, so a
  // matching fresh finding can itself be an artifact of the motion.
  const items = applyStabilityGate([presentItem], { status: 'unstable', changedRatio: 0.4, reason: null });
  assert.equal(items[0].status, 'still-present');
  assert.equal(items[0].confidence, 'medium');
  assert.match(items[0].reason, /artifact of motion/);
});

test('a bundle with no stability field cannot claim verified-fixed', () => {
  // Keeping old bundles readable is not the same as granting them proof they
  // never established.
  const items = applyStabilityGate([fixedItem], readStability({ capture: { status: 'complete' } }));
  assert.equal(items[0].status, 'needs-human-review');
  assert.equal(items[0].confidence, 'low');
  assert.match(items[0].reason, /cannot be reported as deterministic proof/);
  assert.match(items[0].reason, /predates capture-stability checks/);
});

test('a failed stability probe cannot claim verified-fixed either', () => {
  // Unlike a legacy bundle, this is a live evidence failure.
  const stability = readStability({ capture: { stability: { status: 'unknown', reason: 'probe-capture-failed' } } });
  const items = applyStabilityGate([fixedItem], stability);
  assert.equal(items[0].status, 'needs-human-review');
  assert.match(items[0].reason, /probe-capture-failed/);
});
