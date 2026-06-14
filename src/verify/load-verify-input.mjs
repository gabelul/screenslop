import fs from 'node:fs';
import path from 'node:path';
import { collectCritique } from '../critique/collect-critique.mjs';
import { displayPath, loadEvidenceBundle } from '../critique/load-evidence.mjs';

/**
 * Loads baseline and fresh bundles for the verify command.
 * @param {object} options Load options.
 * @param {string} options.root Screenslop project root.
 * @param {string} options.baselineBundle Baseline evidence bundle path.
 * @param {string} options.freshBundle Fresh evidence bundle path.
 * @param {boolean} [options.refreshCritique] Whether to rerun fresh critique.
 * @param {string|null} [options.fixSessionPath] Optional fix session path.
 * @returns {Promise<object>} Loaded verification input.
 */
export async function loadVerifyInput(options) {
  const root = path.resolve(options.root || process.cwd());
  if (!options.baselineBundle) throw new Error('Missing baseline bundle path. Usage: screenslop verify artifacts/<baseline> --fresh-bundle artifacts/<fresh>');
  if (!options.freshBundle) throw new Error('Missing --fresh-bundle. Verification needs fresh evidence.');

  const baseline = loadEvidenceBundle({ root, bundlePath: options.baselineBundle });
  const fresh = loadEvidenceBundle({ root, bundlePath: options.freshBundle });
  const baselineFindingsPath = path.join(baseline.dir, 'findings.json');

  const baselineFindings = readFindingsFile({ root, file: baselineFindingsPath, label: 'Baseline' });
  const freshInfo = await loadFreshFindings({ root, fresh, refreshCritique: Boolean(options.refreshCritique) });
  const fixSession = loadFixSession({ root, baselineDir: baseline.dir, fixSessionPath: options.fixSessionPath || null });

  return {
    root,
    baseline,
    fresh,
    baselineFindings,
    freshFindings: freshInfo.findings,
    freshHasDesignReview: freshInfo.hasDesignReview,
    baselineFindingsPath,
    freshFindingsPath: freshInfo.findingsPath,
    freshCritiqueRefreshed: freshInfo.refreshed,
    fixSession,
    fixSessionPath: fixSession?.path || null
  };
}

/**
 * Reads a Screenslop findings payload from disk.
 * @param {object} options Read options.
 * @param {string} options.root Project root.
 * @param {string} options.file Findings path.
 * @param {string} options.label Human label for errors.
 * @returns {object[]} Findings array.
 */
export function readFindingsFile(options) {
  return readFindingsPayload(options).findings;
}

/**
 * Loads or creates fresh critique findings.
 * @param {object} options Fresh options.
 * @returns {Promise<{findings:object[],findingsPath:string,refreshed:boolean}>} Fresh findings info.
 */
async function loadFreshFindings({ root, fresh, refreshCritique }) {
  const findingsPath = path.join(fresh.dir, 'findings.json');
  if (!refreshCritique && fs.existsSync(findingsPath)) {
    const payload = readFindingsPayload({ root, file: findingsPath, label: 'Fresh' });
    return {
      findings: payload.findings,
      findingsPath,
      refreshed: false,
      hasDesignReview: hasDesignReviewPayload(payload.raw, payload.findings)
    };
  }

  const result = await collectCritique({ root, bundlePath: fresh.bundle });
  return {
    findings: result.findings,
    findingsPath: path.join(fresh.dir, 'findings.json'),
    refreshed: true,
    hasDesignReview: false
  };
}

/**
 * Reads findings plus raw metadata from disk.
 * @param {object} options Read options.
 * @returns {{findings:object[],raw:unknown}} Findings payload.
 */
function readFindingsPayload(options) {
  if (!fs.existsSync(options.file)) {
    throw new Error(`${options.label} findings file not found: ${displayPath(options.root, options.file)}. Run screenslop critique first.`);
  }

  const raw = JSON.parse(fs.readFileSync(options.file, 'utf8'));
  const findings = Array.isArray(raw) ? raw : raw.findings;
  if (!Array.isArray(findings)) throw new Error(`${options.label} findings file must contain an array or { findings: [] }: ${displayPath(options.root, options.file)}`);
  return { findings, raw };
}

/**
 * Detects whether fresh findings came from a design review pass.
 * @param {unknown} payload Raw findings payload.
 * @param {object[]} findings Parsed findings.
 * @returns {boolean} True when design review provenance is present.
 */
function hasDesignReviewPayload(payload, findings) {
  if (!Array.isArray(findings)) return false;
  return Boolean(payload && typeof payload === 'object' && !Array.isArray(payload) && payload.designReview?.ran === true);
}

/**
 * Loads optional fix-session context when present.
 * @param {object} options Fix session options.
 * @returns {object|null} Fix session wrapper.
 */
function loadFixSession({ root, baselineDir, fixSessionPath }) {
  const candidate = fixSessionPath
    ? path.resolve(root, fixSessionPath)
    : path.join(baselineDir, 'fix-session.json');

  if (!fs.existsSync(candidate)) return null;
  return {
    path: displayPath(root, candidate),
    payload: JSON.parse(fs.readFileSync(candidate, 'utf8'))
  };
}
