import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readProjectConfig, resolveTargetConfig } from '../config/project-config.mjs';
import { collectSee } from '../evidence/collect-see.mjs';
import { createEvidenceBundle, writeEvidenceBundle } from '../evidence/bundle.mjs';
import { createRunId } from '../evidence/run-id.mjs';
import { collectCritique } from '../critique/collect-critique.mjs';

export const DEFAULT_MATRIX_PROFILE = {
  schemaVersion: 1,
  name: 'default-six-cell',
  cells: [
    { id: 'default-configured-iphone', label: 'Default configured iPhone', device: null, appearance: 'unspecified', dynamicType: 'unspecified' },
    { id: 'large-iphone', label: 'Large iPhone', device: 'iPhone 17 Pro', appearance: 'unspecified', dynamicType: 'unspecified' },
    { id: 'light-appearance', label: 'Light appearance', device: null, appearance: 'light', dynamicType: 'unspecified' },
    { id: 'dark-appearance', label: 'Dark appearance', device: null, appearance: 'dark', dynamicType: 'unspecified' },
    { id: 'dynamic-type-normal', label: 'Normal Dynamic Type', device: null, appearance: 'unspecified', dynamicType: 'normal' },
    { id: 'dynamic-type-accessibility', label: 'Accessibility Dynamic Type', device: null, appearance: 'unspecified', dynamicType: 'accessibility3' }
  ]
};

/**
 * Captures or scaffolds a bounded Screenslop matrix report.
 * @param {object} [options] Matrix options.
 * @param {string} [options.root] Project root.
 * @param {string|null} [options.profilePath] Matrix profile JSON path.
 * @param {boolean} [options.dryRun] Scaffold bundles without runtime capture.
 * @param {boolean} [options.includeCritique] Run critique after successful captures.
 * @param {Function} [options.collectSeeFn] Capture function override for tests.
 * @param {Function} [options.collectCritiqueFn] Critique function override for tests.
 * @param {Function} [options.commandRunner] Build/run command override for tests.
 * @returns {Promise<object>} Matrix report.
 */
export async function collectMatrix(options = {}) {
  const root = fs.realpathSync.native(path.resolve(options.root || process.cwd()));
  const dryRun = Boolean(options.dryRun);
  const profile = loadMatrixProfile(root, options.profilePath || null);
  const runId = createRunId('matrix');
  const configState = readMatrixConfig(root);
  const artifactRoot = configState.target?.artifactsDir || path.join(root, 'artifacts');
  const reportDir = path.join(artifactRoot, runId);
  const reportPath = path.join(reportDir, 'matrix.json');
  const reportMarkdownPath = path.join(reportDir, 'matrix.md');
  fs.mkdirSync(reportDir, { recursive: true });

  const report = {
    ok: configState.ok,
    command: 'matrix',
    runId,
    createdAt: new Date().toISOString(),
    dryRun,
    profile: {
      schemaVersion: profile.schemaVersion,
      name: profile.name,
      cells: profile.cells.length
    },
    target: publicTarget(configState.target),
    summary: { total: profile.cells.length, captured: 0, dryRun: 0, unavailable: 0, failed: 0 },
    cells: [],
    artifacts: {
      reportPath: path.relative(root, reportPath),
      reportMarkdownPath: path.relative(root, reportMarkdownPath)
    },
    configFeedback: {
      schemaChangeNeeded: false,
      note: 'The six-cell MVP uses a profile JSON file; no new target config fields are required yet.'
    }
  };

  for (const cell of profile.cells) {
    const result = await runMatrixCell({
      root,
      cell,
      dryRun,
      configState,
      artifactsDir: configState.target?.artifactsDir ? path.relative(root, configState.target.artifactsDir) : null,
      collectSeeFn: options.collectSeeFn || collectSee,
      collectCritiqueFn: options.collectCritiqueFn || collectCritique,
      commandRunner: options.commandRunner || defaultCommandRunner,
      includeCritique: Boolean(options.includeCritique)
    });
    report.cells.push(result);
    report.summary[result.status] = (report.summary[result.status] || 0) + 1;
  }

  writeMatrixReport({ report, reportPath, reportMarkdownPath });
  return report;
}

/**
 * Loads a matrix profile or returns the built-in six-cell profile.
 * @param {string} root Project root.
 * @param {string|null} profilePath Optional profile path.
 * @returns {object} Matrix profile.
 */
