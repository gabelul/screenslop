const severityOrder = new Map([['P0', 0], ['P1', 1], ['P2', 2], ['P3', 3]]);

/**
 * Selects findings requested by the user, or all findings in severity order.
 * @param {object[]} findings Available findings.
 * @param {string[]} requestedIds Requested finding IDs.
 * @returns {{selected:object[], missingIds:string[]}}
 */
export function selectFindings(findings, requestedIds = []) {
  const sorted = [...findings].sort((a, b) => {
    const severityDelta = (severityOrder.get(a.severity) ?? 9) - (severityOrder.get(b.severity) ?? 9);
    if (severityDelta !== 0) return severityDelta;
    return String(a.id).localeCompare(String(b.id));
  });

  if (requestedIds.length === 0) return { selected: sorted, missingIds: [] };

  const byId = new Map(findings.map((finding) => [finding.id, finding]));
  const selected = [];
  const missingIds = [];

  for (const id of requestedIds) {
    if (byId.has(id)) selected.push(byId.get(id));
    else missingIds.push(id);
  }

  return { selected, missingIds };
}
