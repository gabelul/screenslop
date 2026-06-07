/**
 * Renders a Markdown fix report.
 * @param {object} plan Fix plan.
 * @param {object|null} session Optional fix session.
 * @returns {string} Markdown report.
 */
export function renderFixReport(plan, session = null) {
  const lines = [
    '# Screenslop Fix Report',
    '',
    `Bundle: ${plan.bundle}`,
    `Created: ${plan.createdAt}`,
    `Source root: ${plan.sourceRoot}`,
    '',
    '## Findings',
    ''
  ];

  if (plan.items.length === 0) {
    lines.push('No findings were selected.');
  }

  for (const item of plan.items) {
    lines.push(`### ${item.findingId}`);
    lines.push('');
    lines.push(`- Rule: ${item.ruleId}`);
    lines.push(`- Status: ${item.status}`);
    lines.push(`- Fixability: ${item.fixability}`);
    lines.push(`- Note: ${item.note}`);
    lines.push(`- Verification: ${item.verification}`);

    if (item.sourceCandidates.length > 0) {
      lines.push('- Source candidates:');
      for (const candidate of item.sourceCandidates) {
        lines.push(`  - ${candidate.file}:${candidate.line} (${candidate.confidence}) — ${candidate.reason}`);
      }
    }

    if (item.patchPreview) {
      lines.push('');
      lines.push('```diff');
      lines.push(item.patchPreview);
      lines.push('```');
    }

    lines.push('');
  }

  if (session) {
    lines.push('## Session');
    lines.push('');
    lines.push(`Applied patches: ${session.appliedPatches.length}`);
    if (session.verification) {
      lines.push(`Verification command: ${session.verification.command}`);
      lines.push(`Verification status: ${session.verification.status}`);
    }
  }

  return `${lines.join('\n')}\n`;
}
