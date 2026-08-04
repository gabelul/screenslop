import assert from 'node:assert/strict';
import test from 'node:test';
import { buildBmp, parseBmp } from '../src/critique/pixels.mjs';
import { compareFrames, describeStability, frameBytesMatch } from '../src/evidence/stability.mjs';
import { detectEvidenceQuality } from '../src/critique/detectors/evidence-quality.mjs';

/**
 * Builds a critique context with a complete capture and the given stability.
 * @param {object|undefined} stability Stability block for the manifest.
 * @returns {object} Critique context.
 */
function contextWithStability(stability) {
  return {
    manifestPathDisplay: 'evidence.json',
    manifest: {
      capture: { status: 'complete', steps: [], ...(stability ? { stability } : {}) }
    },
    artifacts: {
      screenshot: { exists: true, displayPath: 'screenshot.jpg' },
      accessibilityTree: { exists: true, displayPath: 'accessibility.json' },
      logs: { exists: false }
    }
  };
}

test('critique raises a finding when the bundle was captured mid-animation', () => {
  const findings = detectEvidenceQuality(contextWithStability({ status: 'unstable', changedRatio: 0.4, delayMs: 250 }));
  const finding = findings.find((entry) => entry.ruleId === 'evidence.unstable-capture');
  assert.ok(finding, 'expected an unstable-capture finding');
  assert.equal(finding.severity, 'P1');
  assert.equal(finding.confidence, 'high');
  assert.match(finding.detail, /40\.0% of sampled pixels/);
});

test('critique stays quiet for stable, unknown, or absent stability', () => {
  for (const stability of [{ status: 'stable', changedRatio: 0 }, { status: 'unknown', changedRatio: null }, undefined]) {
    const findings = detectEvidenceQuality(contextWithStability(stability));
    assert.equal(findings.some((entry) => entry.ruleId === 'evidence.unstable-capture'), false);
  }
});

const size = 200;

/**
 * Builds a pixel accessor whose top-left block is painted a different color.
 * @param {number} blockSize Width and height of the changed block.
 * @returns {object} Pixel accessor.
 */
function frameWithBlock(blockSize) {
  return parseBmp(buildBmp(size, size, (x, y) => (
    x < blockSize && y < blockSize ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
  )));
}

test('compareFrames calls an unchanged screen stable', () => {
  const verdict = compareFrames(frameWithBlock(0), frameWithBlock(0));
  assert.equal(verdict.status, 'stable');
  assert.equal(verdict.changedRatio, 0);
  assert.ok(verdict.sampled > 0);
});

test('compareFrames calls a screen mid-transition unstable', () => {
  // Half the frame repainted — the shape of a real tab change.
  const verdict = compareFrames(frameWithBlock(0), frameWithBlock(size));
  assert.equal(verdict.status, 'unstable');
  assert.ok(verdict.changedRatio > 0.5, `expected a large change, got ${verdict.changedRatio}`);
});

test('compareFrames reports unknown when either frame is unusable', () => {
  assert.equal(compareFrames(null, frameWithBlock(0)).status, 'unknown');
  assert.equal(compareFrames(frameWithBlock(0), null).status, 'unknown');
  assert.equal(compareFrames({ width: 0, height: 0 }, frameWithBlock(0)).status, 'unknown');
});

test('compareFrames treats a size change as unstable rather than guessing a ratio', () => {
  const small = parseBmp(buildBmp(50, 50, () => ({ r: 255, g: 255, b: 255 })));
  const verdict = compareFrames(frameWithBlock(0), small);
  assert.equal(verdict.status, 'unstable');
});

test('frameBytesMatch is the fast path for a still screen', () => {
  const a = Buffer.from([1, 2, 3]);
  assert.equal(frameBytesMatch(a, Buffer.from([1, 2, 3])), true);
  assert.equal(frameBytesMatch(a, Buffer.from([1, 2, 4])), false);
  assert.equal(frameBytesMatch(a, null), false);
  assert.equal(frameBytesMatch(null, null), false);
});

