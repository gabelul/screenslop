// Capture stability: prove the screen was holding still when we photographed it.
//
// A frame grabbed mid-animation looks exactly like a clean one in the manifest,
// and every finding derived from it inherits the lie — a button caught halfway
// through a transition has the wrong frame, a fading label the wrong color.
// Measured on a real simulator, the two cases are nowhere near each other: two
// captures of a static screen come back byte-identical, while two taken during
// a tab transition differ across ~40% of sampled pixels. Anywhere in that gulf
// is a safe threshold.

// Two separate encodes of one unchanged framebuffer are byte-identical, so any
// real difference clears this easily. The tolerance only guards against a
// runtime whose encoder is less deterministic than Baguette's.
const changedChannelTolerance = 8;
// A blinking cursor or a small spinner moves a fraction of a percent. A real
// transition moves tens of percent. One percent sits in the empty middle.
const unstableChangedRatio = 0.01;
// ~20k samples resolves a 1% change with room to spare and stays cheap.
const targetSampleCount = 20000;

/**
 * Checks whether two capture files are byte-for-byte identical.
 *
 * Back-to-back captures of a frozen screen do come back identical, so this
 * skips decoding when it fires. Across a 250ms gap it often does not — a live
 * simulator nudges something most of the time — so treat this as an
 * opportunistic shortcut, not the main path. The pixel comparison does the
 * real work.
 *
 * @param {Buffer|null} first First capture bytes.
 * @param {Buffer|null} second Second capture bytes.
 * @returns {boolean} True when both buffers exist and match exactly.
 */
export function frameBytesMatch(first, second) {
  if (!Buffer.isBuffer(first) || !Buffer.isBuffer(second)) return false;
  return first.equals(second);
}

/**
 * Measures how much of the screen moved between two captures.
 *
 * @param {object|null} first Pixel accessor for the first capture.
 * @param {object|null} second Pixel accessor for the second capture.
 * @returns {{status:string, changedRatio:number|null, sampled:number}} Stability verdict.
 */
export function compareFrames(first, second) {
  if (!usable(first) || !usable(second)) return { status: 'unknown', changedRatio: null, sampled: 0 };
  if (first.width !== second.width || first.height !== second.height) {
    // A size change between two captures 250ms apart means rotation or a
    // different device — not something a ratio can describe honestly.
    return { status: 'unstable', changedRatio: 1, sampled: 0 };
  }

  const step = Math.max(1, Math.round(Math.sqrt((first.width * first.height) / targetSampleCount)));
  let changed = 0;
  let sampled = 0;

  for (let y = 0; y < first.height; y += step) {
    for (let x = 0; x < first.width; x += step) {
      const a = first.getPixel(x, y);
      const b = second.getPixel(x, y);
      const delta = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
      if (delta > changedChannelTolerance) changed += 1;
      sampled += 1;
    }
  }

  if (sampled === 0) return { status: 'unknown', changedRatio: null, sampled: 0 };
  const changedRatio = changed / sampled;
  return {
    status: changedRatio > unstableChangedRatio ? 'unstable' : 'stable',
    changedRatio,
    sampled
  };
}

/**
 * Renders a stability verdict as a human-readable capture step message.
 * @param {{status:string, changedRatio:number|null}} verdict Stability verdict.
 * @param {number} delayMs Gap between the two captures.
 * @returns {string} Step message.
 */
export function describeStability(verdict, delayMs) {
  if (verdict.status === 'unknown') return 'Could not compare frames; stability unknown.';
  if (verdict.status === 'stable') return `Screen held still across ${delayMs}ms.`;
  const percent = ((verdict.changedRatio ?? 0) * 100).toFixed(1);
  return `Screen was still moving: ${percent}% of sampled pixels changed across ${delayMs}ms. Findings from this bundle may reflect a mid-animation frame.`;
}

/**
 * Reports whether a pixel accessor is usable for comparison.
 * @param {object|null} image Pixel accessor.
 * @returns {boolean} True when the accessor has real dimensions.
 */
function usable(image) {
  return Boolean(image) && Number.isFinite(image.width) && Number.isFinite(image.height)
    && image.width > 0 && image.height > 0;
}
