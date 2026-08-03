import assert from 'node:assert/strict';
import test from 'node:test';
import { attributeColor, describeAttribution, srgbToOklch } from '../src/design/color-attribution.mjs';

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
  const result = attributeColor(hex('#F4F4F5'), palette);
  assert.equal(result.status, 'exact');
  assert.equal(result.token.name, 'surface');
});

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
