import { displayPath } from '../critique/load-evidence.mjs';
import { loadVerifyInput } from './load-verify-input.mjs';
import { matchFindings, summarizeVerification } from './match-findings.mjs';
import { applyStabilityGate, readStability } from './stability-gate.mjs';
import { writeVerificationArtifacts } from './verification-report.mjs';

/**
 * Verifies baseline findings against a fresh evidence/critique bundle.
 * @param {object} options Verify options.
 * @param {string} options.root Screenslop project root.
 * @param {string} options.baselineBundle Baseline evidence bundle.
 * @param {string} options.freshBundle Fresh evidence bundle.
 * @param {string[]} [options.findingIds] Selected baseline finding IDs.
 * @param {boolean} [options.refreshCritique] Whether to rerun fresh critique.
 * @param {string|null} [options.fixSessionPath] Optional fix-session path.
 * @returns {Promise<object>} Verification result.
 */
export async function collectVerify(options) {
  const input = await loadVerifyInput(options);
  const matched = matchFindings({
    baselineFindings: input.baselineFindings,
    freshFindings: input.freshFindings,
    freshHasDesignReview: input.freshHasDesignReview,
    selectedIds: options.findingIds || [],
    fixSession: input.fixSession
  });
  // A finding can vanish because the fresh capture caught an animation. Gate the
  // verified-fixed track on whether that capture was proven still.
  const freshStability = readStability(input.fresh.manifest);
  const items = applyStabilityGate(matched, freshStability);
  const summary = summarizeVerification(items);
  const result = {
    ok: true,
    command: 'verify',
    createdAt: new Date().toISOString(),
    baselineBundle: input.baseline.bundle,
    freshBundle: input.fresh.bundle,
    baselineFindingsPath: displayPath(input.root, input.baselineFindingsPath),
    freshFindingsPath: displayPath(input.root, input.freshFindingsPath),
    freshCritiqueRefreshed: input.freshCritiqueRefreshed,
    freshHasDesignReview: input.freshHasDesignReview,
    fixSessionPath: input.fixSessionPath,
    freshStability,
    summary,
    items,
    artifacts: null
  };

  const artifacts = writeVerificationArtifacts(input, result);
  return { ...result, artifacts };
}
