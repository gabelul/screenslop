import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkForeground, readFrontmostApp, resolveExpectedApp } from '../src/evidence/foreground.mjs';

/**
 * Writes an accessibility tree to a temp file.
 * @param {object|string} tree Tree to serialise, or raw text.
 * @returns {string} File path.
 */
function writeTree(tree) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-foreground-'));
  const file = path.join(dir, 'accessibility.json');
  fs.writeFileSync(file, typeof tree === 'string' ? tree : JSON.stringify(tree));
  return file;
}

const resolved = (name) => ({ status: 'resolved', name });
const unknown = () => ({ status: 'unknown', name: null });
const notInstalled = () => ({ status: 'not-installed', name: null });

test('reads the frontmost app name from the accessibility root', () => {
  assert.equal(readFrontmostApp(writeTree({ role: 'AXApplication', label: 'PetPacket' })), 'PetPacket');
  assert.equal(readFrontmostApp(writeTree({ role: 'AXApplication', label: '  PetPacket  ' })), 'PetPacket');
});

test('reports no frontmost app for the springboard and for unreadable trees', () => {
  // The iOS home screen reports an empty root label. That is the capture that
  // started this: a bundle full of Apple's springboard, labelled as the app.
  assert.equal(readFrontmostApp(writeTree({ role: 'AXApplication', label: '' })), null);
  assert.equal(readFrontmostApp(writeTree({ role: 'AXApplication' })), null);
  assert.equal(readFrontmostApp(writeTree('{ not json')), null);
  assert.equal(readFrontmostApp('/nowhere/accessibility.json'), null);
});

test('an empty frontmost app is a mismatch when an app was configured', () => {
  const verdict = checkForeground({ observed: null, expected: resolved('PetPacket') });
  assert.equal(verdict.status, 'mismatch');
  assert.match(verdict.message, /home screen/);
});

test('a different app on screen is a mismatch', () => {
  const verdict = checkForeground({ observed: 'Settings', expected: resolved('PetPacket') });
  assert.equal(verdict.status, 'mismatch');
  assert.equal(verdict.observed, 'Settings');
  assert.equal(verdict.expected, 'PetPacket');
});

test('the configured app on screen matches, case-insensitively', () => {
  assert.equal(checkForeground({ observed: 'PetPacket', expected: resolved('PetPacket') }).status, 'match');
  assert.equal(checkForeground({ observed: 'petpacket', expected: resolved('PetPacket') }).status, 'match');
});

test('no configured bundle id leaves the check unverified rather than failing', () => {
  // Without config there is nothing to compare against. Failing here would
  // reject captures over a missing config field, not a wrong app.
  const verdict = checkForeground({ observed: 'PetPacket', expected: unknown() });
  assert.equal(verdict.status, 'unverified');
  assert.equal(verdict.observed, 'PetPacket');

  const blind = checkForeground({ observed: null, expected: unknown() });
  assert.equal(blind.status, 'unverified');
});

test('an app missing from the simulator is a mismatch, not an unknown', () => {
  // The capture that started this: the app was installed on a different
  // simulator, so nothing on this one could have been it. Treating that as
  // "cannot verify" is what let a screenshot of the iOS home screen through.
  const verdict = checkForeground({ observed: null, expected: notInstalled() });
  assert.equal(verdict.status, 'mismatch');
  assert.match(verdict.message, /not installed on this simulator/);
  // Bundle ids are a redacted identifier here, so the message must not name one.
  assert.doesNotMatch(verdict.message, /com\./);
});

test('resolves an installed app display name from its bundle id', () => {
  const result = resolveExpectedApp('UDID', 'com.example.app', {
    runSimctl: () => '<plist/>',
    runPlutil: () => JSON.stringify({
      'com.example.app': { CFBundleDisplayName: 'Example', CFBundleName: 'ExampleInternal' }
    })
  });
  assert.deepEqual(result, { status: 'resolved', name: 'Example' });
});

test('separates an app that is absent from a lookup that did not work', () => {
  const resolve = (apps) => resolveExpectedApp('UDID', 'com.example.app', {
    runSimctl: () => '<plist/>',
    runPlutil: () => JSON.stringify(apps)
  });
  assert.deepEqual(resolve({ 'com.example.app': { CFBundleName: 'Fallback' } }), { status: 'resolved', name: 'Fallback' });
  // Listed but nameless: present, so not a mismatch, but nothing to compare.
  assert.deepEqual(resolve({ 'com.example.app': {} }), { status: 'unknown', name: null });
  // Absent from a listing that worked: decisive.
  assert.deepEqual(resolve({ 'com.other.app': { CFBundleName: 'Other' } }), { status: 'not-installed', name: null });
});

test('a broken toolchain is unknown, never a verdict', () => {
  const result = resolveExpectedApp('UDID', 'com.example.app', {
    runSimctl: () => { throw new Error('xcrun missing'); }
  });
  assert.deepEqual(result, { status: 'unknown', name: null });
});

test('resolution is skipped entirely without a udid or bundle id', () => {
  let called = false;
  const spy = () => { called = true; return '<plist/>'; };
  assert.deepEqual(resolveExpectedApp('UDID', null, { runSimctl: spy }), { status: 'unknown', name: null });
  assert.deepEqual(resolveExpectedApp(null, 'com.example.app', { runSimctl: spy }), { status: 'unknown', name: null });
  assert.equal(called, false, 'must not shell out when there is nothing to resolve');
});
