/**
 * Builds a filesystem-safe run id.
 * @param {string | undefined} surface Optional human surface name.
 * @param {Date} now Date used for deterministic tests.
 * @returns {string} Run id like 2026-06-07T11-30-00-settings.
 */
export function createRunId(surface, now = new Date()) {
  const stamp = now.toISOString().replace(/\.\d{3}Z$/, 'Z').replaceAll(':', '-');
  const slug = String(surface || 'screen')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '') || 'screen';
  return `${stamp}-${slug}`;
}
