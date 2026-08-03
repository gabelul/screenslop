import fs from 'node:fs';
import { flattenAxTree } from './ax-tree.mjs';
import { detectAccessibilityIssues } from './detectors/accessibility.mjs';
import { detectAlignmentIssues } from './detectors/alignment.mjs';
import { detectCognitiveLoadIssues } from './detectors/cognitive-load.mjs';
import { detectColorBalanceIssues } from './detectors/color-balance.mjs';
import { detectContrastIssues } from './detectors/contrast.mjs';
import { detectDesignPlacementIssues } from './detectors/design.mjs';
import { detectEvidenceQuality } from './detectors/evidence-quality.mjs';
import { detectHigPatternIssues } from './detectors/hig-patterns.mjs';
import { detectLayoutIssues } from './detectors/layout.mjs';
import { detectLogIssues } from './detectors/logs.mjs';
import { detectSpacingIssues } from './detectors/spacing.mjs';
import { detectTruncationIssues } from './detectors/truncation.mjs';
import { sortFindings, summarizeFindings } from './findings.mjs';
import { loadEvidenceBundle } from './load-evidence.mjs';
import { loadScreenshotPixels } from './pixels.mjs';
import { writeCritiqueArtifacts } from './report.mjs';
import { computeCritiqueTrend, writeTrendArtifact } from './trend.mjs';

/**
 * Runs deterministic critique against one evidence bundle.
 * @param {object} options Critique options.
 * @param {string} [options.root] Project root.
 * @param {string} options.bundlePath Evidence bundle directory or manifest path.
 * @param {object[]} [options.colorTokens] Learned color tokens, injected by the caller.
 *   Critique never reads the design profile itself — that would put a lane whose
 *   findings feed the verified-fixed track at the mercy of a profile that may be
 *   stale. Tokens are strictly additive: they let a contrast finding name the
 *   color it already measured, and never create a finding or move a severity or
 *   confidence. Omitted, findings read exactly as they did before.
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
    findings.push(...detectDesignPlacementIssues(context, nodes));
    findings.push(...detectAlignmentIssues(context, nodes));
    findings.push(...detectCognitiveLoadIssues(context, nodes));
    findings.push(...detectHigPatternIssues(context, nodes));
    findings.push(...detectSpacingIssues(context, nodes));
    findings.push(...detectTruncationIssues(context, nodes));

    // Decode the screenshot once and share it: sips conversion is the slow
    // part, and both pixel detectors would otherwise pay for it separately.
    // On fake fixtures or sips-less machines this stays null and both skip.
    const image = context.artifacts.screenshot?.exists
      ? loadScreenshotPixels(context.artifacts.screenshot.absolutePath)
      : null;
    const loadPixels = () => image;
    findings.push(...detectContrastIssues(context, nodes, {
      loadPixels,
      colorTokens: Array.isArray(options.colorTokens) ? options.colorTokens : []
    }));
    findings.push(...detectColorBalanceIssues(context, nodes, { loadPixels }));
  }

  findings.push(...await detectLogIssues(context));

  const sortedFindings = sortFindings(findings);
  const summary = summarizeFindings(sortedFindings);
  const written = writeCritiqueArtifacts(context, sortedFindings, summary);

  // Cross-run trend: compare against the newest sibling bundle so repeat
  // critiques show movement instead of an amnesiac snapshot.
  const trend = computeCritiqueTrend({ bundleDir: context.dir, findings: sortedFindings, summary });
  writeTrendArtifact(context.dir, trend);

  return {
    ok: true,
    command: 'critique',
    bundle: context.bundle,
    evidence: context.manifestPathDisplay,
    artifacts: written,
    summary,
    trend,
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
