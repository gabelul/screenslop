import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readProjectConfig, resolveTargetConfig } from '../config/project-config.mjs';
import { collectSee } from '../evidence/collect-see.mjs';
import { createEvidenceBundle, writeEvidenceBundle } from '../evidence/bundle.mjs';
import { createRunId } from '../evidence/run-id.mjs';
import { collectCritique } from '../critique/collect-critique.mjs';
import { collectDesignReview } from '../design/review.mjs';
import { resolveProjectContainedPath } from '../design/profile.mjs';

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
 * @param {boolean} [options.includeDesign] Run design review after successful captures.
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
    summary: { total: profile.cells.length, captured: 0, dryRun: 0, unavailable: 0, failed: 0, designFindings: 0, designCells: 0 },
    cells: [],
    artifacts: {
      reportPath: path.relative(root, reportPath),
      reportMarkdownPath: path.relative(root, reportMarkdownPath)
    },
    configFeedback: {
      schemaChangeNeeded: false,
      note: 'The six-cell MVP uses a profile JSON file; no new target config fields are required yet.'
    },
    designSummary: {
      enabled: Boolean(options.includeDesign),
      cellsReviewed: 0,
      findings: 0,
      profileStatuses: {},
      consistency: { status: options.includeDesign ? 'pending' : 'not-run', messages: [] }
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
      includeCritique: Boolean(options.includeCritique),
      includeDesign: Boolean(options.includeDesign),
      designProfilePath: options.designProfilePath || null,
      agentPacket: Boolean(options.agentPacket)
    });
    report.cells.push(result);
    report.summary[result.status] = (report.summary[result.status] || 0) + 1;
    applyDesignCellSummary(report, result);
  }

  finalizeDesignSummary(report);
  // A run that failed cells, or captured evidence it cannot tie to the device it
  // built, is not a successful matrix. `ok` was fixed from config state alone,
  // so a run with zero proven captures still exited zero — which contradicted
  // the rule that an unproven target must not reach the successful exit path.
  // Any cell that is not a proven capture makes the run unproven. Counting only
  // failures and all-empty runs let five verified cells plus one unverified
  // cell exit zero, which is exactly the mixed matrix nobody would notice.
  const unproven = report.summary.failed + report.summary.unavailable;
  if (!dryRun && (unproven > 0 || report.summary.captured === 0)) report.ok = false;
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
  const absolute = resolveProjectContainedPath(root, profilePath, 'Matrix profile');
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
    return writeUnavailableCell({ root, cell, reason: configState.reason || 'no-config', message: configState.message || 'Matrix capture needs project config.', artifactsDir, includeDesign: options.includeDesign });
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
      artifactsDir,
      includeDesign: options.includeDesign
    });
  }
  if (dryRun) return writeUnavailableCell({ root, cell, reason: 'dry-run', message: 'Dry run only. No simulator capture attempted.', status: 'dryRun', artifactsDir, includeDesign: options.includeDesign });

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
        extra: { build },
        includeDesign: options.includeDesign
      });
    }

    // Prefer the UDID the build resolved: a name asks each tool to guess, and
    // duplicate simulator names across runtimes make those guesses differ.
    const see = await options.collectSeeFn({
      root,
      surface: cell.surface || configState.config.defaultSurface,
      udid: build.resolvedUdid || null,
      device: build.resolvedUdid ? null : (cell.device || configState.target.device),
      bundleId: configState.target.bundleId,
      includeLogs: true
    });

    // Even with a UDID, prove the evidence came from the simulator that was
    // built. A cell claiming "build then capture" must not be able to describe
    // two different devices.
    const targetMismatch = build.resolvedUdid && see.device?.udid
      && String(see.device.udid).toUpperCase() !== build.resolvedUdid;
    if (targetMismatch) {
      return writeUnavailableCell({
        root,
        cell,
        reason: 'target-mismatch',
        message: 'The build and the capture landed on different simulators, so this cell cannot claim build-then-capture evidence.',
        status: 'failed',
        artifactsDir,
        extra: { build, targetIdentity: 'mismatch' },
        includeDesign: options.includeDesign
      });
    }

    // A cell claims "built this, then captured it". Without both identities it
    // cannot claim that, so it does not count as captured. The bundle and its
    // critique are still written and still inspectable — the gap is a status,
    // not an omission — but an unproven target must not land in the captured
    // tally or the successful exit path.
    const targetIdentity = build.resolvedUdid && see.device?.udid ? 'verified' : 'unverified';
    // Two different questions, and conflating them loses information. `see.ok`
    // now means "this bundle is usable as proof", which is right for exit
    // codes — but gating critique on it meant a cell with a spinner produced no
    // findings at all, when critique is exactly what would have reported the
    // unstable capture. A cell fails only when there are no artifacts to read;
    // artifacts that exist but cannot be trusted are `unavailable` and still
    // get critiqued.
    const hasArtifacts = Boolean(see.artifacts?.screenshot || see.artifacts?.accessibilityTree);
    const status = !hasArtifacts
      ? 'failed'
      : (see.ok && targetIdentity === 'verified' ? 'captured' : 'unavailable');
    const shouldCritique = options.includeCritique || options.includeDesign;
    let critique = hasArtifacts && shouldCritique
      ? await options.collectCritiqueFn({ root, bundlePath: see.dir })
      : null;
    if (critique && options.includeDesign) {
      critique = collectDesignReview({
        root,
        bundlePath: see.dir,
        critiqueResult: critique,
        profilePath: options.designProfilePath,
        agentPacket: options.agentPacket
      });
    }
    return {
      id: cell.id,
      label: cell.label,
      status,
      requested: requestedEnvironment(cell),
      settingStatus: matrixSettingStatus(cell, { runtimeAttempted: true }),
      // Whether this cell can prove the build and the capture touched the same
      // simulator. `unverified` means the build tool did not report a device
      // identity, so the two resolved a name independently and may disagree —
      // a real gap in the cell's proof, recorded rather than assumed away. A
      // disagreement between two known identities fails the cell outright.
      targetIdentity,
      build,
      evidenceBundle: see.dir,
      evidence: see.evidence,
      artifacts: see.artifacts,
      critique: critique ? { ok: critique.ok, findings: critique.summary?.total || 0, artifacts: critique.artifacts } : null,
      design: critique?.design ? {
        enabled: true,
        status: 'reviewed',
        profileStatus: critique.design.profileStatus,
        findings: (critique.findings || []).filter((finding) => finding.kind && finding.kind !== 'measured').length,
        artifacts: {
          designPacketPath: critique.artifacts?.designPacketPath || null,
          designPromptPath: critique.artifacts?.designPromptPath || null
        }
      } : null,
      error: hasArtifacts ? null : 'capture-failed'
    };
  } catch (error) {
    return writeUnavailableCell({ root, cell, reason: 'capture-error', message: error.message, status: 'failed', artifactsDir, includeDesign: options.includeDesign });
  }
}

