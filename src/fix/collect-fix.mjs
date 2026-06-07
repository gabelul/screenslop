import fs from 'node:fs';
import path from 'node:path';
import { displayPath } from '../critique/load-evidence.mjs';
import { loadFixInput } from './load-fix-input.mjs';
import { selectFindings } from './select-findings.mjs';
import { locateSource } from './source-locator.mjs';
import { applySwiftUIPatch, buildSwiftUIPatch } from './swiftui-patcher.mjs';
import { buildFixPlan, summarizeFixItems } from './fix-plan.mjs';
import { renderFixReport } from './fix-report.mjs';
import { verifyFix } from './verify-fix.mjs';

const autoFixableRules = new Set(['ax.missing-name', 'ax.generic-name', 'layout.touch-target']);

/**
 * Plans and optionally applies deterministic fixes for critique findings.
 * @param {object} options Fix options.
 * @param {string} options.root Screenslop project root.
 * @param {string} options.bundlePath Evidence bundle path.
 * @param {string} [options.sourceRoot] App source root.
 * @param {string[]} [options.findingIds] Finding IDs to target.
 * @param {boolean} [options.apply] Whether to apply patches.
 * @param {boolean} [options.yes] Whether apply confirmation was granted.
 * @param {boolean} [options.dryRun] Whether this is an explicit dry-run.
 * @param {string|null} [options.label] Accessibility label for label fixes.
 * @param {string|null} [options.verifyCommand] Verification command.
 * @returns {object} Fix result.
 */
export async function collectFix(options) {
  const root = path.resolve(options.root || process.cwd());
  const input = loadFixInput({ root, bundlePath: options.bundlePath });
  const sourceRoot = path.resolve(root, options.sourceRoot || process.cwd());
  const findingIds = options.findingIds || [];
  const shouldApply = Boolean(options.apply && !options.dryRun);
  if (shouldApply && findingIds.length === 0) {
    throw new Error('Refusing to apply without --finding. Dry-run can plan all findings, but apply must target selected findings.');
  }
  const { selected, missingIds } = selectFindings(input.findings, findingIds);
  if (missingIds.length > 0) {
    throw new Error(`Unknown finding ID(s): ${missingIds.join(', ')}`);
  }

  if (shouldApply && !options.yes && !options.confirmed) {
    throw new Error('Refusing to apply patches without --yes or interactive confirmation.');
  }

  const items = [];
  const appliedPatches = [];

  for (const finding of selected) {
    const location = locateSource({ root, sourceRoot, finding });
    const item = buildItem({ root, sourceRoot, finding, location, label: options.label || null });

    if (shouldApply && item.patch?.canApply) {
      const applied = applySwiftUIPatch(item.patch);
      if (applied.applied) {
        item.status = 'applied';
        item.note = applied.reason;
        appliedPatches.push({ findingId: finding.id, file: item.patch.file, line: item.patch.line });
      } else {
        item.status = 'skipped';
        item.note = applied.reason;
      }
    }

    delete item.patch;
    items.push(item);
  }

  const artifacts = {
    fixPlanPath: displayPath(root, path.join(input.dir, 'fix-plan.json')),
    reportPath: displayPath(root, path.join(input.dir, 'fix.md')),
    sessionPath: shouldApply || options.verifyCommand ? displayPath(root, path.join(input.dir, 'fix-session.json')) : null
  };

  let session = null;
  let verification = null;

  if (options.verifyCommand) verification = await verifyFix(options.verifyCommand, { timeoutMs: options.verifyTimeoutMs });
  if (verification) {
    for (const item of items) {
      if (item.status === 'applied') item.status = verification.status;
    }
  }

  const plan = buildFixPlan({
    bundle: input.bundle,
    sourceRoot: displayPath(root, sourceRoot),
    missingFindings: missingIds,
    items,
    artifacts
  });

  if (shouldApply || verification) {
    session = {
      bundle: input.bundle,
      createdAt: new Date().toISOString(),
      appliedPatches,
      verification
    };
  }

  writeJson(path.join(input.dir, 'fix-plan.json'), plan);
  fs.writeFileSync(path.join(input.dir, 'fix.md'), renderFixReport(plan, session));
  if (session) writeJson(path.join(input.dir, 'fix-session.json'), session);

  return {
    ...plan,
    summary: summarizeFixItems(items),
    session,
    artifacts: {
      ...artifacts,
      fixPlanPath: path.isAbsolute(input.bundle) ? path.join(input.dir, 'fix-plan.json') : artifacts.fixPlanPath,
      reportPath: path.isAbsolute(input.bundle) ? path.join(input.dir, 'fix.md') : artifacts.reportPath,
      sessionPath: session ? (path.isAbsolute(input.bundle) ? path.join(input.dir, 'fix-session.json') : artifacts.sessionPath) : null
    }
  };
}

/**
 * Builds one fix item from a finding and source mapping result.
 * @param {object} options Item options.
 * @returns {object} Fix item.
 */
function buildItem({ root, sourceRoot, finding, location, label }) {
  const sourceCandidates = location.candidates.map((candidate) => ({
    file: candidate.file,
    line: candidate.line,
    confidence: candidate.confidence,
    reason: candidate.reason,
    matchedBy: candidate.matchedBy
  }));

  const base = {
    findingId: finding.id,
    ruleId: finding.ruleId,
    severity: finding.severity,
    status: 'planned',
    fixability: 'manual',
    sourceCandidates,
    patchPreview: null,
    verification: finding.verification,
    note: 'Manual review required.',
    patch: null
  };

  if (!autoFixableRules.has(finding.ruleId)) {
    return {
      ...base,
      status: 'unsupported',
      fixability: 'unsupported',
      note: `${finding.ruleId} is not auto-fixable in the MVP.`
    };
  }

  if (!fs.existsSync(sourceRoot)) {
    return {
      ...base,
      status: 'unsupported',
      fixability: 'unsupported',
      note: `Source root not found: ${displayPath(root, sourceRoot)}`
    };
  }

  if (location.strongCandidates.length === 0) {
    return {
      ...base,
      status: 'unsupported',
      fixability: 'unsupported',
      note: 'No unique strong source match. Add an accessibilityIdentifier or source hint.'
    };
  }

  if (location.strongCandidates.length > 1) {
    return {
      ...base,
      status: 'ambiguous',
      fixability: 'ambiguous',
      note: 'Multiple strong source matches; refusing to patch automatically.'
    };
  }

  const patch = buildSwiftUIPatch({ finding, candidate: location.strongCandidates[0], label });
  const status = patch.alreadySatisfied ? 'skipped' : patch.canApply ? 'planned' : 'unsupported';

  return {
    ...base,
    status,
    fixability: patch.canApply || patch.alreadySatisfied ? 'auto-fixable' : 'unsupported',
    patchPreview: patch.preview,
    note: patch.reason,
    patch
  };
}

/**
 * Writes pretty JSON with a trailing newline.
 * @param {string} file Output path.
 * @param {object} payload JSON payload.
 * @returns {void}
 */
function writeJson(file, payload) {
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`);
}
