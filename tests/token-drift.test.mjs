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
 * @param {string} [layer] Optional token layer; omitted to mimic pre-layer profiles.
 * @returns {object} Token record.
 */
function colorToken(name, value, layer) {
  return {
    name,
    value,
    source: 'Sources/Theme.swift',
    sourceKind: 'swiftui-source',
    extraction: 'swift-color-hex',
    confidence: 'high',
    ...(layer ? { layer } : {})
  };
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

test('calls a darkened token variant derived rather than unknown drift', () => {
  // Real measurement: a warning token #D4A441 rendered as #8A6410. RGB distance
  // is 109, so the old path called it a color the profile never learned.
  const profile = profileWith([colorToken('Theme.warning', '#D4A441', 'semantic')]);
  const items = detectTokenDrift({ profile, image: solidImage({ r: 138, g: 100, b: 16 }) });

  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.ruleId, 'design.token-derived-variant');
  assert.equal(item.nearestTokenName, 'Theme.warning');
  assert.equal(item.severity, 'P3');
  assert.ok(item.lightnessDelta < 0, 'the variant is darker than its token');
  assert.match(item.detail, /derived variant, not an unknown accent/);
  assert.match(item.detail, /stale/i);
});

test('a genuinely unknown accent is still reported as drift', () => {
  // Guard against the derived-variant path swallowing real drift: #3366FF
  // shares no hue family with the orange token.
  const items = detectTokenDrift({ profile: knownProfile, image: solidImage({ r: 51, g: 102, b: 255 }) });
  assert.equal(items[0].ruleId, 'design.token-drift');
});

test('same-hue tokens make a derived variant ambiguous rather than named', () => {
  const profile = profileWith([
    colorToken('Theme.success', '#A7B89A', 'semantic'),
    colorToken('Theme.successContainer', '#AFC0A2', 'semantic')
  ]);
  const items = detectTokenDrift({ profile, image: solidImage({ r: 91, g: 107, b: 79 }) });

  assert.equal(items.length, 1);
  assert.equal(items[0].ruleId, 'design.token-derived-variant');
  assert.equal(items[0].nearestTokenName, null);
  assert.equal(items[0].confidence, 'low');
  assert.match(items[0].detail, /cannot say which token/);
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

test('keeps working with pre-layer profiles and reports nearest token name and layer', () => {
  const image = solidImage({ r: 51, g: 102, b: 255 });
  const items = detectTokenDrift({ profile: knownProfile, image }); // knownProfile tokens carry no layer field
  assert.equal(items.length, 1);
  assert.equal(items[0].nearestTokenName, 'Theme.accent.hex');
  assert.equal(items[0].nearestTokenLayer, 'unknown');
});

test('prefers a semantic role over a slightly-closer primitive when the distances tie', () => {
  // Screen #3366FF; primitive sits at RGB distance 92, semantic role at 95 —
  // inside the 5-point tie band, so the role is reported as nearest.
  const profile = profileWith([
    colorToken('PrimitiveColors.blue500', '#3366A3', 'primitive'),
    colorToken('ColorPalette.primary', '#3366A0', 'semantic')
  ]);
  const items = detectTokenDrift({ profile, image: solidImage({ r: 51, g: 102, b: 255 }) });
  assert.equal(items.length, 1);
  assert.equal(items[0].ruleId, 'design.token-drift');
  assert.equal(items[0].nearestToken, '#3366A0');
  assert.equal(items[0].nearestTokenName, 'ColorPalette.primary');
  assert.equal(items[0].nearestTokenLayer, 'semantic');
});

test('a semantic alias with only a resolvedValue joins matching and wins the tie-break', () => {
  // The role's own value is a reference, not a hex — only resolvedValue
  // (stamped by the profile's alias-resolution pass) carries the color.
  const profile = profileWith([
    colorToken('PrimitiveColors.blue500', '#3366A3', 'primitive'),
    {
      name: 'LightTheme.primary',
      value: 'PrimitiveColors.blue499', // deliberately not the extracted primitive so only resolvedValue can match
      source: 'Sources/Themes/Light/LightTheme.swift',
      sourceKind: 'swiftui-source',
      extraction: 'swift-color-alias',
      confidence: 'medium',
      layer: 'semantic',
      resolvedValue: '#3366A0'
    }
  ]);
  const items = detectTokenDrift({ profile, image: solidImage({ r: 51, g: 102, b: 255 }) });
  assert.equal(items.length, 1);
  assert.equal(items[0].nearestToken, '#3366A0');
  assert.equal(items[0].nearestTokenName, 'LightTheme.primary');
  assert.equal(items[0].nearestTokenLayer, 'semantic');
});

test('reports the semantic record when a role aliases a primitive at the same hex', () => {
  const profile = profileWith([
    colorToken('PrimitiveColors.blue500', '#3366A0', 'primitive'),
    colorToken('ColorPalette.primary', '#3366A0', 'semantic')
  ]);
  const items = detectTokenDrift({ profile, image: solidImage({ r: 51, g: 102, b: 255 }) });
  assert.equal(items.length, 1);
  assert.equal(items[0].nearestTokenName, 'ColorPalette.primary');
  assert.equal(items[0].nearestTokenLayer, 'semantic');
});

test('names the semantic alternative when a primitive is nearest but a role is also in the near-miss band', () => {
  // Screen #3366FF; primitive at distance 40 (outside the tie band from the
  // role at 55), so the primitive stays nearest — but the detail must nudge
  // toward the role.
  const profile = profileWith([
    colorToken('PrimitiveColors.blue500', '#3366D7', 'primitive'),
    colorToken('ColorPalette.primary', '#3366C8', 'semantic')
  ]);
  const items = detectTokenDrift({ profile, image: solidImage({ r: 51, g: 102, b: 255 }) });
  assert.equal(items.length, 1);
  const item = items[0];
  assert.equal(item.ruleId, 'design.token-near-miss');
  assert.equal(item.nearestToken, '#3366D7');
  assert.equal(item.nearestTokenLayer, 'primitive');
  assert.match(item.detail, /semantic role ColorPalette\.primary/);
  assert.match(item.detail, /prefer the role over the raw primitive/);
});

test('does not name a semantic alternative that sits beyond the near-miss band', () => {
  // Primitive at distance 40, role at distance 95 — too far to recommend.
  const profile = profileWith([
    colorToken('PrimitiveColors.blue500', '#3366D7', 'primitive'),
    colorToken('ColorPalette.primary', '#3366A0', 'semantic')
  ]);
  const items = detectTokenDrift({ profile, image: solidImage({ r: 51, g: 102, b: 255 }) });
  assert.equal(items.length, 1);
  assert.equal(items[0].nearestTokenLayer, 'primitive');
  assert.doesNotMatch(items[0].detail, /prefer the role/);
});

test('semantic tie-break never turns an on-token accent into a finding', () => {
  // Screen sits exactly on the primitive (distance 0); the role 4 away wins
  // the tie, but the accent is still on-token, so nothing is reported.
  const profile = profileWith([
    colorToken('PrimitiveColors.blue500', '#3366FF', 'primitive'),
    colorToken('ColorPalette.primary', '#3366FB', 'semantic')
  ]);
  assert.deepEqual(detectTokenDrift({ profile, image: solidImage({ r: 51, g: 102, b: 255 }) }), []);
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