test('describeStability explains each verdict in the capture steps', () => {
  assert.match(describeStability({ status: 'stable', changedRatio: 0 }, 250), /held still across 250ms/);
  assert.match(describeStability({ status: 'unstable', changedRatio: 0.42 }, 250), /42\.0% of sampled pixels/);
  assert.match(describeStability({ status: 'unknown', changedRatio: null }, 250), /stability was not established/);
  assert.match(
    describeStability({ status: 'unknown', changedRatio: null, reason: 'probe-capture-failed' }, 250),
    /probe-capture-failed/
  );
});

// Captures are device pixels, not points: a 402x874pt screen arrives as
// 1206x2622. Building fixtures in point space made every stroke three times
// thinner than reality, so a spinner's arms fell between sample rows.
const pointScale = 3;
const screenWidth = 402 * pointScale;
const screenHeight = 874 * pointScale;
const white = { r: 255, g: 255, b: 255 };
const black = { r: 0, g: 0, b: 0 };
const blankScreen = () => parseBmp(buildBmp(screenWidth, screenHeight, () => white));

/**
 * Paints a shape onto a blank screen at a given centre.
 * @param {(dx:number,dy:number)=>boolean} shape Membership test in shape-local coordinates.
 * @param {number} cx Centre x.
 * @param {number} cy Centre y.
 * @returns {object} Pixel accessor.
 */
function screenWithShape(shape, cx, cy) {
  return parseBmp(buildBmp(screenWidth, screenHeight, (x, y) => (shape(x - cx, y - cy) ? black : white)));
}

// Shapes are described in points and scaled to device pixels, the way UIKit
// draws them. A 2pt stroke is 6px on screen.
const strokePx = 2 * pointScale;
const solid = (pt) => (dx, dy) => Math.abs(dx) < (pt * pointScale) / 2 && Math.abs(dy) < (pt * pointScale) / 2;
const ring = (pt) => (dx, dy) => {
  const radius = (pt * pointScale) / 2;
  const distance = Math.hypot(dx, dy);
  return distance > radius - strokePx && distance < radius;
};
const bars = (pt) => (dx, dy) => {
  const half = (pt * pointScale) / 2;
  return (Math.abs(dy) < strokePx / 2 && Math.abs(dx) < half)
    || (Math.abs(dx) < strokePx / 2 && Math.abs(dy) < half);
};

test('a blinking caret is exempt only inside a text field, and only when caret-shaped', () => {
  // No threshold separates a caret from a turning spinner, so the caret is
  // bounded by where it can legally be rather than by how much it changes.
  const field = { x: 200, y: 1000, width: 800, height: 120 };
  const caret = (offsetX) => screenWithShape(
    (dx, dy) => dx >= 0 && dx < 2 * pointScale && dy >= 0 && dy < 16 * pointScale,
    field.x + offsetX,
    field.y + 40
  );
  const still = blankScreen();

  // Inside the field, caret-width: exempt.
  const inside = compareFrames(still, caret(20), { editableRegions: [field] });
  assert.equal(inside.status, 'stable');
  assert.equal(inside.caretExempt, true);

  // Identical motion with no field declared: not exempt.
  assert.equal(compareFrames(still, caret(20)).status, 'unstable');

  // Same shape outside every field: not exempt.
  const outside = compareFrames(still, screenWithShape(
    (dx, dy) => dx >= 0 && dx < 2 * pointScale && dy >= 0 && dy < 16 * pointScale,
    field.x + field.width + 200,
    field.y
  ), { editableRegions: [field] });
  assert.equal(outside.status, 'unstable');

  // A field repainting its whole content is not a caret.
  const repaint = compareFrames(still, screenWithShape(
    (dx, dy) => dx >= 0 && dx < field.width - 20 && dy >= 0 && dy < 40,
    field.x + 10,
    field.y + 40
  ), { editableRegions: [field] });
  assert.equal(repaint.status, 'unstable');
});

