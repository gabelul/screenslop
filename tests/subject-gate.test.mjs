import test from 'node:test';
import assert from 'node:assert/strict';
import { applySubjectGate, compareSubjects, readSubject } from '../src/verify/subject-gate.mjs';

const subjectOf = (app, screen, surface) => ({ app, screen, surface });

test('reads the capture subject out of a manifest', () => {
  const manifest = {
    surface: 'home',
    capture: { foreground: { observed: 'PetPacket', screenTitle: 'Reminders', declaredSurface: 'home' } }
  };
  assert.deepEqual(readSubject(manifest), { app: 'PetPacket', screen: 'Reminders', surface: 'home' });
});

test('a manifest without a foreground record yields an empty subject', () => {
  // Bundles written before this existed must not be read as a disagreement.
  assert.deepEqual(readSubject({}), { app: null, screen: null, surface: null });
  assert.deepEqual(readSubject({ surface: 'home' }), { app: null, screen: null, surface: 'home' });
});

test('different apps are the strongest disagreement', () => {
  const verdict = compareSubjects(subjectOf('PetPacket', 'Pets', 'home'), subjectOf('Settings', 'Pets', 'home'));
  assert.equal(verdict.status, 'different-app');
});

test('different headings under the same app read as different screens', () => {
  // The real case: the app resumed on a different tab and both bundles were
  // still labelled "home", so nothing downstream could tell.
  const verdict = compareSubjects(subjectOf('PetPacket', 'Pets', 'home'), subjectOf('PetPacket', 'Reminders', 'home'));
  assert.equal(verdict.status, 'different-screen');
  assert.match(verdict.reason, /Pets/);
  assert.match(verdict.reason, /Reminders/);
});

test('matching subjects agree, case-insensitively', () => {
  assert.equal(compareSubjects(subjectOf('PetPacket', 'Pets', 'home'), subjectOf('petpacket', 'pets', 'Home')).status, 'same');
});

test('a renamed surface alone is not a disagreement', () => {
  // Surface names are operator claims. Gating on them would withdraw proof for
  // a rename, and would have missed the bug this gate exists for: two bundles
  // both labelled "home" showing different screens.
  const verdict = compareSubjects(subjectOf('PetPacket', 'Pets', 'baseline'), subjectOf('PetPacket', 'Pets', 'fresh'));
  assert.equal(verdict.status, 'same');
});

test('an unrecorded field never counts as a disagreement', () => {
  assert.equal(compareSubjects(subjectOf(null, null, null), subjectOf('PetPacket', 'Pets', 'home')).status, 'same');
  assert.equal(compareSubjects(subjectOf('PetPacket', 'Pets', 'home'), subjectOf(null, null, null)).status, 'same');
});

test('a mismatched subject withdraws verified-fixed', () => {
  const items = [
    { id: 'a', status: 'verified-fixed', confidence: 'high', note: 'Gone from the fresh capture.' },
    { id: 'b', status: 'still-present', confidence: 'high' },
    { id: 'c', status: 'needs-human-review', confidence: 'low' }
  ];
  const gated = applySubjectGate(items, { status: 'different-screen', reason: 'Different screens.' });

  // A finding that vanished because a different screen was captured was not
  // fixed — it was never looked at.
  assert.equal(gated[0].status, 'needs-human-review');
  assert.equal(gated[0].confidence, 'low');
  assert.match(gated[0].note, /Different screens\./);
  assert.match(gated[0].note, /Gone from the fresh capture\./);
  // Still-present across mismatched subjects is a node-path coincidence.
  assert.equal(gated[1].confidence, 'medium');
  assert.equal(gated[2].status, 'needs-human-review');
});

test('a matching subject leaves every verdict untouched', () => {
  const items = [{ id: 'a', status: 'verified-fixed', confidence: 'high' }];
  assert.deepEqual(applySubjectGate(items, { status: 'same', reason: null }), items);
  assert.deepEqual(applySubjectGate(items, null), items);
});
