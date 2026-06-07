import fs from 'node:fs';
import { flattenAxTree } from './ax-tree.mjs';
import { detectAccessibilityIssues } from './detectors/accessibility.mjs';
import { detectEvidenceQuality } from './detectors/evidence-quality.mjs';
import { detectLayoutIssues } from './detectors/layout.mjs';
import { detectLogIssues } from './detectors/logs.mjs';
import { sortFindings, summarizeFindings } from './findings.mjs';
import { loadEvidenceBundle } from './load-evidence.mjs';
import { writeCritiqueArtifacts } from './report.mjs';

/**
 * Runs deterministic critique against one evidence bundle.
 * @param {object} options Critique options.
 * @param {string} [options.root] Project root.
 * @param {string} options.bundlePath Evidence bundle directory or manifest path.
 * @returns {Promise<object>} Critique result.
 */
export async function collectCritique(options) {
  const context = loadEvidenceBundle({ root: options.root || process.cwd(), bundlePath: options.bundlePath });
  const findings = [];
  findings.push(...detectEvidenceQuality(context));

  const axTree = loadAxTree(context);
  if (axTree) {
    const nodes = flattenAxTree(axTree);
    findings.push(...detectAccessibilityIssues(context, nodes));
    findings.push(...detectLayoutIssues(context, nodes));
  }

  findings.push(...await detectLogIssues(context));

  const sortedFindings = sortFindings(findings);
  const summary = summarizeFindings(sortedFindings);
  const written = writeCritiqueArtifacts(context, sortedFindings, summary);

  return {
    ok: true,
    command: 'critique',
    bundle: context.bundle,
    evidence: context.manifestPathDisplay,
    artifacts: written,
    summary,
    findings: sortedFindings
  };
}

/**
 * Loads the AX tree when available.
 * @param {object} context Evidence context.
 * @returns {object|null} Accessibility tree or null.
 */
function loadAxTree(context) {
  if (!context.artifacts.accessibilityTree.exists) return null;
  return JSON.parse(fs.readFileSync(context.artifacts.accessibilityTree.absolutePath, 'utf8'));
}