test('localized detection is monotonic: a superset of moving pixels stays moving', () => {
  // Two earlier designs failed this. A global bounding box merged distant
  // motion past its area limit; connected components merged it through a sparse
  // bridge. Both made *adding* motion reduce detection.
  const edge = 1000;
  const dots = (points) => parseBmp(buildBmp(edge, edge, (x, y) => (
    points.some(([px, py]) => x >= px && x < px + 3 && y >= py && y < py + 3) ? black : white
  )));
  const still = parseBmp(buildBmp(edge, edge, () => white));

  const base = [[0, 0], [6, 6], [12, 12]];
  assert.equal(compareFrames(still, dots(base)).status, 'unstable');

  // Extend the same diagonal to the far corner — a strict superset.
  const superset = [];
  for (let i = 0; i < edge - 6; i += 6) superset.push([i, i]);
  assert.equal(
    compareFrames(still, dots(superset)).status,
    'unstable',
    'adding motion must never make a capture read as more stable'
  );

  // Two compact animations far apart: each alone trips, so together must too.
  const ring = (cx, cy) => (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    return d > 27 && d < 33;
  };
  const paint = (shapes) => parseBmp(buildBmp(1206, 2622, (x, y) => (shapes.some((f) => f(x, y)) ? black : white)));
  const blank = parseBmp(buildBmp(1206, 2622, () => white));
  assert.equal(compareFrames(blank, paint([ring(300, 500)])).status, 'unstable');
  assert.equal(compareFrames(blank, paint([ring(300, 500), ring(900, 2200)])).status, 'unstable');
});

test('an unchanged capture is never called moving', () => {
  // The floor is deliberately low, so this is the assertion that has to hold:
  // real captures of a still screen change zero samples.
  const verdict = compareFrames(blankScreen(), blankScreen());
  assert.equal(verdict.status, 'stable');
  assert.equal(verdict.changedRatio, 0);
  assert.equal(verdict.localizedMotion, false);
});

test('spinner shapes are caught, not just solid blocks', () => {
  // An activity indicator is arcs and gaps. Testing only filled squares meant a
  // realistic 24pt ring measured 12% of its tile and passed as stable.
  const still = blankScreen();
  for (const [name, shape] of [['ring', ring(24)], ['bars', bars(24)], ['solid', solid(24)]]) {
    const verdict = compareFrames(still, screenWithShape(shape, 600, 1200));
    assert.equal(verdict.status, 'unstable', `a 24pt ${name} spinner should not read as stable`);
  }
});

test('24pt motion is caught at every tile phase, shape regardless', () => {
  // Positions are stepped to land on tile centres, edges, and corners of all
  // four offset grids rather than a convenient subset.
  const still = blankScreen();
  const tileWidth = screenWidth / 16;
  const tileHeight = screenHeight / 16;
  const phases = [0, 0.25, 0.5, 0.75];

  const missed = [];
  for (const phaseX of phases) {
    for (const phaseY of phases) {
      const cx = Math.round(tileWidth * (5 + phaseX));
      const cy = Math.round(tileHeight * (7 + phaseY));
      for (const shape of [solid(24), ring(24), bars(24)]) {
        if (compareFrames(still, screenWithShape(shape, cx, cy)).status !== 'unstable') {
          missed.push(`${cx},${cy}`);
        }
      }
    }
  }
  assert.deepEqual(missed, [], `24pt motion escaped at phases: ${missed.join(' ')}`);
});

