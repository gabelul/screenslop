#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createDefaultConfig, resolveTargetConfig } from '../src/config/project-config.mjs';

const thisFile = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(thisFile), '..');
const autoFixableRules = new Set(['ax.missing-name', 'ax.generic-name', 'layout.touch-target']);

/**
 * Runs the real-runtime MVP smoke flow.
 * @param {object} [options] Runner options.
 * @param {string} [options.repoRoot] Screenslop repo root.
 * @param {string[]} [options.argv] CLI-style flags.
 * @param {Function} [options.commandRunner] Command runner override for tests.
 * @param {Function} [options.sleep] Sleep function override for tests.
 * @param {object} [options.paths] Path overrides for tests.
 * @param {boolean} [options.writeReport] Whether to write a report file.
 * @returns {Promise<object>} Machine-readable smoke report.
 */
export async function runRealRuntimeSmoke(options = {}) {
  const startedAt = new Date().toISOString();
  const repoRoot = path.resolve(options.repoRoot || defaultRepoRoot);
  const args = parseArgs(options.argv || process.argv.slice(2));
  const paths = options.paths || runtimeSmokePaths(repoRoot);
  const commandRunner = options.commandRunner || defaultCommandRunner;
  const sleep = options.sleep || sleepMs;
  const stages = [];
  const targetResult = resolveSmokeTargetSafely({ repoRoot, args, paths, target: options.target });
  const target = targetResult.target;
  const report = {
    ok: false,
    command: 'smoke:runtime',
    startedAt,
    finishedAt: null,
    target: target ? publicTarget(target, repoRoot) : null,
    bundleId: target?.bundleId || null,
    surface: target?.surface || null,
    selectedDevice: null,
    findingId: null,
    verificationStatus: null,
    artifacts: {},
    stages
  };

  if (!targetResult.ok) {
    addSyntheticStage(stages, 'target-config', false, targetResult.error, {});
    return finishReport(report, { reason: 'target-config-invalid', paths, writeReport: options.writeReport !== false, repoRoot });
  }

  const derivedDataIsTemporary = !args.keepDerivedData;
  const derivedDataPath = derivedDataIsTemporary
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-runtime-smoke-derived-'))
    : path.join(target.appRoot, 'DerivedData', target.scheme || 'RuntimeSmoke');

  try {
    if (target.resetsSource) restoreBaselineSource(target.contentView);

    const targetReady = validateBuildTarget(target);
    addSyntheticStage(stages, 'target-config', targetReady.ok, targetReady.message, targetReady.details);
    if (!targetReady.ok) return finishReport(report, { reason: 'target-config-invalid', paths, writeReport: options.writeReport !== false, repoRoot });

    if (args.preflightOnly) {
      addSyntheticStage(stages, 'preflight-only', true, 'Configured target preflight passed without runtime capture.', {
        kind: target.kind,
        runtimeToolsChecked: false
      });
      report.ok = true;
      return finishReport(report, { paths, writeReport: options.writeReport !== false, repoRoot });
    }

    const preflight = runPreflight({ repoRoot, commandRunner, stages });
    if (!preflight.ok) return finishReport(report, { reason: preflight.reason, paths, writeReport: options.writeReport !== false, repoRoot });

    const device = selectRuntimeDevice(preflight.baguetteList, {
      udid: args.udid,
      deviceName: args.device || target.device
    });
    if (!device) {
      addSyntheticStage(stages, 'select-device', false, 'No matching simulator device was reported by Baguette.', { udid: args.udid, device: args.device });
      return finishReport(report, { reason: 'device-unavailable', paths, writeReport: options.writeReport !== false, repoRoot });
    }
    report.selectedDevice = publicDevice(device);
    addSyntheticStage(stages, 'select-device', true, `Selected ${device.name} (${device.udid}).`, publicDevice(device));

    const baselineBuild = runStage({
      stages,
      name: 'build-run-baseline',
      command: 'xcodebuildmcp',
      args: buildRunArgs({ target, device, derivedDataPath }),
      cwd: repoRoot,
      commandRunner,
      parseJson: true
    });
    if (!baselineBuild.ok) return finishReport(report, { reason: 'baseline-build-run-failed', paths, writeReport: options.writeReport !== false, repoRoot });

    await sleep(Number(args.launchWaitMs || 2500));

    const baselineSee = runJsonCliStage({
      stages,
      name: 'baseline-see',
      repoRoot,
      commandRunner,
      args: ['see', '--surface', target.surface, '--json', '--logs', '--bundle-id', target.bundleId, '--udid', device.udid]
    });
    if (!baselineSee.ok || !baselineSee.json?.ok) return finishReport(report, { reason: 'baseline-see-failed', paths, writeReport: options.writeReport !== false, repoRoot });
    report.artifacts.baselineBundle = baselineSee.json.dir;
    report.artifacts.baselineEvidence = baselineSee.json.evidence;
    report.artifacts.baselineArtifacts = baselineSee.json.artifacts;

    const baselineArtifactsOk = assertEvidenceArtifacts({ repoRoot, bundle: baselineSee.json.dir });
    addSyntheticStage(stages, 'baseline-artifacts', baselineArtifactsOk.ok, baselineArtifactsOk.message, baselineArtifactsOk.details);
    if (!baselineArtifactsOk.ok) return finishReport(report, { reason: 'baseline-artifacts-missing', paths, writeReport: options.writeReport !== false, repoRoot });

    const baselineCritique = runJsonCliStage({
      stages,
      name: 'baseline-critique',
      repoRoot,
      commandRunner,
      args: ['critique', baselineSee.json.dir, '--json']
    });
    if (!baselineCritique.ok || !baselineCritique.json?.ok) return finishReport(report, { reason: 'baseline-critique-failed', paths, writeReport: options.writeReport !== false, repoRoot });
    report.artifacts.baselineFindings = baselineCritique.json.artifacts?.findingsPath || path.join(baselineSee.json.dir, 'findings.json');

    const finding = selectRuntimeFinding(baselineCritique.json.findings || [], {
      identifier: target.runtimeIdentifier,
      findingId: args.finding
    });
    if (!finding) {
      addSyntheticStage(stages, 'select-finding', false, 'No auto-fixable finding matched the requested runtime target.', {
        findings: baselineCritique.json.findings?.length || 0,
        identifier: target.runtimeIdentifier,
        findingId: args.finding
      });
      return finishReport(report, { reason: 'finding-unavailable', paths, writeReport: options.writeReport !== false, repoRoot });
    }
    report.findingId = finding.id;
    addSyntheticStage(stages, 'select-finding', true, `Selected ${finding.id}.`, { ruleId: finding.ruleId, identifier: finding.evidence?.node?.identifier || null });

    if (args.skipApply) {
      addSyntheticStage(stages, 'skip-apply', false, '--skip-apply stops before source patching and verification.', { findingId: finding.id });
      return finishReport(report, { reason: 'skip-apply-requested', paths, writeReport: options.writeReport !== false, repoRoot });
    }

    const fix = runJsonCliStage({
      stages,
      name: 'fix-apply',
      repoRoot,
      commandRunner,
      args: ['fix', baselineSee.json.dir, '--finding', finding.id, '--source-root', target.sourceRoot, '--apply', '--yes', '--label', args.label || 'Save changes', '--json']
    });
    if (!fix.ok || !fix.json?.ok) return finishReport(report, { reason: 'fix-apply-failed', paths, writeReport: options.writeReport !== false, repoRoot });
    report.artifacts.fixPlan = fix.json.artifacts?.fixPlanPath || path.join(baselineSee.json.dir, 'fix-plan.json');
    report.artifacts.fixReport = fix.json.artifacts?.reportPath || path.join(baselineSee.json.dir, 'fix.md');
    report.artifacts.fixSession = fix.json.artifacts?.sessionPath || path.join(baselineSee.json.dir, 'fix-session.json');

    const patchScope = assertFixScope({ repoRoot, sourceRoot: target.sourceRoot, fix: fix.json });
    addSyntheticStage(stages, 'fix-scope', patchScope.ok, patchScope.message, patchScope.details);
    if (!patchScope.ok) return finishReport(report, { reason: 'fix-scope-failed', paths, writeReport: options.writeReport !== false, repoRoot });

    const freshBuild = runStage({
      stages,
      name: 'build-run-fresh',
      command: 'xcodebuildmcp',
      args: buildRunArgs({ target, device, derivedDataPath }),
      cwd: repoRoot,
      commandRunner,
      parseJson: true
    });
    if (!freshBuild.ok) return finishReport(report, { reason: 'fresh-build-run-failed', paths, writeReport: options.writeReport !== false, repoRoot });

    await sleep(Number(args.launchWaitMs || 2500));

    const freshSee = runJsonCliStage({
      stages,
      name: 'fresh-see',
      repoRoot,
      commandRunner,
      args: ['see', '--surface', target.surface, '--json', '--logs', '--bundle-id', target.bundleId, '--udid', device.udid]
    });
    if (!freshSee.ok || !freshSee.json?.ok) return finishReport(report, { reason: 'fresh-see-failed', paths, writeReport: options.writeReport !== false, repoRoot });
    report.artifacts.freshBundle = freshSee.json.dir;
    report.artifacts.freshEvidence = freshSee.json.evidence;
    report.artifacts.freshArtifacts = freshSee.json.artifacts;

    const freshArtifactsOk = assertEvidenceArtifacts({ repoRoot, bundle: freshSee.json.dir });
    addSyntheticStage(stages, 'fresh-artifacts', freshArtifactsOk.ok, freshArtifactsOk.message, freshArtifactsOk.details);
    if (!freshArtifactsOk.ok) return finishReport(report, { reason: 'fresh-artifacts-missing', paths, writeReport: options.writeReport !== false, repoRoot });

    const freshCritique = runJsonCliStage({
      stages,
      name: 'fresh-critique',
      repoRoot,
      commandRunner,
      args: ['critique', freshSee.json.dir, '--json']
    });
    if (!freshCritique.ok || !freshCritique.json?.ok) return finishReport(report, { reason: 'fresh-critique-failed', paths, writeReport: options.writeReport !== false, repoRoot });
    report.artifacts.freshFindings = freshCritique.json.artifacts?.findingsPath || path.join(freshSee.json.dir, 'findings.json');

    const verify = runJsonCliStage({
      stages,
      name: 'verify',
      repoRoot,
      commandRunner,
      args: ['verify', baselineSee.json.dir, '--fresh-bundle', freshSee.json.dir, '--finding', finding.id, '--fix-session', report.artifacts.fixSession, '--json']
    });
    if (!verify.ok || !verify.json?.ok) return finishReport(report, { reason: 'verify-failed', paths, writeReport: options.writeReport !== false, repoRoot });

    const verifiedItem = verify.json.items?.find((item) => item.findingId === finding.id || item.baselineId === finding.id) || verify.json.items?.[0] || null;
    report.verificationStatus = verifiedItem?.status || null;
    report.artifacts.verification = verify.json.artifacts?.verificationPath || path.join(baselineSee.json.dir, 'verification.json');
    report.artifacts.verificationReport = verify.json.artifacts?.reportPath || path.join(baselineSee.json.dir, 'verification.md');

    if (report.verificationStatus !== 'verified-fixed') {
      addSyntheticStage(stages, 'verify-status', false, `Expected verified-fixed, got ${report.verificationStatus || 'none'}.`, { status: report.verificationStatus });
      return finishReport(report, { reason: 'verification-not-fixed', paths, writeReport: options.writeReport !== false, repoRoot });
    }

    addSyntheticStage(stages, 'verify-status', true, 'Selected finding is verified-fixed against fresh runtime evidence.', { status: report.verificationStatus });
    report.ok = true;
    return finishReport(report, { paths, writeReport: options.writeReport !== false, repoRoot });
  } catch (error) {
    addSyntheticStage(stages, 'unhandled-error', false, error.message, { stack: error.stack });
    return finishReport(report, { reason: 'unhandled-error', paths, writeReport: options.writeReport !== false, repoRoot });
  } finally {
    if (target?.resetsSource) restoreBaselineSource(target.contentView);
    if (derivedDataIsTemporary) fs.rmSync(derivedDataPath, { recursive: true, force: true });
  }
}

