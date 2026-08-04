import assert from 'node:assert/strict';
import test from 'node:test';
import { attributeColor, describeAttribution, srgbToOklch } from '../src/color/attribution.mjs';

const hex = (value) => ({
  r: parseInt(value.slice(1, 3), 16),
  g: parseInt(value.slice(3, 5), 16),
  b: parseInt(value.slice(5, 7), 16)
});

const token = (name, value) => ({ name, hex: value, ...hex(value) });

// A small palette in the shape a learned design profile produces.
const palette = [
  token('warning', '#D4A441'),
  token('success', '#A7B89A'),
  token('error', '#C4443A'),
  token('surface', '#FCFDFC'),
  token('onSurfaceVariant', '#5A5247')
];

test('srgbToOklch matches published reference values', () => {
  const amber = srgbToOklch(hex('#D4A441'));
  assert.ok(Math.abs(amber.L - 0.745) < 0.002, `L was ${amber.L}`);
  assert.ok(Math.abs(amber.C - 0.127) < 0.002, `C was ${amber.C}`);
  assert.ok(Math.abs(amber.h - 82.4) < 0.5, `h was ${amber.h}`);

  // Pure gray has no chroma and therefore no meaningful hue.
  assert.ok(srgbToOklch({ r: 128, g: 128, b: 128 }).C < 0.001);
});

