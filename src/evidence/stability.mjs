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
// A full-screen transition moves tens of percent, so one percent globally is a
// safe line for large-area motion.
const unstableChangedRatio = 0.01;
// But a global ratio is blind to small, busy things. A 44x44pt spinner is only
// 0.55% of a 402x874 screen, so it would spin forever under the global line
// alone. Splitting the frame into tiles and flagging any single tile that is
// substantially in motion catches localized animation without lowering the
// global threshold to somewhere noise lives.
const tileGridSize = 8;
const unstableTileRatio = 0.2;
// A tile needs enough samples for its ratio to mean anything.
const minTileSamples = 24;
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
  const tiles = Array.from({ length: tileGridSize * tileGridSize }, () => ({ changed: 0, sampled: 0 }));
  let changed = 0;
  let sampled = 0;

  for (let y = 0; y < first.height; y += step) {
    for (let x = 0; x < first.width; x += step) {
      const a = first.getPixel(x, y);
      const b = second.getPixel(x, y);
      const delta = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
      const moved = delta > changedChannelTolerance;
      if (moved) changed += 1;
      sampled += 1;

      const tileX = Math.min(tileGridSize - 1, Math.floor((x / first.width) * tileGridSize));
      const tileY = Math.min(tileGridSize - 1, Math.floor((y / first.height) * tileGridSize));
      const tile = tiles[tileY * tileGridSize + tileX];
      tile.sampled += 1;
      if (moved) tile.changed += 1;
    }
  }

  if (sampled === 0) return { status: 'unknown', changedRatio: null, sampled: 0 };
  const changedRatio = changed / sampled;
  const busiestTile = tiles.reduce((worst, tile) => {
    if (tile.sampled < minTileSamples) return worst;
    const ratio = tile.changed / tile.sampled;
    return ratio > worst ? ratio : worst;
  }, 0);

  const unstable = changedRatio > unstableChangedRatio || busiestTile > unstableTileRatio;
  return {
    status: unstable ? 'unstable' : 'stable',
    changedRatio,
    busiestTileRatio: busiestTile,
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
  if (verdict.status === 'unknown') {
    const reason = verdict.reason ? ` (${verdict.reason})` : '';
    return `Could not compare frames${reason}; stability was not established for this capture.`;
  }
  if (verdict.status === 'stable') return `Screen held still across ${delayMs}ms.`;

  const percent = ((verdict.changedRatio ?? 0) * 100).toFixed(1);
  // A spinner barely registers globally but dominates its own tile, so say
  // which measurement actually tripped rather than quoting a tiny percentage.
  const localized = (verdict.busiestTileRatio ?? 0) > unstableTileRatio && (verdict.changedRatio ?? 0) <= unstableChangedRatio
    ? ` Motion is localized: one region changed ${((verdict.busiestTileRatio ?? 0) * 100).toFixed(0)}% while the screen overall barely moved.`
    : '';
  return `Screen was still moving: ${percent}% of sampled pixels changed across ${delayMs}ms.${localized} Findings from this bundle may reflect a mid-animation frame.`;
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