/**
 * Returns the standard RuntimeSmoke path set.
 * @param {string} repoRoot Screenslop repo root.
 * @returns {object} Runtime smoke paths.
 */
export function runtimeSmokePaths(repoRoot = defaultRepoRoot) {
  const appRoot = path.join(repoRoot, 'examples/runtime-smoke-app');
  return {
    appRoot,
    workspace: path.join(appRoot, 'RuntimeSmoke.xcworkspace'),
    contentView: path.join(appRoot, 'RuntimeSmokePackage/Sources/RuntimeSmokeFeature/ContentView.swift'),
    reportPath: path.join(repoRoot, 'artifacts', `runtime-smoke-${timestampForPath(new Date())}.json`)
  };
}

/**
 * Resolves either the sample target or a configured app target.
 * @param {object} options Target options.
 * @param {string} options.repoRoot Screenslop repo root.
 * @param {object} options.args Parsed CLI args.
 * @param {object} options.paths Sample path set.
 * @returns {object} Runtime smoke target.
 */
export function resolveSmokeTarget({ repoRoot, args, paths }) {
  if (!usesConfiguredTarget(args)) {
    return {
      kind: 'sample',
      appRoot: paths.appRoot,
      workspace: paths.workspace,
      project: null,
      scheme: 'RuntimeSmoke',
      bundleId: 'dev.screenslop.RuntimeSmoke',
      sourceRoot: paths.appRoot,
      surface: args.surface || 'RuntimeSmoke',
      runtimeIdentifier: args.identifier || 'runtimeSmoke.saveButton',
      device: args.device || null,
      contentView: paths.contentView,
      resetsSource: true
    };
  }

  const config = loadTargetConfig({ repoRoot, args });
  const target = resolveTargetConfig(config, { root: repoRoot });
  return {
    kind: 'configured',
    appRoot: target.sourceRoot || repoRoot,
    workspace: target.workspacePath,
    project: target.projectPath,
    scheme: args.scheme || target.scheme,
    bundleId: args.bundleId || target.bundleId,
    sourceRoot: target.sourceRoot,
    surface: args.surface || config.defaultSurface || null,
    runtimeIdentifier: args.identifier || null,
    findingId: args.finding || null,
    device: args.device || target.device,
    contentView: null,
    resetsSource: false
  };
}

