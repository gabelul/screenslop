import assert from 'node:assert/strict';
import test from 'node:test';
import { flattenAxTree } from '../src/critique/ax-tree.mjs';
import { detectContrastIssues } from '../src/critique/detectors/contrast.mjs';
import { buildBmp, parseBmp } from '../src/critique/pixels.mjs';

// 100x200pt root with a 100x200px screenshot keeps scale at exactly 1.
const rootWidth = 100;
const rootHeight = 200;

const context = {
  artifacts: {
    screenshot: { exists: true, absolutePath: '/tmp/screenslop-test/screenshot.jpg', displayPath: 'screenshot.jpg' }
  }
};

const white = { r: 255, g: 255, b: 255 };

/**
 * Builds a flattened AX tree with a scale-1 root around the given children.
 * @param {object[]} children Child AX nodes.
 * @returns {object[]} Flattened nodes.
 */
function tree(children) {
  return flattenAxTree({
    role: 'AXApplication',
    label: 'Contrast App',
    enabled: true,
    hidden: false,
    frame: { x: 0, y: 0, width: rootWidth, height: rootHeight },
    children
  });
}

function textNode(label, frame) {
  return { role: 'AXStaticText', label, enabled: true, hidden: false, frame };
}

/**
 * Paints a white screenshot with text regions rendered as alternating columns
 * of text color and background, so cluster splitting sees both surfaces.
 * @param {{frame:object,color:object}[]} regions Regions to paint.
 * @returns {(x:number,y:number)=>object} Painter for buildBmp.
 */
function paintRegions(regions) {
  return (x, y) => {
    for (const { frame, color } of regions) {
      const inside = x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height;
      if (inside) return x % 2 === 0 ? color : white;
    }
    return white;
  };
}

function optionsFor(bmp) {
  return { loadPixels: () => parseBmp(bmp) };
}

test('flags light-gray text on white as P1 with the measured ratio in the detail', () => {
  const frame = { x: 10, y: 20, width: 30, height: 12 };
  // rgb(200) on white measures ~1.7:1 — well under the 3:1 P1 line.
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 200, g: 200, b: 200 } }]));
  const findings = detectContrastIssues(context, tree([textNode('Subtitle', frame)]), optionsFor(bmp));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].ruleId, 'color.contrast');
  assert.equal(findings[0].severity, 'P1');
  assert.equal(findings[0].pillar, 'color');
  assert.match(findings[0].detail, /1\.7:1/);
  assert.match(findings[0].detail, /4\.5:1/);
  assert.match(findings[0].detail, /pixel-sampled estimate/);
  assert.equal(findings[0].evidence.artifact, 'screenshot.jpg');
  assert.deepEqual(findings[0].evidence.screenshotRegion, frame);
  // 12pt-tall text is caption-size: sampling skews low, so the finding says so.
  assert.match(findings[0].detail, /anti-aliasing skews sampling low/);
  assert.equal(findings[0].confidence, 'low');
});

test('body-size text keeps medium confidence and no tiny-text caveat', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 200, g: 200, b: 200 } }]));
  const findings = detectContrastIssues(context, tree([textNode('Body copy', frame)]), optionsFor(bmp));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, 'medium');
  assert.doesNotMatch(findings[0].detail, /anti-aliasing/);
});

test('rates a 3.0-4.4 ratio as P2 for normal text but passes it for large text', () => {
  const normalFrame = { x: 10, y: 20, width: 30, height: 12 };
  const largeFrame = { x: 10, y: 100, width: 30, height: 30 };
  // rgb(128) on white measures ~4.0:1 — fails normal text, clears large text.
  const gray = { r: 128, g: 128, b: 128 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([
    { frame: normalFrame, color: gray },
    { frame: largeFrame, color: gray }
  ]));
  const nodes = tree([textNode('Caption', normalFrame), textNode('Headline', largeFrame)]);
  const findings = detectContrastIssues(context, nodes, optionsFor(bmp));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, 'P2');
  assert.match(findings[0].detail, /Caption/);
});

test('does not flag black text on white', () => {
  const frame = { x: 10, y: 20, width: 30, height: 12 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 0, g: 0, b: 0 } }]));
  const findings = detectContrastIssues(context, tree([textNode('Body', frame)]), optionsFor(bmp));
  assert.equal(findings.length, 0);
});

test('skips flat single-color regions instead of flagging them', () => {
  const frame = { x: 10, y: 20, width: 30, height: 12 };
  // Solid gray fill everywhere in the region — no text/background split exists.
  const bmp = buildBmp(rootWidth, rootHeight, (x, y) => (
    x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height
      ? { r: 120, g: 120, b: 120 }
      : white
  ));
  const findings = detectContrastIssues(context, tree([textNode('Banner', frame)]), optionsFor(bmp));
  assert.equal(findings.length, 0);
});

test('returns nothing when pixels are unavailable', () => {
  const frame = { x: 10, y: 20, width: 30, height: 12 };
  const nodes = tree([textNode('Subtitle', frame)]);
  assert.deepEqual(detectContrastIssues(context, nodes, { loadPixels: () => null }), []);

  const missingShot = { artifacts: { screenshot: { exists: false, absolutePath: null, displayPath: null } } };
  assert.deepEqual(detectContrastIssues(missingShot, nodes, { loadPixels: () => { throw new Error('should not load'); } }), []);
});

test('caps a screen full of bad regions at five findings, worst ratios first', () => {
  const gray = { r: 200, g: 200, b: 200 };
  const regions = [];
  const children = [];
  for (let i = 0; i < 7; i += 1) {
    const frame = { x: 10, y: 15 + i * 25, width: 30, height: 12 };
    regions.push({ frame, color: gray });
    children.push(textNode(`Row ${i}`, frame));
  }
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions(regions));
  const findings = detectContrastIssues(context, tree(children), optionsFor(bmp));

  assert.equal(findings.length, 5);
  assert.ok(findings.every((finding) => finding.severity === 'P1'));
});

test('produces deterministic fingerprint-backed ids across runs', () => {
  const frame = { x: 10, y: 20, width: 30, height: 12 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 200, g: 200, b: 200 } }]));
  const nodes = tree([textNode('Subtitle', frame)]);

  const first = detectContrastIssues(context, nodes, optionsFor(bmp));
  const second = detectContrastIssues(context, nodes, optionsFor(bmp));
  assert.deepEqual(first.map((finding) => finding.id), second.map((finding) => finding.id));
});
