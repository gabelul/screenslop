/**
 * Checks that two bundles are evidence about the same thing before their
 * findings are compared.
 *
 * `verify` matches findings by fingerprint across whatever pair of bundles it is
 * handed. Nothing checked that the pair showed the same app, or even the same
 * screen — so a Home baseline could be "verified" against a Settings capture and
 * report verified-fixed with full confidence, because the finding's node path
 * simply no longer matched anything.
 *
 * Same shape as the stability gate: a fix cannot be proven on evidence that does
 * not describe the thing that was fixed.
 */

/**
 * Reads the recorded capture subject from an evidence manifest.
 * @param {object} manifest Evidence manifest.
 * @returns {{app:string|null, screen:string|null, surface:string|null}} Subject.
 */
export function readSubject(manifest) {
  const foreground = manifest?.capture?.foreground || null;
  return {
    app: foreground?.observed || null,
    screen: foreground?.screenTitle || null,
    surface: foreground?.declaredSurface ?? manifest?.surface ?? null
  };
}

/**
 * Compares two capture subjects.
 *
 * Only a positive disagreement counts. Bundles written before this was recorded
 * carry nulls, and treating "not recorded" as "different" would fail every
 * verification against an older baseline.
 *
 * @param {object} baseline Baseline subject.
 * @param {object} fresh Fresh subject.
 * @returns {{status:string, reason:string|null}} Comparison verdict.
 */
export function compareSubjects(baseline, fresh) {
  const differs = (left, right) => Boolean(left) && Boolean(right)
    && left.toLowerCase() !== right.toLowerCase();

  if (differs(baseline.app, fresh.app)) {
    return { status: 'different-app', reason: 'The baseline and fresh captures are of different apps.' };
  }
  if (differs(baseline.screen, fresh.screen)) {
    return {
      status: 'different-screen',
      reason: `The baseline heading was "${baseline.screen}" and the fresh one is "${fresh.screen}" — these look like different screens.`
    };
  }
  // Declared surface names are deliberately not compared. They are operator
  // claims, and gating on them both withdraws proof for a harmless rename and
  // misses the case this exists for — the bug that prompted it had two bundles
  // that both said "home" while showing different screens.
  return { status: 'same', reason: null };
}

/**
 * Downgrades proof claims when the two bundles are not about the same subject.
 *
 * A finding that vanished because the fresh capture was of a different screen
 * has not been fixed — it was not looked at. Confidence on still-present drops
 * for the same reason: a match across mismatched subjects is a coincidence of
 * node paths, not evidence.
 *
 * @param {object[]} items Matched verification items.
 * @param {{status:string, reason:string|null}} subject Subject comparison.
 * @returns {object[]} Gated items.
 */
export function applySubjectGate(items, subject) {
  if (!subject || subject.status === 'same') return items;

  return items.map((item) => {
    if (item.status === 'verified-fixed') {
      return {
        ...item,
        status: 'needs-human-review',
        confidence: 'low',
        note: [item.note, subject.reason].filter(Boolean).join(' ')
      };
    }
    if (item.status === 'still-present' && item.confidence === 'high') {
      return { ...item, confidence: 'medium', note: [item.note, subject.reason].filter(Boolean).join(' ') };
    }
    return item;
  });
}