/**
 * Resolves the target without throwing out of the JSON report path.
 * @param {object} options Target options.
 * @returns {{ok:boolean,target:object|null,error:string|null}}
 */
function resolveSmokeTargetSafely(options) {
  try {
    return { ok: true, target: options.target || resolveSmokeTarget(options), error: null };
  } catch (error) {
    return { ok: false, target: null, error: error.message };
  }
}

/**
 * Chooses the RuntimeSmoke finding that should be patched.
 * @param {object[]} findings Critique findings.
 * @param {object} [options] Selection options.
 * @param {string|null} [options.identifier] Preferred stable identifier.
 * @param {string|null} [options.findingId] Exact finding ID.
 * @returns {object|null} Selected finding.
 */
export function selectRuntimeFinding(findings, options = {}) {
  if (options.findingId) return findings.find((finding) => finding.id === options.findingId) || null;
  const runtimeIdentifier = options.identifier || 'runtimeSmoke.saveButton';
  const matches = findings.filter((finding) => {
    const identifier = finding.evidence?.node?.identifier || finding.evidence?.sourceHint || '';
    return (!runtimeIdentifier || identifier === runtimeIdentifier) && autoFixableRules.has(finding.ruleId);
  });

  const preferred = ['ax.missing-name', 'ax.generic-name', 'layout.touch-target'];
  for (const ruleId of preferred) {
    const match = matches.find((finding) => finding.ruleId === ruleId);
    if (match) return match;
  }
  return matches[0] || null;
}

