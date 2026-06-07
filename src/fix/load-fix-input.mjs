import fs from 'node:fs';
import path from 'node:path';
import { displayPath, loadEvidenceBundle } from '../critique/load-evidence.mjs';

/**
 * Loads a critique bundle plus its generated findings for the fix command.
 * @param {object} options Load options.
 * @param {string} options.root Screenslop project root.
 * @param {string} options.bundlePath Evidence bundle path or evidence.json path.
 * @returns {{root:string, dir:string, bundle:string, findingsPath:string, findingsPathDisplay:string, findings:object[], manifest:object}}
 */
export function loadFixInput(options) {
  if (!options.bundlePath) throw new Error('Missing evidence bundle path. Usage: screenslop fix artifacts/<bundle>');
  const bundle = loadEvidenceBundle(options);
  const findingsPath = path.join(bundle.dir, 'findings.json');

  if (!fs.existsSync(findingsPath)) {
    throw new Error(`Findings file not found: ${displayPath(bundle.root, findingsPath)}. Run screenslop critique first.`);
  }

  const payload = JSON.parse(fs.readFileSync(findingsPath, 'utf8'));
  const findings = Array.isArray(payload) ? payload : payload.findings;
  if (!Array.isArray(findings)) throw new Error(`Findings file must contain an array or { findings: [] }: ${displayPath(bundle.root, findingsPath)}`);

  return {
    root: bundle.root,
    dir: bundle.dir,
    bundle: bundle.bundle,
    manifest: bundle.manifest,
    findingsPath,
    findingsPathDisplay: displayPath(bundle.root, findingsPath),
    findings
  };
}
