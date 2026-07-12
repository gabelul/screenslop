import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenAxTree } from '../src/critique/ax-tree.mjs';
import { detectHigPatternIssues } from '../src/critique/detectors/hig-patterns.mjs';

const context = { artifacts: { accessibilityTree: { displayPath: 'accessibility.json' } } };

/**
 * Builds a phone-sized AX tree around the given child nodes.
 * @param {object[]} children Child AX nodes.
 * @param {object} [frame] Root frame override.
 * @returns {object[]} Flattened nodes.
 */
function phoneTree(children, frame = { x: 0, y: 0, width: 402, height: 874 }) {
  return flattenAxTree({
    role: 'AXApplication',
    label: 'HIG App',
    enabled: true,
    hidden: false,
    frame,
    children
  });
}

function button(label, frame, extra = {}) {
  return { role: 'AXButton', label, enabled: true, hidden: false, frame, ...extra };
}

function text(label, frame) {
  return { role: 'AXStaticText', label, enabled: true, hidden: false, frame };
}

function findRule(findings, ruleId) {
  return findings.filter((finding) => finding.ruleId === ruleId);
}

// --- layout.empty-state-dead-end ---

test('flags an empty state with only navigation chrome to tap', () => {
  const nodes = phoneTree([
    button('Back', { x: 16, y: 60, width: 60, height: 30 }),
    text('No items yet', { x: 100, y: 400, width: 200, height: 24 })
  ]);
  const findings = detectHigPatternIssues(context, nodes);
  const [hit] = findRule(findings, 'layout.empty-state-dead-end');
  assert.ok(hit, 'expected an empty-state dead-end finding');
  assert.equal(hit.severity, 'P2');
  assert.equal(hit.pillar, 'layout');
  assert.match(hit.detail, /No items yet/);
  assert.ok(hit.evidence.screenshotRegion);
});

test('does not flag an empty state that offers an Add call-to-action', () => {
  const nodes = phoneTree([
    button('Back', { x: 16, y: 60, width: 60, height: 30 }),
    text('No items yet', { x: 100, y: 400, width: 200, height: 24 }),
    button('Add item', { x: 120, y: 460, width: 160, height: 44 })
  ]);
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'layout.empty-state-dead-end').length, 0);
});

test('does not flag a screen with no empty-state text at all', () => {
  const nodes = phoneTree([button('Back', { x: 16, y: 60, width: 60, height: 30 })]);
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'layout.empty-state-dead-end').length, 0);
});

// --- platform.hamburger-menu ---

test('flags a top-leading Menu button on a tab-bar-less phone screen', () => {
  const nodes = phoneTree([button('Menu', { x: 16, y: 60, width: 44, height: 30 })]);
  const findings = detectHigPatternIssues(context, nodes);
  const [hit] = findRule(findings, 'platform.hamburger-menu');
  assert.ok(hit, 'expected a hamburger-menu finding');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'platform');
  assert.equal(hit.confidence, 'low');
});

test('does not flag the Menu button when the screen has a tab bar', () => {
  const nodes = phoneTree([
    button('Menu', { x: 16, y: 60, width: 44, height: 30 }),
    { role: 'AXTabBar', label: 'Tab Bar', enabled: true, hidden: false, frame: { x: 0, y: 790, width: 402, height: 84 } }
  ]);
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'platform.hamburger-menu').length, 0);
});

test('does not flag a Menu button outside the top-leading corner', () => {
  const nodes = phoneTree([button('Menu', { x: 16, y: 800, width: 44, height: 30 })]);
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'platform.hamburger-menu').length, 0);
});

test('skips the hamburger check on non-phone surfaces', () => {
  const nodes = phoneTree(
    [button('Menu', { x: 16, y: 60, width: 44, height: 30 })],
    { x: 0, y: 0, width: 820, height: 1180 }
  );
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'platform.hamburger-menu').length, 0);
});

// --- platform.stacked-modals ---

test('flags two overlapping full-screen sheet layers', () => {
  const nodes = phoneTree([
    { role: 'AXSheet', label: 'Settings sheet', enabled: true, hidden: false, frame: { x: 0, y: 80, width: 402, height: 794 } },
    { role: 'AXSheet', label: 'Account sheet', enabled: true, hidden: false, frame: { x: 0, y: 140, width: 402, height: 734 } }
  ]);
  const findings = detectHigPatternIssues(context, nodes);
  const [hit] = findRule(findings, 'platform.stacked-modals');
  assert.ok(hit, 'expected a stacked-modals finding');
  assert.equal(hit.severity, 'P2');
  assert.equal(hit.pillar, 'platform');
  assert.match(hit.detail, /Account sheet/);
  assert.match(hit.evidence.note, /Settings sheet/);
});

test('does not flag a single sheet', () => {
  const nodes = phoneTree([
    { role: 'AXSheet', label: 'Settings sheet', enabled: true, hidden: false, frame: { x: 0, y: 80, width: 402, height: 794 } }
  ]);
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'platform.stacked-modals').length, 0);
});

test('does not flag two small overlapping popovers', () => {
  const nodes = phoneTree([
    { role: 'AXPopover', label: 'Filter popover', enabled: true, hidden: false, frame: { x: 40, y: 200, width: 200, height: 150 } },
    { role: 'AXPopover', label: 'Sort popover', enabled: true, hidden: false, frame: { x: 60, y: 220, width: 200, height: 150 } }
  ]);
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'platform.stacked-modals').length, 0);
});

test('does not flag two full-screen sheets that do not overlap enough', () => {
  const nodes = phoneTree(
    [
      { role: 'AXSheet', label: 'Left sheet', enabled: true, hidden: false, frame: { x: 0, y: 0, width: 402, height: 874 } },
      { role: 'AXSheet', label: 'Right sheet', enabled: true, hidden: false, frame: { x: 380, y: 0, width: 402, height: 874 } }
    ],
    // Wide root so both frames can clear 50% coverage while barely touching.
    { x: 0, y: 0, width: 782, height: 874 }
  );
  const findings = detectHigPatternIssues(context, nodes);
  assert.equal(findRule(findings, 'platform.stacked-modals').length, 0);
});

// --- determinism ---

test('produces stable fingerprint-backed ids across runs', () => {
  const nodes = phoneTree([
    text('No items yet', { x: 100, y: 400, width: 200, height: 24 }),
    // Identifier marks it as navigation chrome so the empty-state rule fires too.
    button('Menu', { x: 16, y: 60, width: 44, height: 30 }, { identifier: 'navigation.menu-button' }),
    { role: 'AXSheet', label: 'Settings sheet', enabled: true, hidden: false, frame: { x: 0, y: 80, width: 402, height: 794 } },
    { role: 'AXSheet', label: 'Account sheet', enabled: true, hidden: false, frame: { x: 0, y: 140, width: 402, height: 734 } }
  ]);
  const first = detectHigPatternIssues(context, nodes);
  const second = detectHigPatternIssues(context, nodes);
  assert.ok(first.length >= 3, 'expected all three rules to fire on the combined tree');
  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});