/**
 * Parses runtime smoke CLI flags.
 * @param {string[]} argv Raw args.
 * @returns {object} Parsed flag values.
 */
export function parseArgs(argv) {
  const parsed = {
    config: null,
    device: null,
    bundleId: null,
    finding: null,
    identifier: null,
    udid: null,
    workspace: null,
    project: null,
    scheme: null,
    sourceRoot: null,
    surface: null,
    label: 'Save changes',
    keepDerivedData: false,
    skipApply: false,
    preflightOnly: false,
    launchWaitMs: 2500
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') parsed.config = argv[++index] || null;
    else if (arg === '--device') parsed.device = argv[++index] || null;
    else if (arg === '--bundle-id') parsed.bundleId = argv[++index] || null;
    else if (arg === '--finding') parsed.finding = argv[++index] || null;
    else if (arg === '--identifier') parsed.identifier = argv[++index] || null;
    else if (arg === '--udid') parsed.udid = argv[++index] || null;
    else if (arg === '--workspace') parsed.workspace = argv[++index] || null;
    else if (arg === '--project') parsed.project = argv[++index] || null;
    else if (arg === '--scheme') parsed.scheme = argv[++index] || null;
    else if (arg === '--source-root') parsed.sourceRoot = argv[++index] || null;
    else if (arg === '--surface') parsed.surface = argv[++index] || null;
    else if (arg === '--label') parsed.label = argv[++index] || 'Save changes';
    else if (arg === '--keep-derived-data') parsed.keepDerivedData = true;
    else if (arg === '--skip-apply') parsed.skipApply = true;
    else if (arg === '--preflight-only') parsed.preflightOnly = true;
    else if (arg === '--launch-wait-ms') parsed.launchWaitMs = Number(argv[++index] || 2500);
  }

  return parsed;
}

/**
 * Checks whether CLI args request a configured app target.
 * @param {object} args Parsed args.
 * @returns {boolean} True when not using the sample target.
 */
function usesConfiguredTarget(args) {
  return Boolean(args.config || args.workspace || args.project || args.scheme || args.bundleId || args.sourceRoot);
}

/**
 * Loads config from file and overlays CLI flags.
 * @param {object} options Load options.
 * @param {string} options.repoRoot Screenslop repo root.
 * @param {object} options.args Parsed args.
 * @returns {object} Config payload.
 */
