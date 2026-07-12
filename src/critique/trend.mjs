import fs from 'node:fs';
import path from 'node:path';

const severityLevels = ['P0', 'P1', 'P2', 'P3'];
const findingListCap = 10;

/**
 * Compares this run's findings against the most recent previous critique in
 * sibling bundles, so repeat runs report a trend instead of an amnesiac
 * snapshot.
 * @param {object} options Trend options.
 * @param {string} options.bundleDir Current evidence bundle directory.
 * @param {object[]} options.findings Current sorted findings.
 * @param {object} [options.summary] Current finding summary (unused fallback source for counts).
 * @returns {object} Trend result: no-baseline or a compared delta.
 */
export function computeCritiqueTrend({ bundleDir, findings, summary }) {
  const previousDir = findPreviousBundleDir(path.resolve(bundleDir));
  if (!previousDir) return { status: 'no-baseline', previousBundle: null };

  const previousFindings = readFindingsFile(path.join(previousDir, 'findings.json'));
  if (!previousFindings) return { status: 'no-baseline', previousBundle: null };

  const currentFindings = Array.isArray(findings) ? findings : [];
  const currentIds = new Set(currentFindings.map((finding) => finding.id));
  const previousIds = new Set(previousFindings.map((finding) => finding.id));

  const newFindings = currentFindings.filter((finding) => !previousIds.has(finding.id));
  const resolvedFindings = previousFindings.filter((finding) => !currentIds.has(finding.id));
  const unchangedCount = currentFindings.filter((finding) => previousIds.has(finding.id)).length;

  const currentCounts = countBySeverity(currentFindings, summary);
  const previousCounts = countBySeverity(previousFindings);
  const deltaBySeverity = Object.fromEntries(
    severityLevels.map((level) => [level, currentCounts[level] - previousCounts[level]])
  );

  return {
    status: 'compared',
    previousBundle: path.basename(previousDir),
    newFindings: newFindings.slice(0, findingListCap).map(briefFinding),
    resolvedFindings: resolvedFindings.slice(0, findingListCap).map(briefFinding),
    unchangedCount,
    deltaBySeverity
  };
}

/**
 * Writes the trend artifact into the bundle directory.
 * @param {string} bundleDir Evidence bundle directory.
 * @param {object} trend Trend result from computeCritiqueTrend.
 * @returns {string} Written trend.json path.
 */
export function writeTrendArtifact(bundleDir, trend) {
  const trendPath = path.join(bundleDir, 'trend.json');
  fs.writeFileSync(trendPath, `${JSON.stringify(trend, null, 2)}\n`);
  return trendPath;
}

/**
 * Finds the most recent sibling bundle older than the current one.
 *
 * Recency uses directory mtime; equal mtimes fall back to lexicographic
 * run-id ordering, which works because run ids start with ISO timestamps.
 * @param {string} bundleDir Absolute current bundle directory.
 * @returns {string|null} Previous bundle directory or null.
 */
function findPreviousBundleDir(bundleDir) {
  const parentDir = path.dirname(bundleDir);
  const bundleName = path.basename(bundleDir);
  const bundleMtime = safeMtime(bundleDir);
  if (bundleMtime === null) return null;

  let entries;
  try {
    entries = fs.readdirSync(parentDir, { withFileTypes: true });
  } catch {
    return null;
  }

  // Comparing a Settings run against a Home run yields garbage deltas, so
  // only same-surface siblings qualify as a baseline. Bundles without a
  // surface (both null) still match each other.
  const surface = readBundleSurface(bundleDir);

  const candidates = entries
    .filter((entry) => entry.isDirectory() && entry.name !== bundleName)
    .map((entry) => ({ dir: path.join(parentDir, entry.name), name: entry.name }))
    .filter((candidate) => fs.existsSync(path.join(candidate.dir, 'findings.json')))
    .filter((candidate) => readBundleSurface(candidate.dir) === surface)
    .map((candidate) => ({ ...candidate, mtime: safeMtime(candidate.dir) }))
    .filter((candidate) => candidate.mtime !== null)
    .filter((candidate) => isOlderRun(candidate, { name: bundleName, mtime: bundleMtime }));

  if (candidates.length === 0) return null;

  candidates.sort((left, right) => {
    if (left.mtime !== right.mtime) return right.mtime - left.mtime;
    return right.name.localeCompare(left.name);
  });
  return candidates[0].dir;
}

/**
 * Orders two runs: mtime first, lexicographic run id on ties.
 * @param {{name:string,mtime:number}} candidate Sibling run.
 * @param {{name:string,mtime:number}} current Current run.
 * @returns {boolean} True when the candidate ran before the current bundle.
 */
function isOlderRun(candidate, current) {
  if (candidate.mtime !== current.mtime) return candidate.mtime < current.mtime;
  return candidate.name.localeCompare(current.name) < 0;
}

/**
 * Reads a findings.json defensively; anything unreadable means no baseline.
 * @param {string} findingsPath Path to a findings.json artifact.
 * @returns {object[]|null} Previous findings or null.
 */
function readFindingsFile(findingsPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
    return Array.isArray(parsed.findings) ? parsed.findings : null;
  } catch {
    return null;
  }
}

/**
 * Counts findings per severity level, preferring an existing summary.
 * @param {object[]} findings Critique findings.
 * @param {object} [summary] Optional summary with bySeverity counts.
 * @returns {object} Counts keyed by P0-P3.
 */
function countBySeverity(findings, summary) {
  if (summary?.bySeverity) {
    return Object.fromEntries(severityLevels.map((level) => [level, summary.bySeverity[level] || 0]));
  }
  const counts = Object.fromEntries(severityLevels.map((level) => [level, 0]));
  for (const finding of findings) {
    if (Object.hasOwn(counts, finding.severity)) counts[finding.severity] += 1;
  }
  return counts;
}

/**
 * Reduces a finding to the compact trend shape. No paths, so the trend
 * artifact stays redaction-safe.
 * @param {object} finding Critique finding.
 * @returns {{id:string,ruleId:string,severity:string,title:string}} Compact finding.
 */
function briefFinding(finding) {
  return {
    id: finding.id,
    ruleId: finding.ruleId,
    severity: finding.severity,
    title: finding.title
  };
}

/**
 * Reads a bundle's captured surface from its evidence manifest.
 * @param {string} dir Bundle directory.
 * @returns {string|null} Surface name or null when absent/unreadable.
 */
function readBundleSurface(dir) {
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'evidence.json'), 'utf8'));
    return manifest.surface ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns a directory mtime in milliseconds, or null when unreadable.
 * @param {string} dir Directory path.
 * @returns {number|null} Mtime or null.
 */
function safeMtime(dir) {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return null;
  }
}
