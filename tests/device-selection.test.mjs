import test from 'node:test';
import assert from 'node:assert/strict';
import { isBooted, resolveCaptureDevice, selectBaguetteDevice } from '../src/runtime/device-selection.mjs';

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

test('resolveCaptureDevice prefers config over a mismatched booted simulator', () => {
  const selection = resolveCaptureDevice(envelope, { configuredDeviceName: 'iPad mini' });
  assert.equal(selection.device.udid, 'AVAILABLE-1');
  assert.equal(selection.source, 'config');
  assert.equal(selection.notes.length, 1);
  assert.match(selection.notes[0], /iPhone 17 Pro is booted but config targets "iPad mini"/);
});

test('resolveCaptureDevice stays quiet when config and the booted simulator agree', () => {
  const selection = resolveCaptureDevice(envelope, { configuredDeviceName: 'iPhone 17 Pro' });
  assert.equal(selection.device.udid, 'RUNNING-1');
  assert.equal(selection.source, 'config');
  assert.deepEqual(selection.notes, []);
});

test('resolveCaptureDevice falls back and warns when config names a deleted simulator', () => {
  const selection = resolveCaptureDevice(envelope, { configuredDeviceName: 'iPhone Air' });
  assert.equal(selection.device.udid, 'RUNNING-1');
  assert.equal(selection.source, 'booted');
  assert.match(selection.notes[0], /no simulator matched it/);
});

test('resolveCaptureDevice lets explicit flags beat config', () => {
  const selection = resolveCaptureDevice(envelope, { deviceName: 'mini', configuredDeviceName: 'iPhone 17 Pro' });
  assert.equal(selection.device.udid, 'AVAILABLE-1');
  assert.equal(selection.source, 'device-flag');
});

test('resolveCaptureDevice fails hard when an explicit device is missing', () => {
  const selection = resolveCaptureDevice(envelope, { deviceName: 'Vision Pro', configuredDeviceName: 'iPad mini' });
  assert.equal(selection.device, null);
  assert.equal(selection.reason, 'device-not-found');
});

test('resolveCaptureDevice without config keeps the booted simulator', () => {
  const selection = resolveCaptureDevice(envelope);
  assert.equal(selection.device.udid, 'RUNNING-1');
  assert.equal(selection.source, 'booted');
});
