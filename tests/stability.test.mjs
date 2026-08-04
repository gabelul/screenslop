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

test('compareFrames tolerates a blinking cursor without crying unstable', () => {
  // A 10x10 block of a 200x200 frame is 0.25% — under the 1% threshold.
  const verdict = compareFrames(frameWithBlock(0), frameWithBlock(10));
  assert.equal(verdict.status, 'stable');
  assert.ok(verdict.changedRatio < 0.01, `expected under 1%, got ${verdict.changedRatio}`);
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
  assert.match(describeStability(verdict, 250), /Motion is localized/);
});