function loadMatrixProfile(root, profilePath) {
  if (!profilePath) return normalizeProfile(DEFAULT_MATRIX_PROFILE);
  const absolute = path.resolve(root, profilePath);
  const payload = JSON.parse(fs.readFileSync(absolute, 'utf8'));
  return normalizeProfile(payload);
}

/**
 * Normalizes a matrix profile payload.
 * @param {object} profile Raw profile.
 * @returns {object} Normalized profile.
 */
function normalizeProfile(profile) {
  const cells = Array.isArray(profile?.cells) ? profile.cells : [];
  if (profile?.schemaVersion !== 1) throw new Error('Matrix profile schemaVersion must be 1.');
  if (!cells.length) throw new Error('Matrix profile must include at least one cell.');

  return {
    schemaVersion: 1,
    name: profile.name || 'matrix',
    cells: cells.map((cell, index) => ({
      id: cell.id || `cell-${index + 1}`,
      label: cell.label || cell.id || `Cell ${index + 1}`,
      device: cell.device || null,
      appearance: cell.appearance || 'unspecified',
      dynamicType: cell.dynamicType || 'unspecified',
      surface: cell.surface || null
    }))
  };
}

/**
 * Reads and resolves project config for matrix captures.
 * @param {string} root Project root.
 * @returns {object} Config state.
 */
function readMatrixConfig(root) {
  const read = readProjectConfig(root);
  if (read.error) return { ok: false, exists: read.exists, reason: 'config-invalid', message: read.error, target: null };
  if (!read.exists) return { ok: true, exists: false, reason: 'no-config', message: 'No .screenslop/config.json found.', target: null };

  try {
    const target = resolveTargetConfig(read.config, { root });
    return { ok: true, exists: true, reason: null, message: null, target, config: read.config };
  } catch (error) {
    return { ok: false, exists: true, reason: 'config-invalid', message: error.message, target: null };
  }
}

/**
 * Runs one matrix cell and returns a report entry.
 * @param {object} options Cell options.
 * @returns {Promise<object>} Cell result.
 */
async function runMatrixCell(options) {
  const { root, cell, dryRun, configState, artifactsDir } = options;
  if (!configState.exists || !configState.target) {
    return writeUnavailableCell({ root, cell, reason: configState.reason || 'no-config', message: configState.message || 'Matrix capture needs project config.', artifactsDir });
  }
  if (
    (!configState.target.workspacePath && !configState.target.projectPath)
    || !configState.target.scheme
    || !configState.target.bundleId
    || !configState.config?.defaultSurface
  ) {
    return writeUnavailableCell({
      root,
      cell,
      reason: 'target-incomplete',
      message: 'Matrix capture needs workspacePath/projectPath, defaultScheme, defaultBundleId, and defaultSurface in .screenslop/config.json.',
      artifactsDir
    });
  }
  if (dryRun) return writeUnavailableCell({ root, cell, reason: 'dry-run', message: 'Dry run only. No simulator capture attempted.', status: 'dryRun', artifactsDir });

  try {
    const build = runBuildTarget({ target: configState.target, cell, commandRunner: options.commandRunner });
    if (!build.ok) {
      return writeUnavailableCell({
        root,
        cell,
        reason: 'build-run-failed',
        message: 'xcodebuildmcp could not build and launch this matrix cell.',
        status: 'failed',
        artifactsDir,
        extra: { build }
      });
    }

    const see = await options.collectSeeFn({
      root,
      surface: cell.surface || configState.config.defaultSurface,
      device: cell.device || configState.target.device,
      bundleId: configState.target.bundleId,
      includeLogs: true
    });
    const status = see.ok ? 'captured' : 'failed';
    const critique = see.ok && options.includeCritique
      ? await options.collectCritiqueFn({ root, bundlePath: see.dir })
      : null;
    return {
      id: cell.id,
      label: cell.label,
      status,
      requested: requestedEnvironment(cell),
      build,
      evidenceBundle: see.dir,
      evidence: see.evidence,
      artifacts: see.artifacts,
      critique: critique ? { ok: critique.ok, findings: critique.summary?.total || 0, artifacts: critique.artifacts } : null,
      error: see.ok ? null : 'capture-failed'
    };
  } catch (error) {
    return writeUnavailableCell({ root, cell, reason: 'capture-error', message: error.message, status: 'failed', artifactsDir });
  }
}

