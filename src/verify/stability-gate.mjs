// Proof gating on capture stability.
//
// `see` learned to detect that a screen was still moving when it was
// photographed, but verification never asked. That left the tool's central
// claim open at the widest point: a baseline finding can vanish from a fresh
// critique simply because the fresh screenshot caught a transition mid-flight,
// and verification would report `verified-fixed` at high confidence.
//
// Capturing artifacts successfully and establishing that they prove something
// are different things, so they are gated separately. A measured `unstable`
// blocks the deterministic verified-fixed track outright. Stability that was
// never established — an older bundle without the field, or a probe that
// failed — does not block, because that would retroactively invalidate every
// bundle captured before this existed; it downgrades confidence and says so.

/**
 * Reads the stability verdict recorded on a fresh evidence bundle.
 * @param {object|null} manifest Fresh bundle manifest.
 * @returns {{status:string, changedRatio:number|null, reason:string|null}} Normalized verdict.
 */
export function readStability(manifest) {
  const stability = manifest?.capture?.stability;
  if (!stability || typeof stability !== 'object') {
    return { status: 'not-measured', changedRatio: null, reason: 'bundle predates capture-stability checks' };
  }
  const status = ['stable', 'unstable', 'unknown'].includes(stability.status) ? stability.status : 'not-measured';
  return {
    status,
    changedRatio: Number.isFinite(stability.changedRatio) ? stability.changedRatio : null,
    reason: stability.reason || null
  };
}

/**
 * Downgrades verification items whose proof rests on an unproven fresh capture.
 *
 * Only `verified-fixed` is touched. A finding that is still present stays still
 * present — an unstable capture cannot manufacture evidence of a problem that
 * is already visible, it can only manufacture the *absence* of one.
 *
 * @param {object[]} items Verification items.
 * @param {{status:string, changedRatio:number|null, reason:string|null}} stability Fresh bundle stability.
 * @returns {object[]} Items with proof gating applied.
 */
export function applyStabilityGate(items, stability) {
  if (stability.status === 'stable') return items;

  return items.map((item) => {
    if (item.status !== 'verified-fixed') return item;

    if (stability.status === 'unstable') {
      const percent = Number.isFinite(stability.changedRatio)
        ? `${(stability.changedRatio * 100).toFixed(1)}% of sampled pixels changed`
        : 'the screen was still moving';
      return {
        ...item,
        status: 'needs-human-review',
        confidence: 'low',
        reason: `${item.reason} But the fresh capture was unstable (${percent}), so this finding may have disappeared because the screenshot caught an animation rather than because it was fixed.`
      };
    }

    // not-measured or unknown: usable, but not high-confidence proof.
    return {
      ...item,
      confidence: 'medium',
      reason: `${item.reason} Capture stability was not established for the fresh bundle${stability.reason ? ` (${stability.reason})` : ''}, so this is not a stability-proven result.`
    };
  });
}
