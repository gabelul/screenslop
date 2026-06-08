const evidenceQualityPrefix = 'evidence.';

/**
 * Compares baseline findings against fresh findings.
 * @param {object} options Match options.
 * @param {object[]} options.baselineFindings Baseline findings.
 * @param {object[]} options.freshFindings Fresh findings.
 * @param {string[]} [options.selectedIds] Selected baseline IDs.
 * @param {object|null} [options.fixSession] Optional fix session wrapper.
 * @returns {object[]} Verification items.
 */
export function matchFindings(options) {
  const selectedIds = options.selectedIds || [];
  const byBaselineId = new Map(options.baselineFindings.map((finding) => [finding.id, finding]));
  const selected = selectedIds.length > 0
    ? selectedIds.map((id) => byBaselineId.get(id)).filter(Boolean)
    : options.baselineFindings;
  const items = selected.map((finding) => matchFinding({
    baseline: finding,
    freshFindings: options.freshFindings,
    fixSession: options.fixSession || null
  }));

  for (const id of selectedIds) {
    if (byBaselineId.has(id)) continue;
    items.push({
      findingId: id,
      ruleId: null,
      status: 'missing-baseline',
      matchKey: null,
      freshFindingId: null,
      confidence: 'low',
      reason: 'Selected finding ID does not exist in the baseline findings.',
      baselineEvidence: null,
      freshEvidence: null,
      fixSessionItem: null
    });
  }

  return items;
}

/**
 * Summarizes verification items by status.
 * @param {object[]} items Verification items.
 * @returns {object} Summary counts.
 */
export function summarizeVerification(items) {
  const summary = {
    total: items.length,
    verifiedFixed: 0,
    stillPresent: 0,
    changed: 0,
    unknown: 0,
    notSelected: 0,
    missingBaseline: 0,
    unverified: 0
  };

  const keyByStatus = {
    'verified-fixed': 'verifiedFixed',
    'still-present': 'stillPresent',
    changed: 'changed',
    unknown: 'unknown',
    'not-selected': 'notSelected',
    'missing-baseline': 'missingBaseline',
    unverified: 'unverified'
  };

  for (const item of items) {
    const key = keyByStatus[item.status];
    if (key) summary[key] += 1;
  }

  return summary;
}

/**
 * Matches one baseline finding against fresh findings.
 * @param {object} options Match options.
 * @returns {object} Verification item.
 */
function matchFinding({ baseline, freshFindings, fixSession }) {
  const baselineKeys = strongKeys(baseline);
  const sameRule = freshFindings.filter((finding) => finding.ruleId === baseline.ruleId);
  const fixSessionItem = findFixSessionItem(fixSession, baseline.id);

  for (const key of baselineKeys) {
    const freshMatch = sameRule.find((finding) => strongKeys(finding).some((freshKey) => freshKey.value === key.value));
    if (!freshMatch) continue;
    return item({
      baseline,
      status: 'still-present',
      matchKey: key.value,
      freshFinding: freshMatch,
      confidence: key.confidence,
      reason: `Fresh critique still contains ${key.value}.`,
      fixSessionItem
    });
  }

  if (baseline.ruleId?.startsWith(evidenceQualityPrefix)) {
    return sameRule.length > 0
      ? item({ baseline, status: 'still-present', matchKey: `ruleId=${baseline.ruleId}`, freshFinding: sameRule[0], confidence: 'high', reason: 'Fresh critique still reports the same evidence-quality rule.', fixSessionItem })
      : item({ baseline, status: 'verified-fixed', matchKey: `ruleId=${baseline.ruleId}`, freshFinding: null, confidence: 'high', reason: 'Fresh critique no longer reports this evidence-quality rule.', fixSessionItem });
  }

  if (sameRule.length === 0) {
    return item({
      baseline,
      status: 'verified-fixed',
      matchKey: baselineKeys[0]?.value || `ruleId=${baseline.ruleId}`,
      freshFinding: null,
      confidence: baselineKeys.length > 0 ? baselineKeys[0].confidence : 'medium',
      reason: 'Fresh critique no longer reports this rule.',
      fixSessionItem
    });
  }

  if (baselineKeys.length > 0) {
    return item({
      baseline,
      status: 'changed',
      matchKey: baselineKeys[0].value,
      freshFinding: sameRule[0],
      confidence: 'medium',
      reason: 'Fresh critique still reports the same rule, but not the same stable evidence key.',
      fixSessionItem
    });
  }

  return item({
    baseline,
    status: 'unknown',
    matchKey: null,
    freshFinding: sameRule[0],
    confidence: 'low',
    reason: 'Baseline finding lacks a stable evidence key and related fresh findings remain.',
    fixSessionItem
  });
}

/**
 * Extracts stable keys used for conservative finding matching.
 * @param {object} finding Finding.
 * @returns {{value:string,confidence:string}[]} Match keys.
 */
export function strongKeys(finding) {
  const keys = [];
  const identifier = finding.evidence?.node?.identifier;
  if (identifier) return [{ value: `ruleId=${finding.ruleId};node.identifier=${identifier}`, confidence: 'high' }];

  const sourceHint = finding.evidence?.sourceHint;
  if (sourceHint) keys.push({ value: `ruleId=${finding.ruleId};sourceHint=${sourceHint}`, confidence: 'high' });

  const line = finding.evidence?.line;
  const snippet = finding.evidence?.snippet;
  if (line !== undefined && snippet) keys.push({ value: `ruleId=${finding.ruleId};line=${line};snippet=${snippet}`, confidence: 'medium' });

  return keys;
}

/**
 * Builds a normalized verification item.
 * @param {object} options Item options.
 * @returns {object} Verification item.
 */
function item({ baseline, status, matchKey, freshFinding, confidence, reason, fixSessionItem }) {
  return {
    findingId: baseline.id,
    ruleId: baseline.ruleId,
    status,
    matchKey,
    freshFindingId: freshFinding?.id || null,
    confidence,
    reason,
    baselineEvidence: baseline.evidence || null,
    freshEvidence: freshFinding?.evidence || null,
    fixSessionItem
  };
}

/**
 * Finds optional fix session context for a baseline finding.
 * @param {object|null} fixSession Fix session wrapper.
 * @param {string} findingId Baseline finding ID.
 * @returns {object|null} Matching fix session context.
 */
function findFixSessionItem(fixSession, findingId) {
  if (!fixSession?.payload) return null;
  const patch = fixSession.payload.appliedPatches?.find((item) => item.findingId === findingId) || null;
  if (!patch) return null;
  return {
    status: fixSession.payload.verification?.status || 'applied',
    file: patch.file || null,
    line: patch.line || null
  };
}
