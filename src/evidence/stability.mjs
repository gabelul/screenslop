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
//
// Grid size sets the smallest motion this can see. Swept across every position
// on a 402x874 frame, a 16x16 grid catches moving regions down to about 24pt
// square; a 16pt region stays under the tile threshold everywhere. That is the
// honest floor — small enough for a standard activity indicator, not small
// enough for a blinking caret, which is the trade we want.
const tileGridSize = 16;
const unstableTileRatio = 0.2;
// A tile needs enough samples for its ratio to mean anything.
const minTileSamples = 24;
// One fixed grid makes detection depend on where the motion happens to sit: a
// region straddling a tile corner splits across four tiles and hides under the
// per-tile threshold in all of them. Measured on a 402x874 frame, the same
// 44x44 spinner scored 0.24 inside a tile and 0.10 across a corner.
//
// Offsetting both axes together is not enough either — a region centred in x by
// the offset can land on a y boundary instead. Offsetting each axis
// independently gives four grids, and every placement sits away from a boundary
// in at least one of them. Swept across the screen, no position now escapes.
const tileOffsets = [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5]];
// Tiles measure density, and density is the wrong question for a real spinner.
// An activity indicator is thin arcs and gaps, not a filled square: a 24pt
// spinner drawn as two crossed bars changed only 12% of its tile and read as
// stable, while a solid 24pt block of the same size read as unstable. What
// separates a spinner from sensor noise is not how dense it is but how tightly
// clustered — so changed samples are also bounded, and a small bounding box
// holding enough changes counts as localized motion regardless of how sparse
// it is inside. Static captures change zero samples, so the floor can be low.
// Measured on 1206x2622 captures: a blinking caret changes 8 sample points, the
// smallest realistic activity indicator (20pt ring) changes 20. Sixteen sits in
// that gap. The floor this creates is one of moving *area*, not element size —
// roughly an 8pt square's worth of pixels, however that area is shaped.
const minLocalizedChanges = 16;
const maxLocalizedArea = 0.05;
// Sampling density is what actually limits the smallest detectable motion, and
// the limit is stroke width, not overall size. Captures are device pixels, so a
// 2pt spinner stroke is 6px wide. At ~20k samples the grid stepped 9px on a
// 1206x2622 capture and walked straight over those strokes — a ring-shaped
// indicator landed on almost no sample points and read as perfectly still. ~90k
// brings the step to 6px, so any 6px-wide stroke is guaranteed to contain a
// sample row. It is more pixel reads of a cheap operation, spent on the one
// thing that decides whether real spinners are visible at all.
const targetSampleCount = 90000;

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
  // One tile map per offset grid; a sample lands in exactly one tile of each.
  const grids = tileOffsets.map(() => new Map());
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  let changed = 0;
  let sampled = 0;

  for (let y = 0; y < first.height; y += step) {
    for (let x = 0; x < first.width; x += step) {
      const a = first.getPixel(x, y);
      const b = second.getPixel(x, y);
      const delta = Math.max(Math.abs(a.r - b.r), Math.abs(a.g - b.g), Math.abs(a.b - b.b));
      const moved = delta > changedChannelTolerance;
      if (moved) {
        changed += 1;
        if (x < bounds.minX) bounds.minX = x;
        if (x > bounds.maxX) bounds.maxX = x;
        if (y < bounds.minY) bounds.minY = y;
        if (y > bounds.maxY) bounds.maxY = y;
      }
      sampled += 1;

      tileOffsets.forEach(([offsetX, offsetY], index) => {
        const tileX = Math.floor((x / first.width) * tileGridSize - offsetX);
        const tileY = Math.floor((y / first.height) * tileGridSize - offsetY);
        const key = `${tileX},${tileY}`;
        const tile = grids[index].get(key) || { changed: 0, sampled: 0 };
        tile.sampled += 1;
        if (moved) tile.changed += 1;
        grids[index].set(key, tile);
      });
    }
  }

  if (sampled === 0) return { status: 'unknown', changedRatio: null, sampled: 0 };
  const changedRatio = changed / sampled;
  let busiestTile = 0;
  for (const grid of grids) {
    for (const tile of grid.values()) {
      if (tile.sampled < minTileSamples) continue;
      const ratio = tile.changed / tile.sampled;
      if (ratio > busiestTile) busiestTile = ratio;
    }
  }

  // Enough changes packed into a small box is motion, however thin the shape.
  const boxWidth = changed > 0 ? bounds.maxX - bounds.minX + 1 : 0;
  const boxHeight = changed > 0 ? bounds.maxY - bounds.minY + 1 : 0;
  const boxArea = (boxWidth * boxHeight) / (first.width * first.height);
  const localized = changed >= minLocalizedChanges && boxArea > 0 && boxArea <= maxLocalizedArea;

  const unstable = changedRatio > unstableChangedRatio
    || busiestTile > unstableTileRatio
    || localized;
  return {
    status: unstable ? 'unstable' : 'stable',
    changedRatio,
    busiestTileRatio: busiestTile,
    localizedMotion: localized,
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