test('attributes a darkened variant back to its token, measured from a real device', () => {
  // Real capture: the warning token rendered as small text came out #8A6410.
  const result = attributeColor(hex('#8A6410'), palette);
  assert.equal(result.status, 'derived');
  assert.equal(result.token.name, 'warning');
  assert.ok(result.lightnessDelta < 0, 'expected the variant to be darker');
  assert.match(describeAttribution(result), /`warning` token \(#D4A441\) rendered 22 OKLCh lightness points darker/);
});

test('attributes a low-chroma derived variant that RGB distance would miss', () => {
  // #5B6B4F sits 132 away from #A7B89A in RGB — past any "unknown color" band.
  const result = attributeColor(hex('#5B6B4F'), palette);
  assert.equal(result.status, 'derived');
  assert.equal(result.token.name, 'success');
});

test('reports a raw token as exact rather than derived', () => {
  const result = attributeColor(hex('#D4A441'), palette);
  assert.equal(result.status, 'exact');
  assert.equal(result.token.name, 'warning');
  assert.equal(result.lightnessDelta, 0);
  assert.match(describeAttribution(result), /rendered directly/);
});

test('refuses to name a token for untraceable near-neutral colors', () => {
  // HSL would report healthy saturation for some of these; OKLCh chroma does not.
  for (const value of ['#8A8A8A', '#6E6E72', '#2B2B2E']) {
    const result = attributeColor(hex(value), palette);
    assert.equal(result.status, 'neutral', `${value} should be neutral`);
    assert.equal(result.token, null);
    assert.match(describeAttribution(result), /near-neutral/);
  }
});

test('a neutral that sits on a neutral token is still named', () => {
  // The direct-match check runs before the chroma floor on purpose: a sample
  // that IS a token should be named even when the token itself is a near-white.
  // #F4F4F5 is 13.9 from #FCFDFC — within capture noise, but not equal, so it
  // reports `close` rather than claiming the token was rendered directly.
  const result = attributeColor(hex('#F4F4F5'), palette);
  assert.equal(result.status, 'close');
  assert.equal(result.token.name, 'surface');
  assert.match(describeAttribution(result), /to within capture noise/);
});

test('exact is reserved for an actual equal match', () => {
  const result = attributeColor(hex('#FCFDFC'), palette);
  assert.equal(result.status, 'exact');
  assert.equal(result.confidence, 'high');
});

test('two tokens inside the noise band are ambiguous, not decided by array order', () => {
  const twins = [token('First', '#FCFDFC'), token('Second', '#F8F9F8')];
  const sample = hex('#FAFBFA');

  const forward = attributeColor(sample, twins);
  const reversed = attributeColor(sample, [...twins].reverse());

  assert.equal(forward.status, 'ambiguous');
  assert.equal(reversed.status, 'ambiguous');
  assert.equal(forward.token, null);
  assert.equal(forward.candidates.length, 2);
});

test('rejects colors with non-finite or out-of-range channels', () => {
  for (const bad of [{ r: NaN, g: 100, b: 16 }, { r: Infinity, g: 100, b: 16 }, { r: -5, g: 100, b: 16 }, { r: 300, g: 100, b: 16 }]) {
    const result = attributeColor(bad, palette);
    assert.equal(result.status, 'unknown', `${JSON.stringify(bad)} should not attribute`);
    assert.equal(result.token, null);
  }
  // A malformed token must not poison an otherwise valid attribution.
  const withBadToken = attributeColor(hex('#8A6410'), [{ name: 'broken', hex: '#zz', r: NaN, g: 0, b: 0 }, ...palette]);
  assert.equal(withBadToken.token.name, 'warning');
});

test('a sample another token explains as an opacity blend is ambiguous', () => {
  // Blending shifts hue when the background is chromatic, so a token drawn at
  // partial opacity over a colored surface can land squarely in a *different*
  // token's hue family. Here the sample is the error token at 50% over a blue
  // card, which hue matching alone confidently misreads as a purple variant.
  const background = hex('#3366FF');
  const error = hex('#C4443A');
  const blended = {
    r: srgbOf(0.5 * linearOf(error.r) + 0.5 * linearOf(background.r)),
    g: srgbOf(0.5 * linearOf(error.g) + 0.5 * linearOf(background.g)),
    b: srgbOf(0.5 * linearOf(error.b) + 0.5 * linearOf(background.b))
  };
  const twoTone = [token('error', '#C4443A'), token('purple', '#6E4C8C')];

  const blind = attributeColor(blended, twoTone);
  assert.equal(blind.status, 'derived');
  assert.equal(blind.token.name, 'purple', 'hue alone names the wrong token');

  const informed = attributeColor(blended, twoTone, { background });
  assert.equal(informed.status, 'ambiguous');
  assert.equal(informed.token, null);
  assert.deepEqual(informed.candidates.map((entry) => entry.name).sort(), ['error', 'purple']);
});

/**
 * sRGB channel to linear light.
 * @param {number} value Channel 0-255.
 * @returns {number} Linear value.
 */
function linearOf(value) {
  const scaled = value / 255;
  return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

/**
 * Linear light back to an sRGB channel.
 * @param {number} value Linear value.
 * @returns {number} Channel 0-255.
 */
function srgbOf(value) {
  const clamped = Math.min(1, Math.max(0, value));
  return Math.round(255 * (clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * clamped ** (1 / 2.4) - 0.055));
}

test('returns unknown when no token shares the hue family', () => {
  const result = attributeColor(hex('#3A6EC4'), palette);
  assert.equal(result.status, 'unknown');
  assert.equal(result.token, null);
  assert.equal(describeAttribution(result), '');
});

test('reports ambiguity instead of guessing between same-family tokens', () => {
  // A palette with a primary and a container variant of one hue: both can
  // explain a darkened sample, so neither gets named.
  const twins = [token('success', '#A7B89A'), token('successContainer', '#AFC0A2')];
  const result = attributeColor(hex('#5B6B4F'), twins);
  assert.equal(result.status, 'ambiguous');
  assert.equal(result.token, null);
  assert.equal(result.candidates.length, 2);
  assert.match(describeAttribution(result), /cannot separate them/);
});

test('handles empty and malformed token lists without throwing', () => {
  assert.equal(attributeColor(hex('#8A6410'), []).status, 'unknown');
  assert.equal(attributeColor(hex('#8A6410'), [{ name: 'broken' }]).status, 'unknown');
  assert.equal(attributeColor(null, palette).status, 'unknown');
});