test('localized motion is caught wherever it sits, not just where the grid is kind', () => {
  // A single fixed grid made detection depend on luck: the same region scored
  // 0.24 inside a tile and 0.10 straddling a corner, so a spinner could hide by
  // being in the wrong place. This sweeps a realistic screen exhaustively.
  const width = 402;
  const height = 874;
  const still = parseBmp(buildBmp(width, height, () => ({ r: 255, g: 255, b: 255 })));
  const spinnerAt = (cx, cy, box) => parseBmp(buildBmp(width, height, (x, y) => (
    x >= cx - box / 2 && x < cx + box / 2 && y >= cy - box / 2 && y < cy + box / 2
      ? { r: 0, g: 0, b: 0 }
      : { r: 255, g: 255, b: 255 }
  )));

  const missed = [];
  for (let cx = 40; cx < width - 40; cx += 31) {
    for (let cy = 40; cy < height - 40; cy += 43) {
      if (compareFrames(still, spinnerAt(cx, cy, 32)).status !== 'unstable') missed.push(`${cx},${cy}`);
    }
  }
  assert.deepEqual(missed, [], `a 32pt spinner escaped detection at: ${missed.join(' ')}`);
});

test('a small busy region is unstable even though the screen barely moved', () => {
  // A spinner is a fraction of a percent of the screen. Under a global-only
  // threshold it could animate forever and still be called stable, while the
  // docs claimed spinners were caught.
  const still = frameWithBlock(0);
  const spinner = parseBmp(buildBmp(size, size, (x, y) => (
    x < 20 && y < 20 ? { r: 0, g: 0, b: 0 } : { r: 255, g: 255, b: 255 }
  )));

  const verdict = compareFrames(still, spinner);
  assert.equal(verdict.status, 'unstable');
  assert.ok(verdict.changedRatio <= 0.01, `global ratio stayed small: ${verdict.changedRatio}`);
  assert.ok(verdict.busiestTileRatio > 0.2, `one tile was busy: ${verdict.busiestTileRatio}`);
  // The message must name the signal that tripped; quoting only the global
  // percentage reported "0.0% changed" on a capture flagged as moving.
  assert.match(describeStability(verdict, 250), /moving in one place/);
  assert.doesNotMatch(describeStability(verdict, 250), /^Screen was still moving: 0\.0%/);
});

test('a rotating indicator is caught at 2x and 3x, at every lattice phase', () => {
  // This is the transition that matters. Comparing a blank screen against a
  // fully drawn spinner tests that a spinner *appeared*; a sustained spinner
  // shows one phase in both captures and only its edges differ. That case read
  // as perfectly stable while every earlier fixture passed.
  const quarterArc = (scale, deg) => (dx, dy) => {
    const distance = Math.hypot(dx, dy);
    const radius = (24 * scale) / 2;
    if (!(distance > radius - 2 * scale && distance < radius)) return false;
    let angle = (Math.atan2(dy, dx) * 180) / Math.PI;
    if (angle < 0) angle += 360;
    return angle >= deg && angle < deg + 90;
  };

  const geometries = [
    ['3x phone', 1206, 2622, 3],
    ['2x iPad', 2048, 2732, 2],
    ['2x phone', 750, 1334, 2]
  ];

  for (const [name, width, height, scale] of geometries) {
    const paint = (shape, cx, cy) => parseBmp(buildBmp(width, height, (x, y) => (
      shape(x - cx, y - cy) ? black : white
    )));
    // Sweep starting angle, rotation step, and sample-lattice phase. Calibrating
    // from a single 0->45 transition hid slower rotations entirely.
    for (const start of [0, 17, 33, 60]) {
      for (const delta of [22.5, 45, 90]) {
        for (let phase = 0; phase < 4; phase += 1) {
          const cx = Math.round(width / 2) + phase;
          const cy = Math.round(height / 2) + phase;
          const verdict = compareFrames(
            paint(quarterArc(scale, start), cx, cy),
            paint(quarterArc(scale, start + delta), cx, cy)
          );
          assert.equal(
            verdict.status,
            'unstable',
            `${name} spinner missed: start ${start} step ${delta} phase ${phase}`
          );
        }
      }
    }
  }
});
