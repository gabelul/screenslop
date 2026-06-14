import fs from 'node:fs';
import path from 'node:path';
import { displayPath } from '../critique/load-evidence.mjs';

/**
 * Writes verification artifacts into the baseline bundle.
 * @param {object} context Report context.
 * @param {object} result Verification result.
 * @returns {{verificationPath:string,reportPath:string}} Artifact paths.
 */
export function writeVerificationArtifacts(context, result) {
  const verificationPath = path.join(context.baseline.dir, 'verification.json');
  const reportPath = path.join(context.baseline.dir, 'verification.md');
  const artifacts = {
    verificationPath: displayPath(context.root, verificationPath),
    reportPath: displayPath(context.root, reportPath)
  };
  const payload = { ...result, artifacts };

  fs.writeFileSync(verificationPath, `${JSON.stringify(payload, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderVerificationMarkdown(payload));
  return artifacts;
}

/**
 * Renders a Markdown verification report.
 * @param {object} result Verification result.
 * @returns {string} Markdown report.
 */
export function renderVerificationMarkdown(result) {
  const lines = [
    '# Screenslop Verification',
    '',
    `Baseline bundle: ${result.baselineBundle}`,
    `Fresh bundle: ${result.freshBundle}`,
    `Created: ${result.createdAt}`,
    '',
    'Verification compares previous findings against fresh critique output. `verified-fixed` is reserved for deterministic measured findings. Design findings use `improved`, `unchanged`, `regressed`, or `needs-human-review`.',
    '',
    '## Summary',
    '',
    `- total: ${result.summary.total}`,
    `- verified-fixed: ${result.summary.verifiedFixed}`,
    `- still-present: ${result.summary.stillPresent}`,
    `- changed: ${result.summary.changed}`,
    `- unknown: ${result.summary.unknown}`,
    `- improved: ${result.summary.improved || 0}`,
    `- unchanged: ${result.summary.unchanged || 0}`,
    `- regressed: ${result.summary.regressed || 0}`,
    `- needs-human-review: ${result.summary.needsHumanReview || 0}`,
    `- missing-baseline: ${result.summary.missingBaseline}`,
    ''
  ];

  for (const status of ['still-present', 'verified-fixed', 'changed', 'unknown', 'improved', 'unchanged', 'regressed', 'needs-human-review', 'missing-baseline']) {
    const items = result.items.filter((item) => item.status === status);
    if (items.length === 0) continue;
    lines.push(`## ${status}`);
    lines.push('');
    for (const item of items) {
      lines.push(`### ${item.findingId}`);
      lines.push('');
      lines.push(`- rule: ${item.ruleId || 'unknown'}`);
      lines.push(`- confidence: ${item.confidence}`);
      lines.push(`- match: ${item.matchKey || 'none'}`);
      lines.push(`- reason: ${item.reason}`);
      if (item.freshFindingId) lines.push(`- fresh finding: ${item.freshFindingId}`);
      if (item.fixSessionItem) lines.push(`- fix session: ${item.fixSessionItem.status}${item.fixSessionItem.file ? ` in ${item.fixSessionItem.file}` : ''}`);
      lines.push('');
    }
  }

  return `${lines.join('\n')}\n`;
}