function loadTargetConfig({ repoRoot, args }) {
  const fileConfig = args.config
    ? JSON.parse(fs.readFileSync(path.resolve(repoRoot, args.config), 'utf8'))
    : {};
  return {
    ...createDefaultConfig({
      detected: { preferred: 'baguette' },
      values: {
        workspace: args.workspace,
        project: args.project,
        scheme: args.scheme,
        'bundle-id': args.bundleId,
        device: args.device,
        surface: args.surface,
        'source-root': args.sourceRoot,
        'artifacts-dir': fileConfig.artifactsDir || 'artifacts'
      }
    }),
    ...fileConfig,
    workspacePath: args.workspace || fileConfig.workspacePath || null,
    projectPath: args.project || fileConfig.projectPath || null,
    defaultScheme: args.scheme || fileConfig.defaultScheme || null,
    defaultBundleId: args.bundleId || fileConfig.defaultBundleId || null,
    defaultDevice: args.device || fileConfig.defaultDevice || null,
    defaultSurface: args.surface || fileConfig.defaultSurface || null,
    sourceRoot: args.sourceRoot || fileConfig.sourceRoot || null
  };
}

/**
 * Runs runtime tool preflight checks.
 * @param {object} options Preflight options.
 * @returns {object} Preflight result.
 */
function runPreflight({ repoRoot, commandRunner, stages }) {
  const xcodebuildmcp = runStage({ stages, name: 'preflight-xcodebuildmcp', command: 'xcodebuildmcp', args: ['--version'], cwd: repoRoot, commandRunner });
  if (!xcodebuildmcp.ok) return { ok: false, reason: 'xcodebuildmcp-unavailable' };

  const baguette = runStage({ stages, name: 'preflight-baguette', command: 'baguette', args: ['--version'], cwd: repoRoot, commandRunner });
  if (!baguette.ok) return { ok: false, reason: 'baguette-unavailable' };

  const doctor = runStage({ stages, name: 'preflight-doctor', command: 'node', args: ['bin/screenslop.mjs', 'doctor'], cwd: repoRoot, commandRunner });
  if (!doctor.ok) return { ok: false, reason: 'doctor-failed' };

  const list = runStage({ stages, name: 'preflight-baguette-list', command: 'baguette', args: ['list', '--json'], cwd: repoRoot, commandRunner, parseJson: true });
  if (!list.ok || !list.json) return { ok: false, reason: 'baguette-list-failed' };

  return { ok: true, baguetteList: list.json };
}

/**
 * Builds XcodeBuildMCP build/run arguments.
 * @param {object} options Build options.
 * @returns {string[]} Command args.
 */
function buildRunArgs({ target, device, derivedDataPath }) {
  const projectArgs = target.workspace
    ? ['--workspace-path', target.workspace]
    : ['--project-path', target.project];
  return [
    'simulator', 'build-and-run',
    ...projectArgs,
    '--scheme', target.scheme,
    '--simulator-id', device.udid,
    '--configuration', 'Debug',
    '--derived-data-path', derivedDataPath,
    '--output', 'json'
  ];
}

/**
 * Runs a Screenslop CLI stage that must print JSON.
 * @param {object} options Stage options.
 * @returns {object} Stage result with parsed JSON.
 */
function runJsonCliStage({ stages, name, repoRoot, commandRunner, args }) {
  return runStage({
    stages,
    name,
    command: 'node',
    args: ['bin/screenslop.mjs', ...args],
    cwd: repoRoot,
    commandRunner,
    parseJson: true
  });
}

/**
 * Runs one external command and records a bounded stage result.
 * @param {object} options Stage options.
 * @returns {object} Stage result.
 */
function runStage({ stages, name, command, args, cwd, commandRunner, parseJson = false }) {
  const started = Date.now();
  const result = commandRunner({ command, args, cwd });
  const durationMs = Date.now() - started;
  const json = parseJson ? parseJsonPayload(result.stdout) : null;
  const jsonOk = !parseJson || (json !== null && json.didError !== true);
  const ok = result.status === 0 && jsonOk;
  const stage = {
    name,
    ok,
    status: result.status,
    durationMs,
    command: [command, ...args],
    stdout: snippet(result.stdout),
    stderr: snippet(result.stderr)
  };
  if (parseJson) stage.json = json;
  if (parseJson && !json) stage.error = 'stdout was not parseable JSON';
  stages.push(stage);
  return { ...stage, json };
}

/**
 * Adds a non-command stage to the report.
 * @param {object[]} stages Stage list.
 * @param {string} name Stage name.
 * @param {boolean} ok Whether it passed.
 * @param {string} message Short message.
 * @param {object} [details] Extra details.
 * @returns {void}
 */
