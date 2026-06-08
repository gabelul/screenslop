import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectCritique } from '../../src/critique/collect-critique.mjs';
import { collectFix } from '../../src/fix/collect-fix.mjs';
import { collectVerify } from '../../src/verify/collect-verify.mjs';

const defaultFindingId = 'ax-missing-name-a21707c7';
const fixtureProblemBundle = 'tests/fixtures/evidence/problem';
const fixtureCleanBundle = 'tests/fixtures/evidence/clean';
const fixtureSourceRoot = 'tests/fixtures/source/simple-swiftui';

/**
 * Runs the fixture-backed Screenslop MVP loop end-to-end.
 * @param {object} [options] Flow options.
 * @param {'fixed'|'still-present'|'changed'} [options.freshMode] Fresh evidence scenario.
 * @param {boolean} [options.applyFix] Whether to apply the selected safe fix.
 * @param {string} [options.label] Accessibility label to apply in the fixture source.
 * @param {string} [options.findingId] Baseline finding to fix and verify.
 * @returns {Promise<object>} Machine-readable flow result.
 */
export async function runFixtureE2EFlow(options = {}) {
  const repoRoot = options.repoRoot || path.resolve(import.meta.dirname, '../..');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-e2e-'));
  const findingId = options.findingId || defaultFindingId;
  const freshMode = options.freshMode || 'fixed';
  const applyFix = options.applyFix !== false;
  const sourceRoot = path.join(workspace, 'source');
  fs.cpSync(path.join(repoRoot, fixtureSourceRoot), sourceRoot, { recursive: true });

  const baselineBundle = prepareProblemBundle({ repoRoot, workspace, name: 'baseline', identifier: 'settings.saveButton' });
  const baselineCritique = await collectCritique({ root: repoRoot, bundlePath: baselineBundle });
  const selectedFinding = baselineCritique.findings.find((finding) => finding.id === findingId);
  if (!selectedFinding) throw new Error(`Fixture baseline did not emit expected finding: ${findingId}`);

  const fix = await collectFix({
    root: repoRoot,
    bundlePath: baselineBundle,
    sourceRoot,
    findingIds: [findingId],
    apply: applyFix,
    dryRun: !applyFix,
    yes: true,
    label: options.label || 'Save settings'
  });

  const freshBundle = prepareFreshBundle({ repoRoot, workspace, freshMode });
  const freshCritique = await collectCritique({ root: repoRoot, bundlePath: freshBundle });
  const verify = await collectVerify({
    root: repoRoot,
    baselineBundle,
    freshBundle,
    findingIds: [findingId],
    fixSessionPath: fix.artifacts.sessionPath
  });

  return {
    ok: true,
    command: 'e2e-flow',
    freshMode,
    workspace,
    sourceRoot,
    findingId,
    baselineBundle,
    freshBundle,
    artifacts: {
      baselineFindingsPath: baselineCritique.artifacts.findingsPath,
      freshFindingsPath: freshCritique.artifacts.findingsPath,
      fixPlanPath: fix.artifacts.fixPlanPath,
      fixReportPath: fix.artifacts.reportPath,
      fixSessionPath: fix.artifacts.sessionPath,
      verificationPath: verify.artifacts.verificationPath,
      verificationReportPath: verify.artifacts.reportPath
    },
    stages: [
      stage('baseline-fixture', true, { bundle: baselineBundle }),
      stage('baseline-critique', baselineCritique.ok, { findings: baselineCritique.summary.total }),
      stage('fix', true, { status: fix.items[0]?.status || null }),
      stage('fresh-fixture', true, { bundle: freshBundle, mode: freshMode }),
      stage('fresh-critique', freshCritique.ok, { findings: freshCritique.summary.total }),
      stage('verify', verify.ok, { summary: verify.summary })
    ],
    fix: {
      summary: fix.summary,
      items: fix.items,
      session: fix.session
    },
    verification: {
      summary: verify.summary,
      items: verify.items
    }
  };
}

/**
 * Creates one compact stage record for flow output.
 * @param {string} name Stage name.
 * @param {boolean} ok Whether the stage passed.
 * @param {object} details Stage-specific details.
 * @returns {object} Stage record.
 */
function stage(name, ok, details = {}) {
  return { name, ok, ...details };
}

/**
 * Copies the problem evidence fixture and injects a runtime identifier.
 * @param {object} options Fixture options.
 * @returns {string} Absolute bundle path.
 */
function prepareProblemBundle({ repoRoot, workspace, name, identifier }) {
  const bundle = copyFixtureBundle({ repoRoot, workspace, source: fixtureProblemBundle, name });
  const axPath = path.join(bundle, 'accessibility.json');
  const axTree = JSON.parse(fs.readFileSync(axPath, 'utf8'));
  axTree.children[0].identifier = identifier;
  fs.writeFileSync(axPath, `${JSON.stringify(axTree, null, 2)}\n`);
  normalizeManifest({ bundle, runId: name, surface: `${name} fixture` });
  return bundle;
}

/**
 * Creates the fresh evidence bundle for the selected verification scenario.
 * @param {object} options Fixture options.
 * @returns {string} Absolute bundle path.
 */
function prepareFreshBundle({ repoRoot, workspace, freshMode }) {
  if (freshMode === 'fixed') {
    const bundle = copyFixtureBundle({ repoRoot, workspace, source: fixtureCleanBundle, name: 'fresh-fixed' });
    normalizeManifest({ bundle, runId: 'fresh-fixed', surface: 'fresh fixed fixture' });
    return bundle;
  }

  if (freshMode === 'still-present') {
    return prepareProblemBundle({ repoRoot, workspace, name: 'fresh-still-present', identifier: 'settings.saveButton' });
  }

  if (freshMode === 'changed') {
    return prepareProblemBundle({ repoRoot, workspace, name: 'fresh-changed', identifier: 'settings.otherButton' });
  }

  throw new Error(`Unsupported e2e fresh mode: ${freshMode}`);
}

/**
 * Copies an evidence fixture into the temporary workspace.
 * @param {object} options Copy options.
 * @returns {string} Absolute copied bundle path.
 */
function copyFixtureBundle({ repoRoot, workspace, source, name }) {
  const bundle = path.join(workspace, name);
  fs.cpSync(path.join(repoRoot, source), bundle, { recursive: true });
  purgeGeneratedArtifacts(bundle);
  return bundle;
}

/**
 * Rewrites copied manifests to point at bundle-local files.
 * @param {object} options Manifest options.
 * @returns {void}
 */
function normalizeManifest({ bundle, runId, surface }) {
  const manifestPath = path.join(bundle, 'evidence.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.runId = runId;
  manifest.surface = surface;
  manifest.artifacts = {
    screenshot: 'screenshot.jpg',
    accessibilityTree: 'accessibility.json',
    logs: fs.existsSync(path.join(bundle, 'logs.ndjson')) ? 'logs.ndjson' : null,
    summary: 'summary.md'
  };
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

/**
 * Removes derived reports so each e2e stage regenerates proof from evidence.
 * @param {string} bundle Copied evidence bundle path.
 * @returns {void}
 */
function purgeGeneratedArtifacts(bundle) {
  for (const file of [
    'findings.json',
    'critique.md',
    'fix-plan.json',
    'fix.md',
    'fix-session.json',
    'verification.json',
    'verification.md'
  ]) {
    const artifact = path.join(bundle, file);
    if (fs.existsSync(artifact)) fs.rmSync(artifact);
  }
}
