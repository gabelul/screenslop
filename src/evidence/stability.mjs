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
// Changed samples are grouped into connected clusters and each is judged alone.
// A single global bounding box was non-monotonic: two spinners in opposite
// corners inflated one box past the area limit and the screen came back *more*
// stable than either spinner produced by itself. Adding motion must never
// reduce detection.
// Three, not more. A rotating arc changes only its leading and trailing edges,
// which land on opposite sides of the indicator and cluster separately — six
// changed samples in total became two groups of three. Static captures come
// back byte-identical, so zero is the noise floor and three sits far above it.
//
// This does mean a blinking caret reads as motion, because it is motion. The
// costs are not symmetric: a false `stable` silently licenses a verified-fixed
// claim, while a false `unstable` downgrades a result visibly and recoverably.
// When in doubt, say the screen was moving.
const minLocalizedChanges = 3;
const maxLocalizedArea = 0.05;
// Sparse strokes leave gaps on the sample lattice, so neighbours within two
// cells join the same cluster rather than splintering into unqualified specks.
const clusterGap = 2;
// Sampling density is what actually limits the smallest detectable motion, and
// the limit is stroke width, not overall size.
//
// Deriving the step from total pixel area ties it to one device: a 2pt stroke
// is 6px on a 3x phone but 4px on a 2x iPad, whose larger capture pushed the
// step to 8px and walked straight over it. So the step is capped absolutely
// rather than trusted to fall out of an area budget. Four pixels intercepts a
// 2pt stroke at 2x and 3x alike; the sample count then follows from whatever
// the capture actually is.
const targetSampleCount = 90000;
const maxSampleStep = 4;

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

  const step = Math.min(
    maxSampleStep,
    Math.max(1, Math.round(Math.sqrt((first.width * first.height) / targetSampleCount)))
  );
  // One tile map per offset grid; a sample lands in exactly one tile of each.
  const grids = tileOffsets.map(() => new Map());
  const changedCells = [];
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
        changedCells.push([Math.round(x / step), Math.round(y / step)]);
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

  // Enough changes packed into one compact cluster is motion, however thin the
  // shape. Each cluster stands alone, so a second animation elsewhere can only
  // add detections, never cancel one.
  const localized = clustersOf(changedCells).some((cluster) => {
    if (cluster.count < minLocalizedChanges) return false;
    const boxArea = ((cluster.maxX - cluster.minX + 1) * (cluster.maxY - cluster.minY + 1) * step * step)
      / (first.width * first.height);
    return boxArea > 0 && boxArea <= maxLocalizedArea;
  });

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
  // A rotating indicator changes a rounding error's worth of the screen, so
  // quoting only the global percentage read "0.0% changed" on a capture that
  // was flagged as moving. Name whichever signal actually tripped.
  const globalTripped = (verdict.changedRatio ?? 0) > unstableChangedRatio;
  if (globalTripped) {
    return `Screen was still moving: ${percent}% of sampled pixels changed across ${delayMs}ms. Findings from this bundle may reflect a mid-animation frame.`;
  }

  const where = (verdict.busiestTileRatio ?? 0) > unstableTileRatio
    ? `one region changed ${((verdict.busiestTileRatio ?? 0) * 100).toFixed(0)}%`
    : 'a small area kept changing';
  return `Screen was still moving in one place across ${delayMs}ms: ${where} while the screen overall barely moved (${percent}%). That is the signature of a spinner or loading state. Findings from this bundle may reflect a mid-animation frame.`;
}

/**
 * Groups changed lattice cells into connected clusters.
 *
 * Flood fill over the sample lattice, joining cells within `clusterGap` so a
 * dashed arc or a spoke with gaps stays one shape instead of fragmenting into
 * pieces too small to qualify.
 *
 * @param {Array<[number, number]>} cells Changed cell coordinates.
 * @returns {{count:number, minX:number, maxX:number, minY:number, maxY:number}[]} Clusters.
 */
function clustersOf(cells) {
  const remaining = new Map(cells.map(([x, y]) => [`${x},${y}`, [x, y]]));
  const clusters = [];

  while (remaining.size > 0) {
    const [firstKey, firstCell] = remaining.entries().next().value;
    remaining.delete(firstKey);
    const cluster = { count: 0, minX: firstCell[0], maxX: firstCell[0], minY: firstCell[1], maxY: firstCell[1] };
    const queue = [firstCell];

    while (queue.length > 0) {
      const [x, y] = queue.pop();
      cluster.count += 1;
      if (x < cluster.minX) cluster.minX = x;
      if (x > cluster.maxX) cluster.maxX = x;
      if (y < cluster.minY) cluster.minY = y;
      if (y > cluster.maxY) cluster.maxY = y;

      for (let dx = -clusterGap; dx <= clusterGap; dx += 1) {
        for (let dy = -clusterGap; dy <= clusterGap; dy += 1) {
          const key = `${x + dx},${y + dy}`;
          const neighbour = remaining.get(key);
          if (!neighbour) continue;
          remaining.delete(key);
          queue.push(neighbour);
        }
      }
    }
    clusters.push(cluster);
  }
  return clusters;
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
