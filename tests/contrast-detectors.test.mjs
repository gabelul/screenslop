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

// Real labels have padding, so the edge of an AX frame is background. The
// detector relies on that to tell foreground from background, and a fixture
// with glyphs flush to the border is not a label — it is a filled rectangle.
const glyphInset = 2;

/**
 * Paints a screenshot with text regions rendered as alternating columns of text
 * color and background, so cluster splitting sees both surfaces. Text is inset
 * from the frame edge, leaving a background border as a real label has.
 * @param {{frame:object,color:object}[]} regions Regions to paint.
 * @param {{r:number,g:number,b:number}} [surface] Background color.
 * @returns {(x:number,y:number)=>object} Painter for buildBmp.
 */
function paintRegions(regions, surface = white) {
  return (x, y) => {
    for (const { frame, color } of regions) {
      const inside = x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height;
      if (!inside) continue;
      const inCore = x >= frame.x + glyphInset && x < frame.x + frame.width - glyphInset
        && y >= frame.y + glyphInset && y < frame.y + frame.height - glyphInset;
      if (!inCore) return surface;
      return x % 2 === 0 ? color : surface;
    }
    return surface;
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
  // 1.7:1 against a 4.5:1 threshold is 2.8 clear of the line — no amount of
  // JPEG noise or anti-aliasing skew turns that into a pass, tiny text or not.
  assert.equal(findings[0].confidence, 'high');
});

test('body-size text far below the threshold is high confidence with no tiny-text caveat', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 200, g: 200, b: 200 } }]));
  const findings = detectContrastIssues(context, tree([textNode('Body copy', frame)]), optionsFor(bmp));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, 'high');
  assert.doesNotMatch(findings[0].detail, /anti-aliasing/);
});

test('a ratio sitting just under the threshold drops to low confidence', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  // rgb(122) on white measures ~4.3:1 — failing, but by less than sampling noise.
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 122, g: 122, b: 122 } }]));
  const findings = detectContrastIssues(context, tree([textNode('Body copy', frame)]), optionsFor(bmp));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].confidence, 'low');
  assert.match(findings[0].detail, /inside JPEG sampling noise/);
});

test('tiny text needs a wider margin than body text to clear the noise band', () => {
  // ~4.0:1 is 0.5 under the threshold: comfortably outside the body-text noise
  // band, still inside the wider band tiny text gets.
  const gray = { r: 128, g: 128, b: 128 };
  const bodyFrame = { x: 10, y: 20, width: 60, height: 18 };
  const tinyFrame = { x: 10, y: 100, width: 60, height: 12 };

  const bodyBmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame: bodyFrame, color: gray }]));
  const body = detectContrastIssues(context, tree([textNode('Body copy', bodyFrame)]), optionsFor(bodyBmp));
  assert.equal(body[0].confidence, 'medium');

  const tinyBmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame: tinyFrame, color: gray }]));
  const tiny = detectContrastIssues(context, tree([textNode('Caption', tinyFrame)]), optionsFor(tinyBmp));
  assert.equal(tiny[0].confidence, 'low');
});

// Shaped on a real measurement: an app rendering its warning token #D4A441 as a
// derived variant. #E8C478 is the lightened form — 67 RGB units away, which the
// old distance-only matching would have called an unknown color, and 1.67:1 on
// white, which is the failure this rule exists to catch.
const warningToken = { name: 'Theme.warning', hex: '#D4A441', r: 212, g: 164, b: 65 };
const derivedAmber = { r: 232, g: 196, b: 120 };

test('a contrast finding names the token its sampled color came from', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: derivedAmber }]));
  const findings = detectContrastIssues(context, tree([textNode('Expiring soon', frame)]), {
    ...optionsFor(bmp),
    colorTokens: [warningToken]
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /`Theme\.warning` token \(#D4A441\)/);
  assert.match(findings[0].detail, /lightness points lighter/);
  assert.equal(findings[0].evidence.attributedToken, 'Theme.warning');
  assert.equal(findings[0].evidence.attribution, 'derived');
  assert.equal(findings[0].evidence.sampledTextColor, '#E8C478');
});

test('light-on-dark text attributes the text token, not the background token', () => {
  // Deciding ownership by cluster size named the background token here with
  // full confidence: the contrast ratio is symmetric, so nothing else caught it.
  const black = { r: 0, g: 0, b: 0 };
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 68, g: 68, b: 68 } }], black));
  const tokens = [
    { name: 'Theme.bgDark', hex: '#000000', r: 0, g: 0, b: 0 },
    { name: 'Theme.mutedDark', hex: '#444444', r: 68, g: 68, b: 68 }
  ];
  const findings = detectContrastIssues(context, tree([textNode('On dark', frame)]), {
    ...optionsFor(bmp),
    colorTokens: tokens
  });

  assert.equal(findings.length, 1);
  assert.equal(findings[0].evidence.sampledTextColor, '#444444');
  assert.equal(findings[0].evidence.attributedToken, 'Theme.mutedDark');
});

