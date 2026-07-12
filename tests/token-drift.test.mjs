import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBmp, parseBmp } from '../src/critique/pixels.mjs';
import { detectTokenDrift } from '../src/design/token-drift.mjs';

// The profile's learned accent: #E8590C = rgb(232, 89, 12).
const profileAccent = { r: 232, g: 89, b: 12, hex: '#E8590C' };

/**
 * Builds a minimal design profile shaped like profile.mjs output.
 * @param {object[]} colorTokens Color token records.
 * @returns {object} Synthetic profile.
 */
function profileWith(colorTokens) {
  return {
    schemaVersion: 1,
    project: { name: 'DriftApp', platform: 'ios' },
    tokens: {
      colors: colorTokens,
      typography: [],
      spacing: [],
      cornerRadii: [],
      materials: [],
      icons: []
    }
  };
}

/**
 * Builds a token record shaped like profile.mjs tokenRecord output.
 * @param {string} name Token name.
 * @param {string} value Token value text.
 * @returns {object} Token record.
 */
function colorToken(name, value) {
  return { name, value, source: 'Sources/Theme.swift', sourceKind: 'swiftui-source', extraction: 'swift-color-hex', confidence: 'high' };
}

/**
 * Builds a pixel accessor for a uniformly filled synthetic screen.
 * @param {{r:number,g:number,b:number}} fill Fill color.
 * @returns {object} Pixel accessor from parseBmp.
 */
function solidImage(fill) {
  return parseBmp(buildBmp(64, 48, () => fill));
}

const knownProfile = profileWith([
  colorToken('Theme.accent.hex', '#E8590C'),
  colorToken('Theme.asset', 'Color("AccentColor")') // no hex — must be skipped, not guessed
]);

test('flags a screen accent far from every profile token as design.token-drift', () => {
  const image = solidImage({ r: 51, g: 102, b: 255 }); // #3366FF, nowhere near #E8590C
  const items = detectTokenDrift({ profile: knownProfile, image });
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.ruleId, 'design.token-drift');
  assert.equal(item.kind, 'design');
  assert.equal(item.severity, 'P3');
  assert.equal(item.confidence, 'low');
  assert.equal(item.screenColor, '#3366FF');
  assert.equal(item.nearestToken, profileAccent.hex);
  assert.ok(item.distance > 60);
  assert.ok(item.share > 0.9, 'a solid accent screen should own nearly all chromatic samples');
  assert.match(item.detail, /profile/i);
  assert.match(item.detail, /stale/i);
  assert.doesNotMatch(item.detail, /verified-fixed/i);
});

test('stays quiet when the screen accent matches a profile token', () => {
  const image = solidImage(profileAccent); // distance 0 from the learned token
  assert.deepEqual(detectTokenDrift({ profile: knownProfile, image }), []);
});

test('flags a near-token accent (~40 RGB distance) as design.token-near-miss', () => {
  const image = solidImage({ r: 232, g: 129, b: 12 }); // #E8810C, exactly 40 from #E8590C
  const items = detectTokenDrift({ profile: knownProfile, image });
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.ruleId, 'design.token-near-miss');
  assert.equal(item.screenColor, '#E8810C');
  assert.equal(item.nearestToken, profileAccent.hex);
  assert.equal(item.distance, 40);
  assert.match(item.detail, /magic-number|approximation/i);
});

test('returns [] for a null image and for profiles without usable color tokens', () => {
  const image = solidImage({ r: 51, g: 102, b: 255 });
  assert.deepEqual(detectTokenDrift({ profile: knownProfile, image: null }), []);
  assert.deepEqual(detectTokenDrift({ profile: null, image }), []);
  assert.deepEqual(detectTokenDrift({ profile: {}, image }), []);
  assert.deepEqual(detectTokenDrift({ profile: profileWith([]), image }), []);
  // Tokens exist but none carry a parseable hex — do not guess.
  assert.deepEqual(detectTokenDrift({ profile: profileWith([colorToken('Theme.asset', 'Color("Brand")')]), image }), []);
});

test('returns [] for a neutral-only screen', () => {
  const gray = parseBmp(buildBmp(64, 48, (x) => {
    const shade = 96 + (x % 4) * 8; // grays and near-grays only
    return { r: shade, g: shade, b: shade + 6 };
  }));
  assert.deepEqual(detectTokenDrift({ profile: knownProfile, image: gray }), []);
});

test('produces identical output across two runs on the same evidence', () => {
  // Two chromatic regions: a dominant unknown blue and a smaller unknown green.
  const image = parseBmp(buildBmp(64, 48, (x) => (
    x < 40 ? { r: 51, g: 102, b: 255 } : { r: 34, g: 204, b: 68 }
  )));
  const first = detectTokenDrift({ profile: knownProfile, image });
  const second = detectTokenDrift({ profile: knownProfile, image });
  assert.deepEqual(first, second);
  assert.equal(first.length, 2);
  assert.ok(first[0].share >= first[1].share, 'largest accent share must come first');
});