/**
 * Writes a cell evidence bundle for unavailable or dry-run cells.
 * @param {object} options Cell options.
 * @returns {object} Cell result.
 */
function writeUnavailableCell({ root, cell, reason, message, status = 'unavailable', artifactsDir = null, includeDesign = false, extra = {} }) {
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
    settingStatus: matrixSettingStatus(cell, { runtimeAttempted: false }),
    evidenceBundle: path.relative(root, bundle.dir),
    evidence: path.relative(root, bundle.manifestPath),
    artifacts: bundle.manifest.artifacts,
    design: includeDesign ? {
      enabled: true,
      status: status === 'dryRun' ? 'dry-run' : 'unavailable',
      profileStatus: null,
      findings: 0,
      artifacts: { designPacketPath: null, designPromptPath: null }
    } : null,
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
    simulator: cell.device || target.device || null,
    // Which simulator the build actually landed on, when the tool says so.
    // Without it, capture resolves the same name a second time and independently
    // — two tools, two answers, and a cell that can build one simulator while
    // critiquing another.
    resolvedUdid: extractUdid(result.stdout)
  };
}

/**
 * Reads the simulator identity XcodeBuildMCP reports for a build-and-run.
 *
 * The tool declares this in its structured output as
 * `data.artifacts.simulatorId` (schema `xcodebuildmcp.output.build-run-result`,
 * shipped in its own installation). An earlier version scraped the first
 * UUID-shaped substring out of stdout instead, which happily picked up an
 * unrelated identifier from diagnostics and then handed it to capture as the
 * device to photograph. A wrong identity is worse than none, so this reads the
 * declared field and returns null for anything it cannot parse.
 *
 * @param {string} output Build stdout.
 * @returns {string|null} Reported simulator UDID, or null.
 */