function addSyntheticStage(stages, name, ok, message, details = {}) {
  stages.push({ name, ok, status: ok ? 0 : 1, durationMs: 0, message, details });
}

/**
 * Checks configured target fields before build/run starts.
 * @param {object} target Runtime target.
 * @returns {object} Validation stage result.
 */
function validateBuildTarget(target) {
  const missing = [];
  if (!target.workspace && !target.project) missing.push('workspace-or-project');
  if (!target.scheme) missing.push('scheme');
  if (!target.bundleId) missing.push('bundleId');
  if (!target.sourceRoot) missing.push('sourceRoot');
  if (target.kind === 'configured') {
    if (!target.surface) missing.push('surface');
    if (!target.runtimeIdentifier && !target.findingId) missing.push('identifier-or-finding');
  }

  return {
    ok: missing.length === 0,
    message: missing.length ? `Missing runtime target field(s): ${missing.join(', ')}.` : 'Runtime target config is complete.',
    details: {
      kind: target.kind,
      missing,
      hasWorkspace: Boolean(target.workspace),
      hasProject: Boolean(target.project),
      hasSurface: Boolean(target.surface),
      hasFindingSelector: Boolean(target.runtimeIdentifier || target.findingId)
    }
  };
}

/**
 * Selects a simulator from Baguette output.
 * @param {object} envelope Baguette list envelope.
 * @param {object} options Selection options.
 * @returns {object|null} Simulator record.
 */
function selectRuntimeDevice(envelope, options = {}) {
  const devices = [...(envelope.running || []), ...(envelope.available || [])];
  if (options.udid) return devices.find((device) => device.udid === options.udid) || null;
  if (options.deviceName) {
    const target = options.deviceName.toLowerCase();
    return devices.find((device) => device.name.toLowerCase() === target) || devices.find((device) => device.name.toLowerCase().includes(target)) || null;
  }
  return devices.find((device) => device.state === 'Booted') || devices[0] || null;
}

/**
 * Confirms expected evidence files exist in a bundle.
 * @param {object} options Artifact options.
 * @returns {object} Check result.
 */
function assertEvidenceArtifacts({ repoRoot, bundle }) {
  const required = ['screenshot.jpg', 'accessibility.json', 'evidence.json', 'summary.md'];
  const missing = required.filter((file) => !fs.existsSync(path.join(repoRoot, bundle, file)));
  return {
    ok: missing.length === 0,
    message: missing.length ? `Missing runtime artifacts: ${missing.join(', ')}.` : 'Runtime evidence artifacts exist.',
    details: { bundle, required, missing }
  };
}

/**
 * Checks that fix patches stayed inside the configured source root.
 * @param {object} options Scope options.
 * @returns {object} Scope result.
 */
function assertFixScope({ repoRoot, sourceRoot, fix }) {
  const patches = fix.session?.appliedPatches || [];
  if (!patches.length) return { ok: false, message: 'No applied patches were recorded.', details: { patches: 0 } };
  const canonicalSourceRoot = canonicalizeExistingPath(sourceRoot);
  const bad = patches.filter((patch) => {
    const absolute = canonicalizeExistingPath(path.resolve(repoRoot, patch.file || ''));
    const relative = path.relative(canonicalSourceRoot, absolute);
    return relative.startsWith('..') || path.isAbsolute(relative);
  });
  return {
    ok: bad.length === 0,
    message: bad.length ? 'Fix wrote outside the configured source root.' : 'Fix patches stayed inside the configured source root.',
    details: {
      patches: patches.map((patch) => displayPath(path.resolve(repoRoot, patch.file || ''), repoRoot)),
      bad: bad.map((patch) => ({ ...patch, file: displayPath(path.resolve(repoRoot, patch.file || ''), repoRoot) }))
    }
  };
}

/**
 * Finishes, writes, and returns the smoke report.
 * @param {object} report Report object.
 * @param {object} options Finish options.
 * @returns {object} Final report.
 */
