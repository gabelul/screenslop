import assert from 'node:assert/strict';
import test from 'node:test';
import { detectColorBalanceIssues } from '../src/critique/detectors/color-balance.mjs';
import { buildBmp, parseBmp } from '../src/critique/pixels.mjs';

const context = { artifacts: { screenshot: { exists: true, absolutePath: '/tmp/fake-screenshot.jpg', displayPath: 'screenshot.jpg' } } };

/**
 * Builds detector options that serve a painted synthetic BMP as the screenshot.
 * @param {(x:number,y:number)=>{r:number,g:number,b:number}} paint Pixel painter.
 * @returns {object} Options with an injected loadPixels.
 */
function paintedPixels(paint) {
  return { loadPixels: () => parseBmp(buildBmp(200, 200, paint)) };
}

const gray = { r: 128, g: 128, b: 128 };
const blue = { r: 40, g: 80, b: 220 };

// Five strong hues that land in five distinct 30-degree bins.
const stripeHues = [
  { r: 220, g: 40, b: 40 }, // red, bin 0
  { r: 220, g: 180, b: 40 }, // yellow, bin 1
  { r: 40, g: 200, b: 60 }, // green, bin 4
  { r: 40, g: 80, b: 220 }, // blue, bin 7
  { r: 200, g: 40, b: 200 } // magenta, bin 10
];

test('all-gray screen fires color.monochrome-mute', () => {
  const findings = detectColorBalanceIssues(context, [], paintedPixels(() => gray));
  const hit = findings.find((finding) => finding.ruleId === 'color.monochrome-mute');
  assert.ok(hit, 'expected a monochrome-mute finding');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'color');
  assert.equal(hit.confidence, 'low');
  assert.equal(hit.evidence.artifact, 'screenshot.jpg');
  assert.match(hit.evidence.note, /neutral share/);
  assert.equal(findings.filter((finding) => finding.ruleId === 'color.competing-accents').length, 0);
});

test('gray screen with a clear 5% blue accent fires nothing', () => {
  // Left 10 of 200 columns are the accent: 5% coverage — a real accent, not soup.
  const findings = detectColorBalanceIssues(context, [], paintedPixels((x) => (x < 10 ? blue : gray)));
  assert.equal(findings.length, 0);
});

test('mostly-gray screen with only a sliver of accent still fires monochrome-mute', () => {
  // ~99.6% neutral and the accent covers well under 1% — colorless in practice.
  const findings = detectColorBalanceIssues(context, [], paintedPixels((x, y) => (x < 10 && y < 10 ? blue : gray)));
  assert.equal(findings.filter((finding) => finding.ruleId === 'color.monochrome-mute').length, 1);
});

test('five strong hue stripes fire color.competing-accents', () => {
  const findings = detectColorBalanceIssues(context, [], paintedPixels((x) => stripeHues[Math.min(4, Math.floor(x / 40))]));
  const hit = findings.find((finding) => finding.ruleId === 'color.competing-accents');
  assert.ok(hit, 'expected a competing-accents finding');
  assert.equal(hit.severity, 'P3');
  assert.equal(hit.pillar, 'color');
  assert.match(hit.detail, /5 distinct hue families/);
  assert.equal(findings.filter((finding) => finding.ruleId === 'color.monochrome-mute').length, 0);
});

test('two-hue screen fires nothing', () => {
  const findings = detectColorBalanceIssues(context, [], paintedPixels((x) => (x < 100 ? stripeHues[0] : blue)));
  assert.equal(findings.length, 0);
});

test('returns nothing when pixels are unavailable', () => {
  assert.deepEqual(detectColorBalanceIssues(context, [], { loadPixels: () => null }), []);
});

test('returns nothing when the screenshot artifact does not exist', () => {
  const missing = { artifacts: { screenshot: { exists: false, absolutePath: null, displayPath: null } } };
  const findings = detectColorBalanceIssues(missing, [], paintedPixels(() => gray));
  assert.deepEqual(findings, []);
});

test('produces stable fingerprint-backed ids', () => {
  const paint = (x) => stripeHues[Math.min(4, Math.floor(x / 40))];
  const first = detectColorBalanceIssues(context, [], paintedPixels(paint));
  const second = detectColorBalanceIssues(context, [], paintedPixels(paint));
  assert.ok(first.length > 0);
  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});
