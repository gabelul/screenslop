/**
 * Builds the machine-readable fix plan payload.
 * @param {object} options Plan options.
 * @returns {object} Fix plan.
 */
export function buildFixPlan(options) {
  return {
    ok: true,
    command: 'fix',
    bundle: options.bundle,
    createdAt: new Date().toISOString(),
    sourceRoot: options.sourceRoot,
    selectedFindings: options.items.map((item) => item.findingId),
    missingFindings: options.missingFindings || [],
    items: options.items,
    artifacts: options.artifacts
  };
}

/**
 * Summarizes fix items by status.
 * @param {object[]} items Fix items.
 * @returns {Record<string, number>} Status counts.
 */
export function summarizeFixItems(items) {
  const summary = {};
  for (const item of items) summary[item.status] = (summary[item.status] || 0) + 1;
  return summary;
}