function finishReport(report, { reason = null, paths, writeReport, repoRoot }) {
  report.finishedAt = new Date().toISOString();
  report.reason = reason;
  report.summary = summarizeRuntimeSmoke(report);
  report.artifacts.report = displayPath(paths.reportPath, repoRoot || defaultRepoRoot);
  report.pathDisplayMode = 'redacted';
  sanitizeReport(report, {
    repoRoot: repoRoot || defaultRepoRoot,
    bundleIds: collectBundleIds(report)
  });
  if (writeReport) {
    fs.mkdirSync(path.dirname(paths.reportPath), { recursive: true });
    fs.writeFileSync(paths.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
}

/**
 * Builds the compact status block agents can read without parsing every stage.
 *
 * @param {object} report Full runtime smoke report.
 * @returns {object} Stable public summary.
 */
function summarizeRuntimeSmoke(report) {
  const failedStage = report.stages.find((stage) => stage.ok === false) || null;
  return {
    status: report.ok ? 'passed' : 'failed',
    reason: report.reason || null,
    targetKind: report.target?.kind || null,
    surface: report.surface || report.target?.surface || null,
    captureStatus: stageOutcome(report.stages, 'baseline-see'),
    artifactStatus: stageOutcome(report.stages, 'baseline-artifacts'),
    critiqueStatus: stageOutcome(report.stages, 'baseline-critique'),
    selectedFindingId: report.findingId || null,
    fixStatus: stageOutcome(report.stages, 'fix-apply'),
    freshCaptureStatus: stageOutcome(report.stages, 'fresh-see'),
    freshArtifactStatus: stageOutcome(report.stages, 'fresh-artifacts'),
    freshCritiqueStatus: stageOutcome(report.stages, 'fresh-critique'),
    verifyStageStatus: stageOutcome(report.stages, 'verify'),
    verifyStatus: report.verificationStatus || null,
    failedStage: failedStage?.name || null,
    stageCount: report.stages.length
  };
}

/**
 * Returns a stable status word for one runtime smoke stage.
 *
 * @param {object[]} stages Smoke stages.
 * @param {string} name Stage name.
 * @returns {"passed"|"failed"|"not-run"} Stage outcome.
 */
function stageOutcome(stages, name) {
  const stage = stages.find((entry) => entry.name === name);
  if (!stage) return 'not-run';
  return stage.ok ? 'passed' : 'failed';
}

/**
 * Writes the baseline source expected by the repeatable smoke.
 * @param {string} contentView ContentView path.
 * @returns {void}
 */
function restoreBaselineSource(contentView) {
  fs.mkdirSync(path.dirname(contentView), { recursive: true });
  fs.writeFileSync(contentView, baselineContentViewSource());
}

/**
 * Returns the baseline ContentView source with the intentional fixable issue.
 * @returns {string} Swift source.
 */
function baselineContentViewSource() {
  return `import SwiftUI

public struct ContentView: View {
    @State private var saveCount = 0

    public init() {}

    public var body: some View {
        VStack(spacing: 24) {
            VStack(spacing: 8) {
                Text("RuntimeSmoke")
                    .font(.largeTitle.bold())
                    .accessibilityIdentifier("runtimeSmoke.title")

                Text("Live simulator proof for Screenslop")
                    .font(.body)
                    .foregroundStyle(.secondary)
            }

            Button(action: saveChanges) {
                Image(systemName: "tray.and.arrow.down.fill")
                    .font(.title2)
                    .accessibilityHidden(true)
            }
            .buttonStyle(.borderedProminent)
            .accessibilityElement(children: .ignore)
            .accessibilityIdentifier("runtimeSmoke.saveButton")

            Text("Saved \\(saveCount) time\\(saveCount == 1 ? "" : "s")")
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
                .accessibilityIdentifier("runtimeSmoke.statusText")
        }
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    private func saveChanges() {
        saveCount += 1
    }
}

#Preview {
    ContentView()
}
`;
}

/**
 * Runs a local command with captured stdio.
 * @param {object} options Command options.
 * @returns {object} Command result.
 */
function defaultCommandRunner({ command, args, cwd }) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20
  });
  return {
    status: result.status === null ? 1 : result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || ''
  };
}

/**
 * Parses a command stdout JSON payload.
 * @param {string} stdout Raw stdout.
 * @returns {object|null} Parsed JSON or null.
 */
function parseJsonPayload(stdout) {
  try {
    return JSON.parse(String(stdout || '').trim());
  } catch {
    return null;
  }
}

/**
 * Returns a short output snippet for reports.
 * @param {string} value Raw output.
 * @returns {string} Snippet.
 */
function snippet(value) {
  const text = String(value || '').trim();
  return text.length > 4000 ? `${text.slice(0, 4000)}…` : text;
}

/**
 * Removes private fields from simulator output.
 * @param {object} device Simulator record.
 * @returns {object} Public simulator record.
 */
function publicDevice(device) {
  return {
    name: device.name,
    runtime: device.runtime,
    state: device.state,
    udid: device.udid
  };
}

/**
 * Returns a private-path-safe target summary for reports.
 * @param {object} target Runtime target.
 * @param {string} repoRoot Repo root.
 * @returns {object} Public target summary.
 */
