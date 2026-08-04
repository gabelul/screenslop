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
// stable, while a solid block of the same size read as unstable. Density is the
// wrong question — what separates a spinner from noise is how tightly grouped
// the changes are, not how solidly they fill their own outline.
//
// Localized motion is therefore measured with a fixed-size sliding window: if
// any window holds enough changed samples, something was moving there.
//
// This is the third design for this signal and the first that is monotonic by
// construction. A single global bounding box failed because two spinners in
// opposite corners inflated one box past its area limit. Connected components
// failed the same way one level down — a sparse diagonal of changes bridged
// everything into one screen-sized component. Both asked "is this region
// compact", and compactness *falls* as samples are added, so adding motion
// could remove detection. A window count only ever rises, which buys the
// invariant those designs lacked: if a set of changes is unstable, every
// superset of it stays unstable.
//
// A rotating arc changes only its leading and trailing edges — six samples for
// a 45 degree step, four for 22.5 — and they land on opposite sides of the
// indicator, which is what the window has to be wide enough to hold.
//
// Two is the floor. Three missed slower rotations, and the floor can go this
// low because the noise level is genuinely zero: three real captures of a live
// simulator, four to six seconds apart, each reported changedRatio 0. One
// stray sample could be a codec artifact; two inside one small window is a
// shape. Swept across scales, start angles and lattice phases, every rotation
// of 22.5 degrees or more is caught. A 10 degree step — a spinner turning at
// 40 degrees per second, far slower than the ~360 a real indicator runs at —
// can still escape.
const localizedWindowRadius = 10;
// Packs a cell pair into one integer key; comfortably above any lattice width.
const cellKeyStride = 100000;
// A caret is about 2pt wide; this covers it at every display scale.
const caretMaxWidthPx = 8;
const minLocalizedChanges = 2;
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
 * @param {object} [options] Comparison options.
 * @param {{x:number,y:number,width:number,height:number}[]} [options.editableRegions]
 *   Pixel frames of editable text fields. Motion confined to a caret-width
 *   sliver inside one of these is exempted; motion anywhere else is not.
 * @returns {{status:string, changedRatio:number|null, sampled:number}} Stability verdict.
 */
export function compareFrames(first, second, options = {}) {
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
  // Cells are only needed for the localized scan, which never runs once the
  // global rule has tripped. Recording past that point costs memory to build a
  // list that will be discarded — on an 8K full-frame diff, millions of
  // entries. Stop at the count that makes the global rule certain.
  const totalSamples = Math.ceil(first.width / step) * Math.ceil(first.height / step);
  const cellBudget = Math.ceil(totalSamples * unstableChangedRatio) + 1;
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
        if (changed <= cellBudget) changedCells.push(Math.round(x / step), Math.round(y / step));
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

  // Short-circuit: once the global or tile rule has proved instability there is
  // nothing left to learn, and the window scan is the expensive part. Skipping
  // it keeps full-frame motion — where `changedCells` is largest — cheap.
  const alreadyUnstable = changedRatio > unstableChangedRatio || busiestTile > unstableTileRatio;
  const localized = alreadyUnstable ? false : hasLocalizedMotion(changedCells);

  // A blinking caret is motion, and the floor needed to see a turning spinner is
  // below what a caret produces — no threshold separates them. Rather than lose
  // one or accept the other everywhere, motion is exempted only when it is
  // confined to a caret-width sliver inside a text field. Anything wider, or
  // anything outside a field, still fails. Note this is bounded by the *field*
  // rather than by focus: the runtime's accessibility tree exposes no focused
  // flag, so a field is the tightest bound available.
  const caretExempt = (alreadyUnstable || localized)
    && isCaretConfined(changedCells, step, options.editableRegions);

  return {
    status: (alreadyUnstable || localized) && !caretExempt ? 'unstable' : 'stable',
    changedRatio,
    busiestTileRatio: busiestTile,
    localizedMotion: localized && !caretExempt,
    ...(caretExempt ? { caretExempt: true } : {}),
    sampled
  };
}

/**
 * Reports whether every change sits in a caret-width sliver inside one text field.
 *
 * @param {number[]} cells Packed changed-cell coordinates, x then y.
 * @param {number} step Lattice step in pixels.
 * @param {{x:number,y:number,width:number,height:number}[]} [regions] Editable field frames, in pixels.
 * @returns {boolean} Whether the motion is caret-shaped and field-confined.
 */
function isCaretConfined(cells, step, regions) {
  if (!Array.isArray(regions) || regions.length === 0 || cells.length === 0) return false;

  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < cells.length; i += 2) {
    const x = cells[i] * step;
    const y = cells[i + 1] * step;
    const inside = regions.some((region) => (
      x >= region.x && x < region.x + region.width && y >= region.y && y < region.y + region.height
    ));
    // One changed sample outside every field disqualifies the whole capture.
    if (!inside) return false;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
  }

  // A caret is a narrow vertical bar. A field whose whole content repaints is
  // not a caret, and must not borrow the exemption.
  const widest = Math.max(...regions.map((region) => region.width));
  return (maxX - minX + step) <= Math.max(caretMaxWidthPx, widest / 8);
}

/**
 * Reports whether any fixed window holds enough changed samples.
 *
 * Monotonic by construction: every changed cell can only add to the windows it
 * falls in, so a superset of an unstable change set can never become stable.
 *
 * @param {Int32Array|number[]} cells Packed changed-cell coordinates, x then y.
 * @returns {boolean} Whether localized motion was found.
 */
function hasLocalizedMotion(cells) {
  const count = cells.length / 2;
  if (count < minLocalizedChanges) return false;

  // Numeric keys, not strings: a full-frame diff would otherwise materialize
  // hundreds of thousands of string keys purely to be discarded.
  const occupied = new Set();
  for (let i = 0; i < cells.length; i += 2) occupied.add(cells[i] * cellKeyStride + cells[i + 1]);

  for (let i = 0; i < cells.length; i += 2) {
    const cx = cells[i];
    const cy = cells[i + 1];
    let neighbours = 0;
    for (let dx = -localizedWindowRadius; dx <= localizedWindowRadius; dx += 1) {
      for (let dy = -localizedWindowRadius; dy <= localizedWindowRadius; dy += 1) {
        if (occupied.has((cx + dx) * cellKeyStride + (cy + dy))) {
          neighbours += 1;
          if (neighbours >= minLocalizedChanges) return true;
        }
      }
    }
  }
  return false;
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
 * Reports whether a pixel accessor is usable for comparison.
 * @param {object|null} image Pixel accessor.
 * @returns {boolean} True when the accessor has real dimensions.
 */
function usable(image) {
  return Boolean(image) && Number.isFinite(image.width) && Number.isFinite(image.height)
    && image.width > 0 && image.height > 0;
}
