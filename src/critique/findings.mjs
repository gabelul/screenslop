import crypto from 'node:crypto';
import { pillars, severity } from './rubric.mjs';

const pillarSet = new Set(pillars);
const severitySet = new Set(Object.keys(severity));

/**
 * Builds a validated critique finding with a deterministic id.
 * @param {object} input Finding input.
 * @param {string} input.ruleId Stable detector rule id.
 * @param {string} input.severity P0-P3 severity.
 * @param {string} input.pillar Screenslop pillar.
 * @param {string} input.title Short issue title.
 * @param {string} [input.detail] Detailed issue text.
 * @param {object} [input.evidence] Evidence pointers.
 * @param {string} [input.suggestedFix] Suggested fix.
 * @param {string} [input.verification] Verification step.
 * @param {string} [input.confidence] Confidence label.
 * @param {string} [input.effort] Effort hint.
 * @param {string} [input.fingerprint] Stable fingerprint seed.
 * @returns {object} Screenslop finding.
 */
export function createFinding(input) {
  if (!severitySet.has(input.severity)) throw new Error(`Unknown finding severity: ${input.severity}`);
  if (!pillarSet.has(input.pillar)) throw new Error(`Unknown finding pillar: ${input.pillar}`);

  const seed = input.fingerprint || JSON.stringify(input.evidence || {});
  const hash = crypto.createHash('sha1').update(`${input.ruleId}:${seed}`).digest('hex').slice(0, 8);

  return stripUndefined({
    id: `${slug(input.ruleId)}-${hash}`,
    ruleId: input.ruleId,
    severity: input.severity,
    pillar: input.pillar,
    title: input.title,
    detail: input.detail,
    evidence: input.evidence || {},
    suggestedFix: input.suggestedFix,
    verification: input.verification,
    confidence: input.confidence || 'medium',
    effort: input.effort || 'medium'
  });
}

/**
 * Summarizes findings by severity and pillar.
 * @param {object[]} findings Critique findings.
 * @returns {object} Summary counts.
 */
export function summarizeFindings(findings) {
  const bySeverity = Object.fromEntries(Object.keys(severity).map((key) => [key, 0]));
  const byPillar = Object.fromEntries(pillars.map((key) => [key, 0]));

  for (const finding of findings) {
    bySeverity[finding.severity] = (bySeverity[finding.severity] || 0) + 1;
    byPillar[finding.pillar] = (byPillar[finding.pillar] || 0) + 1;
  }

  return { total: findings.length, bySeverity, byPillar };
}

/**
 * Orders findings by severity and title for stable output.
 * @param {object[]} findings Critique findings.
 * @returns {object[]} Sorted findings.
 */
export function sortFindings(findings) {
  const order = { P0: 0, P1: 1, P2: 2, P3: 3 };
  return [...findings].sort((left, right) => {
    const severityDelta = order[left.severity] - order[right.severity];
    if (severityDelta !== 0) return severityDelta;
    return `${left.title}${left.id}`.localeCompare(`${right.title}${right.id}`);
  });
}

/**
 * Converts text to a simple slug.
 * @param {string} value Text to slugify.
 * @returns {string} Slug.
 */
export function slug(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'finding';
}

/**
 * Removes undefined fields while preserving nulls.
 * @param {object} value Object to clean.
 * @returns {object} Clean object.
 */
function stripUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}