function publicTarget(target, repoRoot) {
  return {
    kind: target.kind,
    workspace: displayPath(target.workspace, repoRoot),
    project: displayPath(target.project, repoRoot),
    scheme: target.scheme,
    bundleId: target.bundleId,
    sourceRoot: displayPath(target.sourceRoot, repoRoot),
    surface: target.surface,
    runtimeIdentifier: target.runtimeIdentifier,
    findingId: target.findingId,
    device: target.device,
    pathDisplayMode: 'redacted'
  };
}

/**
 * Redacts private paths from final JSON reports.
 * @param {object} value Report value.
 * @param {object} context Redaction context.
 * @param {string} context.repoRoot Repo root.
 * @returns {object} Redacted report.
 */
function sanitizeReport(value, context) {
  if (typeof value === 'string') return redactString(value, context);
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) value[index] = sanitizeReport(value[index], context);
    return value;
  }
  if (!value || typeof value !== 'object') return value;
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') value[key] = redactString(entry, context);
    else if (entry && typeof entry === 'object') value[key] = sanitizeReport(entry, context);
  }
  return value;
}

/**
 * Collects exact bundle IDs that should not appear in final reports.
 * @param {object} report Runtime smoke report.
 * @returns {string[]} Bundle IDs.
 */
function collectBundleIds(report) {
  return [...new Set([report.bundleId, report.target?.bundleId].filter(Boolean))];
}

/**
 * Redacts path-like string fragments.
 * @param {string} value Raw string.
 * @param {object} context Redaction context.
 * @returns {string} Redacted string.
 */
function redactString(value, context) {
  const repoRoot = context.repoRoot;
  const replacements = [
    [canonicalizeExistingPath(repoRoot), '<repo>'],
    [repoRoot, '<repo>']
  ];
  for (const bundleId of context.bundleIds || []) replacements.push([bundleId, '<bundle-id>']);
  const home = process.env.HOME || '';
  if (home) replacements.push([canonicalizeExistingPath(home), '<home>'], [home, '<home>']);

  let redacted = value;
  for (const [needle, replacement] of replacements) {
    if (!needle) continue;
    redacted = redacted.split(needle).join(replacement);
  }
  redacted = redactGenericAbsolutePaths(redacted);
  return redacted;
}

/**
 * Collapses remaining POSIX absolute path fragments outside known safe roots.
 * @param {string} value Partially redacted string.
 * @returns {string} String with private absolute fragments replaced.
 */
function redactGenericAbsolutePaths(value) {
  const text = String(value || '');
  if (path.isAbsolute(text.trim())) return '<absolute-path>';

  return text.replace(
    /(^|[\s"'=:([{,])\/(?:private\/)?(?:Applications|Library|System|Users|Volumes|bin|etc|home|opt|private|sbin|tmp|usr|var)\/[^\s"')\]},]+/g,
    '$1<absolute-path>'
  );
}

/**
 * Redacts absolute paths in smoke reports.
 * @param {string|null} value Path value.
 * @param {string} repoRoot Repo root.
 * @returns {string|null} Redacted path.
 */
function displayPath(value, repoRoot) {
  if (!value) return null;
  const root = canonicalizeExistingPath(repoRoot);
  const absolute = canonicalizeExistingPath(path.resolve(value));
  const relative = path.relative(root, absolute);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) return path.join('<repo>', relative);
  const home = process.env.HOME || '';
  const realHome = home ? canonicalizeExistingPath(home) : '';
  if (realHome && (absolute === realHome || absolute.startsWith(`${realHome}${path.sep}`))) return path.join('<home>', path.relative(realHome, absolute));
  return '<absolute-path>';
}

/**
 * Canonicalizes an existing path or nearest existing parent.
 * @param {string} candidate Candidate path.
 * @returns {string} Canonical path.
 */
function canonicalizeExistingPath(candidate) {
  const missingParts = [];
  let current = path.resolve(candidate);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missingParts.unshift(path.basename(current));
    current = parent;
  }

  const base = fs.existsSync(current) ? fs.realpathSync.native(current) : path.resolve(current);
  return path.join(base, ...missingParts);
}

/**
 * Formats a timestamp for artifact paths.
 * @param {Date} date Date to format.
 * @returns {string} Path-safe UTC timestamp.
 */
function timestampForPath(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

/**
 * Sleeps for the requested delay.
 * @param {number} ms Delay in milliseconds.
 * @returns {Promise<void>} Resolves after delay.
 */
function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (process.argv[1] && path.resolve(process.argv[1]) === thisFile) {
  const report = await runRealRuntimeSmoke();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