/**
 * Writes a cell evidence bundle for unavailable or dry-run cells.
 * @param {object} options Cell options.
 * @returns {object} Cell result.
 */
function writeUnavailableCell({ root, cell, reason, message, status = 'unavailable', artifactsDir = null, extra = {} }) {
  const bundle = createEvidenceBundle({ root, surface: cell.surface || cell.id, driver: 'matrix', artifactsDir });
  bundle.manifest.matrixCell = { id: cell.id, label: cell.label };
  bundle.manifest.environment = requestedEnvironment(cell);
  bundle.manifest.capture = {
    status: status === 'dryRun' ? 'dry-run' : status,
    steps: [{ name: reason, ok: status === 'dryRun', message }]
  };
  writeEvidenceBundle({ root, dir: bundle.dir, manifestPath: bundle.manifestPath, manifest: bundle.manifest });

  return {
    id: cell.id,
    label: cell.label,
    status,
    reason,
    message,
    requested: requestedEnvironment(cell),
    evidenceBundle: path.relative(root, bundle.dir),
    evidence: path.relative(root, bundle.manifestPath),
    artifacts: bundle.manifest.artifacts,
    ...extra
  };
}

/**
 * Builds and launches the configured target for one matrix cell.
 * @param {object} options Build options.
 * @returns {object} Build result.
 */
function runBuildTarget({ target, cell, commandRunner }) {
  const projectArgs = target.workspacePath
    ? ['--workspace-path', target.workspacePath]
    : ['--project-path', target.projectPath];
  const deviceArgs = cell.device || target.device
    ? ['--simulator-name', cell.device || target.device]
    : [];
  const args = [
    'simulator', 'build-and-run',
    ...projectArgs,
    '--scheme', target.scheme,
    ...deviceArgs,
    '--configuration', 'Debug',
    '--output', 'json'
  ];
  const started = Date.now();
  const result = commandRunner({ command: 'xcodebuildmcp', args });
  return {
    ok: result.status === 0,
    status: result.status,
    durationMs: Date.now() - started,
    command: ['xcodebuildmcp', 'simulator', 'build-and-run'],
    simulator: cell.device || target.device || null
  };
}

/**
 * Returns requested matrix environment metadata.
 * @param {object} cell Matrix cell.
 * @returns {object} Requested environment.
 */
function requestedEnvironment(cell) {
  return {
    device: cell.device || null,
    appearance: cell.appearance || 'unspecified',
    dynamicType: cell.dynamicType || 'unspecified'
  };
}

/**
 * Removes private path fields from target output.
 * @param {object|null} target Resolved target.
 * @returns {object|null} Public target summary.
 */
function publicTarget(target) {
  if (!target) return null;
  return {
    hasWorkspace: Boolean(target.workspacePath),
    hasProject: Boolean(target.projectPath),
    scheme: target.scheme,
    bundleId: target.bundleId ? '<bundle-id>' : null,
    hasSourceRoot: Boolean(target.sourceRoot),
    defaultDevice: target.device
  };
}

/**
 * Runs one local command.
 * @param {object} options Command options.
 * @returns {{status:number,stdout:string,stderr:string}} Command result.
 */
function defaultCommandRunner({ command, args }) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 1024 * 1024 * 20 });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || ''
  };
}

/**
 * Writes matrix JSON and markdown reports.
 * @param {object} options Report options.
 * @returns {void}
 */
function writeMatrixReport({ report, reportPath, reportMarkdownPath }) {
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(reportMarkdownPath, renderMatrixMarkdown(report));
}

/**
 * Renders a short matrix report.
 * @param {object} report Matrix report.
 * @returns {string} Markdown report.
 */
function renderMatrixMarkdown(report) {
  const cells = report.cells.map((cell) => `- ${cell.id}: ${cell.status}${cell.reason ? ` (${cell.reason})` : ''} — ${cell.evidenceBundle}`).join('\n');
  return `# Screenslop Matrix

Run: ${report.runId}

Profile: ${report.profile.name}

Cells: ${report.summary.total}

Captured: ${report.summary.captured}

Dry run: ${report.summary.dryRun}

Unavailable: ${report.summary.unavailable}

Failed: ${report.summary.failed}

## Cells

${cells}
`;
}
