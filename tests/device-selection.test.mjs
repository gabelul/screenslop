import test from 'node:test';
import assert from 'node:assert/strict';
import { isBooted, selectBaguetteDevice } from '../src/runtime/device-selection.mjs';

const envelope = {
  running: [{ name: 'iPhone 17 Pro', runtime: 'iOS 26.5', state: 'Booted', udid: 'RUNNING-1' }],
  available: [{ name: 'iPad mini', runtime: 'iOS 26.5', state: 'Shutdown', udid: 'AVAILABLE-1' }]
};

test('selectBaguetteDevice prefers a booted simulator', () => {
  const selection = selectBaguetteDevice(envelope);
  assert.equal(selection.device.udid, 'RUNNING-1');
  assert.equal(selection.reason, null);
  assert.equal(isBooted(selection.device), true);
});

test('selectBaguetteDevice accepts explicit partial device names', () => {
  const selection = selectBaguetteDevice(envelope, { deviceName: 'mini' });
  assert.equal(selection.device.udid, 'AVAILABLE-1');
  assert.equal(isBooted(selection.device), false);
});

test('selectBaguetteDevice reports missing UDIDs', () => {
  const selection = selectBaguetteDevice(envelope, { udid: 'NOPE' });
  assert.equal(selection.device, null);
  assert.equal(selection.reason, 'udid-not-found');
});