test('omits attribution when the border cannot settle foreground from background', () => {
  // The surroundings are striped with the same two colors as the glyphs, so
  // neither the ring outside the frame nor the frame's own perimeter resembles
  // one cluster more than the other. Nothing here can say which is the text.
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, (x, y) => (x % 2 === 0 ? derivedAmber : white));
  const findings = detectContrastIssues(context, tree([textNode('Ambiguous', frame)]), {
    ...optionsFor(bmp),
    colorTokens: [warningToken]
  });

  assert.equal(findings.length, 1, 'the ratio is still measured and reported');
  assert.equal(findings[0].evidence.sampledTextColor, undefined);
  assert.equal(findings[0].evidence.attributedToken, undefined);
});

test('a label on a filled control omits attribution when its references disagree', () => {
  // White label on a gray button on a white page: the ring outside the frame
  // catches the page (which matches the text), the frame's own perimeter
  // catches the button fill. Resolving that by closeness — or by array order on
  // a tie — named the button fill as the text color.
  const fill = { r: 150, g: 150, b: 150 };
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, (x, y) => {
    const onButton = x >= frame.x - 1 && x < frame.x + frame.width + 1
      && y >= frame.y - 1 && y < frame.y + frame.height + 1;
    if (!onButton) return white;
    const inFrame = x >= frame.x && x < frame.x + frame.width && y >= frame.y && y < frame.y + frame.height;
    if (!inFrame) return fill;
    const inCore = x >= frame.x + 2 && x < frame.x + frame.width - 2
      && y >= frame.y + 2 && y < frame.y + frame.height - 2;
    if (!inCore) return fill;
    return x % 2 === 0 ? white : fill;
  });

  const findings = detectContrastIssues(context, tree([textNode('Save', frame)]), {
    ...optionsFor(bmp),
    colorTokens: [
      { name: 'Page.bg', hex: '#FFFFFF', r: 255, g: 255, b: 255 },
      { name: 'Button.fill', hex: '#969696', r: 150, g: 150, b: 150 }
    ]
  });

  assert.equal(findings.length, 1, 'the ratio is still measured');
  assert.equal(findings[0].evidence.sampledTextColor, undefined);
  assert.equal(findings[0].evidence.attributedToken, undefined);
});

test('token attribution never moves the severity or confidence of a measured finding', () => {
  // The failing ratio is measured from the capture; the token name comes from a
  // profile that may be stale. Naming it must not strengthen the claim.
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: derivedAmber }]));
  const nodes = tree([textNode('Expiring soon', frame)]);

  const without = detectContrastIssues(context, nodes, optionsFor(bmp))[0];
  const withTokens = detectContrastIssues(context, nodes, { ...optionsFor(bmp), colorTokens: [warningToken] })[0];

  assert.equal(withTokens.severity, without.severity);
  assert.equal(withTokens.confidence, without.confidence);
  assert.equal(withTokens.ruleId, without.ruleId);
  assert.equal(withTokens.id, without.id, 'attribution must not change the fingerprint');
});

test('contrast findings read exactly as before when no design profile exists', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: derivedAmber }]));
  const findings = detectContrastIssues(context, tree([textNode('Expiring soon', frame)]), optionsFor(bmp));

  assert.equal(findings.length, 1);
  assert.doesNotMatch(findings[0].detail, /token \(#/);
  assert.equal(findings[0].evidence.attributedToken, undefined);
});

test('an untraceable color leaves the finding unnamed rather than guessing', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  // Gray text: near-neutral, so its hue cannot identify a token.
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 190, g: 190, b: 190 } }]));
  const findings = detectContrastIssues(context, tree([textNode('Muted', frame)]), {
    ...optionsFor(bmp),
    colorTokens: [warningToken]
  });

  assert.equal(findings.length, 1);
  assert.match(findings[0].detail, /near-neutral/);
  assert.equal(findings[0].evidence.attributedToken, undefined);
});

test('contrast findings point at matrix when the bundle records no appearance', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 200, g: 200, b: 200 } }]));
  const findings = detectContrastIssues(context, tree([textNode('Body copy', frame)]), optionsFor(bmp));

  assert.match(findings[0].verification, /screenslop matrix/);
  assert.match(findings[0].verification, /appearance-specific/);
});

test('contrast findings drop the matrix nudge once appearance is recorded', () => {
  const frame = { x: 10, y: 20, width: 60, height: 18 };
  const bmp = buildBmp(rootWidth, rootHeight, paintRegions([{ frame, color: { r: 200, g: 200, b: 200 } }]));
  const darkContext = { ...context, manifest: { environment: { appearance: 'dark' } } };
  const findings = detectContrastIssues(darkContext, tree([textNode('Body copy', frame)]), optionsFor(bmp));

  assert.equal(findings.length, 1);
  assert.doesNotMatch(findings[0].verification, /screenslop matrix/);
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
