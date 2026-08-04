// Proof gating on capture stability.
//
// `see` learned to detect that a screen was still moving when it was
// photographed, but verification never asked. That left the tool's central
// claim open at the widest point: a baseline finding can vanish from a fresh
// critique simply because the fresh screenshot caught a transition mid-flight,
// and verification would report `verified-fixed` at high confidence.
//
// Capturing artifacts successfully and establishing that they prove something
// are different things, so they are gated separately.
//
// `verified-fixed` is a proof label, and only a measured `stable` earns it.
// An unstable capture, a failed probe, and a bundle that predates this check
// all fail to establish stillness, so none of them may claim it. The first
// version of this gate let the last two keep `verified-fixed` with a reduced
// confidence and a reason admitting stability was unproven — a status
// contradicting its own explanation. Backward compatibility is a reason to keep
// old bundles readable, not a reason to grant them proof they cannot support.
// Those results route to `needs-human-review` instead: still usable, no longer
// claiming more than the evidence carries.

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
 * Withholds deterministic proof from items resting on an unproven fresh capture.
 *
 * @param {object[]} items Verification items.
 * @param {{status:string, changedRatio:number|null, reason:string|null}} stability Fresh bundle stability.
 * @returns {object[]} Items with proof gating applied.
 */
export function applyStabilityGate(items, stability) {
  if (stability.status === 'stable') return items;

  const unstable = stability.status === 'unstable';
  const measured = Number.isFinite(stability.changedRatio)
    ? `${(stability.changedRatio * 100).toFixed(1)}% of sampled pixels changed`
    : 'the screen was still moving';

  return items.map((item) => {
    if (item.status === 'verified-fixed') {
      return {
        ...item,
        status: 'needs-human-review',
        confidence: 'low',
        reason: unstable
          ? `${item.reason} But the fresh capture was unstable (${measured}), so this finding may have disappeared because the screenshot caught an animation rather than because it was fixed.`
          : `${item.reason} Capture stability was never established for the fresh bundle${stability.reason ? ` (${stability.reason})` : ''}, so this cannot be reported as deterministic proof.`
      };
    }

    // A moving frame can also invent a finding — a label caught mid-fade
    // measures a contrast it never has at rest — so a still-present result on
    // an unstable capture is not the confirmation it looks like. It keeps its
    // status, because the baseline finding genuinely has not been shown gone,
    // but it stops claiming high confidence.
    if (unstable && item.status === 'still-present' && item.confidence === 'high') {
      return {
        ...item,
        confidence: 'medium',
        reason: `${item.reason} The fresh capture was unstable (${measured}), so the matching fresh finding may itself be an artifact of motion.`
      };
    }

    return item;
  });
}