function extractUdid(output) {
  try {
    const payload = JSON.parse(String(output || ''));
    // Fail closed on every field. An earlier version rejected a *wrong* schema
    // name but accepted a missing one, and rejected `didError: true` but
    // accepted the field being absent — so an arbitrary object carrying a
    // simulatorId authorized a capture target. The envelope must be present and
    // say the build succeeded before its identity means anything.
    if (payload?.schema !== 'xcodebuildmcp.output.build-run-result') return null;
    // Exact, not coerced: String() happily turned 1, [1] and ["1"] into "1".
    if (payload?.schemaVersion !== '1') return null;
    if (payload?.didError !== false) return null;
    const simulatorId = payload?.data?.artifacts?.simulatorId;
    return typeof simulatorId === 'string' && simulatorId.trim() ? simulatorId.trim().toUpperCase() : null;
  } catch {
    return null;
  }
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
 * Reports whether requested appearance and Dynamic Type settings were applied.
 *
 * Screenslop records profile intent today, but it does not force these settings
 * at runtime yet. The matrix report says that plainly instead of implying a
 * captured cell actually changed simulator settings.
 *
 * @param {object} cell Matrix cell.
 * @param {object} options Status options.
 * @param {boolean} options.runtimeAttempted Whether capture was attempted.
 * @returns {object} Setting status block.
 */
function matrixSettingStatus(cell, { runtimeAttempted }) {
  return {
    appearance: settingEntry({
      kind: 'appearance',
      requested: cell.appearance || 'unspecified',
      runtimeAttempted
    }),
    dynamicType: settingEntry({
      kind: 'dynamicType',
      requested: cell.dynamicType || 'unspecified',
      runtimeAttempted
    })
  };
}

/**
 * Creates one setting status record.
 * @param {object} options Setting options.
 * @returns {object} Setting status record.
 */
function settingEntry({ kind, requested, runtimeAttempted }) {
  if (!requested || requested === 'unspecified') {
    return {
      requested: requested || 'unspecified',
      applied: null,
      status: 'not-requested',
      message: `${kind} was not requested for this cell.`
    };
  }

  if (!runtimeAttempted) {
    return {
      requested,
      applied: null,
      status: 'unavailable',
      message: `${kind} was requested, but no runtime capture was attempted for this cell.`
    };
  }

  return {
    requested,
    applied: null,
    status: 'requested-only',
    message: `${kind} was recorded as requested. Runtime forcing is not shipped yet.`
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
 * Adds one cell's design result to the matrix summary.
 * @param {object} report Matrix report under construction.
 * @param {object} cell Cell result.
 * @returns {void}
 */
function applyDesignCellSummary(report, cell) {
  if (!report.designSummary.enabled || !cell.design?.enabled || cell.design.status !== 'reviewed') return;
  report.designSummary.cellsReviewed += 1;
  report.designSummary.findings += cell.design.findings || 0;
  report.summary.designCells += 1;
  report.summary.designFindings += cell.design.findings || 0;
  const status = cell.design.profileStatus || 'unknown';
  report.designSummary.profileStatuses[status] = (report.designSummary.profileStatuses[status] || 0) + 1;
}

/**
 * Finalizes matrix-level design consistency notes.
 * @param {object} report Matrix report.
 * @returns {void}
 */
function finalizeDesignSummary(report) {
  if (!report.designSummary.enabled) return;
  if (report.designSummary.cellsReviewed === 0) {
    report.designSummary.consistency = {
      status: 'not-run',
      messages: ['No matrix cells produced design review output.']
    };
    return;
  }

  const statuses = Object.keys(report.designSummary.profileStatuses);
  const messages = [];
  if (statuses.length > 1) messages.push(`Design profile status varied across cells: ${statuses.join(', ')}.`);
  if (report.designSummary.findings > 0) messages.push(`${report.designSummary.findings} design finding(s) appeared across matrix cells.`);
  report.designSummary.consistency = {
    status: messages.length ? 'review-needed' : 'consistent',
    messages
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
  const cells = report.cells.map((cell) => {
    const appearance = cell.settingStatus?.appearance?.status || 'unknown';
    const dynamicType = cell.settingStatus?.dynamicType?.status || 'unknown';
    const design = cell.design?.enabled ? `; design=${cell.design.profileStatus}/${cell.design.findings}` : '';
    return `- ${cell.id}: ${cell.status}${cell.reason ? ` (${cell.reason})` : ''}; settings appearance=${appearance}, dynamicType=${dynamicType}${design} — ${cell.evidenceBundle}`;
  }).join('\n');
  return `# Screenslop Matrix

Run: ${report.runId}

Profile: ${report.profile.name}

Cells: ${report.summary.total}

Captured: ${report.summary.captured}

Dry run: ${report.summary.dryRun}

Unavailable: ${report.summary.unavailable}

Failed: ${report.summary.failed}

Design reviewed cells: ${report.designSummary?.cellsReviewed || 0}

Design findings: ${report.designSummary?.findings || 0}

## Cells

${cells}
`;
}
