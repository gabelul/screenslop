#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const thisFile = fileURLToPath(import.meta.url);
const defaultRepoRoot = path.resolve(path.dirname(thisFile), '..');
const bundleId = 'dev.screenslop.RuntimeSmoke';
const scheme = 'RuntimeSmoke';
const surface = 'RuntimeSmoke';
const runtimeIdentifier = 'runtimeSmoke.saveButton';
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
  const report = {
    ok: false,
    command: 'smoke:runtime',
    startedAt,
    finishedAt: null,
    bundleId,
    surface,
    selectedDevice: null,
    findingId: null,
    verificationStatus: null,
    artifacts: {},
    stages
  };

  const derivedDataIsTemporary = !args.keepDerivedData;
  const derivedDataPath = derivedDataIsTemporary
    ? fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-runtime-smoke-derived-'))
    : path.join(paths.appRoot, 'DerivedData', 'RuntimeSmoke');

  try {
    restoreBaselineSource(paths.contentView);

    const preflight = runPreflight({ repoRoot, commandRunner, stages });
    if (!preflight.ok) return finishReport(report, { reason: preflight.reason, paths, writeReport: options.writeReport !== false });

    const device = selectRuntimeDevice(preflight.baguetteList, {
      udid: args.udid,
      deviceName: args.device
    });
    if (!device) {
      addSyntheticStage(stages, 'select-device', false, 'No matching simulator device was reported by Baguette.', { udid: args.udid, device: args.device });
      return finishReport(report, { reason: 'device-unavailable', paths, writeReport: options.writeReport !== false });
    }
    report.selectedDevice = publicDevice(device);
    addSyntheticStage(stages, 'select-device', true, `Selected ${device.name} (${device.udid}).`, publicDevice(device));

    const baselineBuild = runStage({
      stages,
      name: 'build-run-baseline',
      command: 'xcodebuildmcp',
      args: buildRunArgs({ paths, device, derivedDataPath }),
      cwd: repoRoot,
      commandRunner,
      parseJson: true
    });
    if (!baselineBuild.ok) return finishReport(report, { reason: 'baseline-build-run-failed', paths, writeReport: options.writeReport !== false });

    await sleep(Number(args.launchWaitMs || 2500));

    const baselineSee = runJsonCliStage({
      stages,
      name: 'baseline-see',
      repoRoot,
      commandRunner,
      args: ['see', '--surface', surface, '--json', '--logs', '--bundle-id', bundleId, '--udid', device.udid]
    });
    if (!baselineSee.ok || !baselineSee.json?.ok) return finishReport(report, { reason: 'baseline-see-failed', paths, writeReport: options.writeReport !== false });
    report.artifacts.baselineBundle = baselineSee.json.dir;
    report.artifacts.baselineEvidence = baselineSee.json.evidence;
    report.artifacts.baselineArtifacts = baselineSee.json.artifacts;

    const baselineArtifactsOk = assertEvidenceArtifacts({ repoRoot, bundle: baselineSee.json.dir });
    addSyntheticStage(stages, 'baseline-artifacts', baselineArtifactsOk.ok, baselineArtifactsOk.message, baselineArtifactsOk.details);
    if (!baselineArtifactsOk.ok) return finishReport(report, { reason: 'baseline-artifacts-missing', paths, writeReport: options.writeReport !== false });

    const baselineCritique = runJsonCliStage({
      stages,
      name: 'baseline-critique',
      repoRoot,
      commandRunner,
      args: ['critique', baselineSee.json.dir, '--json']
    });
    if (!baselineCritique.ok || !baselineCritique.json?.ok) return finishReport(report, { reason: 'baseline-critique-failed', paths, writeReport: options.writeReport !== false });
    report.artifacts.baselineFindings = baselineCritique.json.artifacts?.findingsPath || path.join(baselineSee.json.dir, 'findings.json');

    const finding = selectRuntimeFinding(baselineCritique.json.findings || []);
    if (!finding) {
      addSyntheticStage(stages, 'select-finding', false, `No auto-fixable finding matched ${runtimeIdentifier}.`, { findings: baselineCritique.json.findings?.length || 0 });
      return finishReport(report, { reason: 'finding-unavailable', paths, writeReport: options.writeReport !== false });
    }
    report.findingId = finding.id;
    addSyntheticStage(stages, 'select-finding', true, `Selected ${finding.id}.`, { ruleId: finding.ruleId, identifier: finding.evidence?.node?.identifier || null });

    if (args.skipApply) {
      addSyntheticStage(stages, 'skip-apply', false, '--skip-apply stops before source patching and verification.', { findingId: finding.id });
      return finishReport(report, { reason: 'skip-apply-requested', paths, writeReport: options.writeReport !== false });
    }

    const fix = runJsonCliStage({
      stages,
      name: 'fix-apply',
      repoRoot,
      commandRunner,
      args: ['fix', baselineSee.json.dir, '--finding', finding.id, '--source-root', path.relative(repoRoot, paths.appRoot), '--apply', '--yes', '--label', 'Save changes', '--json']
    });
    if (!fix.ok || !fix.json?.ok) return finishReport(report, { reason: 'fix-apply-failed', paths, writeReport: options.writeReport !== false });
    report.artifacts.fixPlan = fix.json.artifacts?.fixPlanPath || path.join(baselineSee.json.dir, 'fix-plan.json');
    report.artifacts.fixReport = fix.json.artifacts?.reportPath || path.join(baselineSee.json.dir, 'fix.md');
    report.artifacts.fixSession = fix.json.artifacts?.sessionPath || path.join(baselineSee.json.dir, 'fix-session.json');

    const patchScope = assertFixScope({ repoRoot, appRoot: paths.appRoot, fix: fix.json });
    addSyntheticStage(stages, 'fix-scope', patchScope.ok, patchScope.message, patchScope.details);
    if (!patchScope.ok) return finishReport(report, { reason: 'fix-scope-failed', paths, writeReport: options.writeReport !== false });

    const freshBuild = runStage({
      stages,
      name: 'build-run-fresh',
      command: 'xcodebuildmcp',
      args: buildRunArgs({ paths, device, derivedDataPath }),
      cwd: repoRoot,
      commandRunner,
      parseJson: true
    });
    if (!freshBuild.ok) return finishReport(report, { reason: 'fresh-build-run-failed', paths, writeReport: options.writeReport !== false });

    await sleep(Number(args.launchWaitMs || 2500));

    const freshSee = runJsonCliStage({
      stages,
      name: 'fresh-see',
      repoRoot,
      commandRunner,
      args: ['see', '--surface', surface, '--json', '--logs', '--bundle-id', bundleId, '--udid', device.udid]
    });
    if (!freshSee.ok || !freshSee.json?.ok) return finishReport(report, { reason: 'fresh-see-failed', paths, writeReport: options.writeReport !== false });
    report.artifacts.freshBundle = freshSee.json.dir;
    report.artifacts.freshEvidence = freshSee.json.evidence;
    report.artifacts.freshArtifacts = freshSee.json.artifacts;

    const freshArtifactsOk = assertEvidenceArtifacts({ repoRoot, bundle: freshSee.json.dir });
    addSyntheticStage(stages, 'fresh-artifacts', freshArtifactsOk.ok, freshArtifactsOk.message, freshArtifactsOk.details);
    if (!freshArtifactsOk.ok) return finishReport(report, { reason: 'fresh-artifacts-missing', paths, writeReport: options.writeReport !== false });

    const freshCritique = runJsonCliStage({
      stages,
      name: 'fresh-critique',
      repoRoot,
      commandRunner,
      args: ['critique', freshSee.json.dir, '--json']
    });
    if (!freshCritique.ok || !freshCritique.json?.ok) return finishReport(report, { reason: 'fresh-critique-failed', paths, writeReport: options.writeReport !== false });
    report.artifacts.freshFindings = freshCritique.json.artifacts?.findingsPath || path.join(freshSee.json.dir, 'findings.json');

    const verify = runJsonCliStage({
      stages,
      name: 'verify',
      repoRoot,
      commandRunner,
      args: ['verify', baselineSee.json.dir, '--fresh-bundle', freshSee.json.dir, '--finding', finding.id, '--fix-session', report.artifacts.fixSession, '--json']
    });
    if (!verify.ok || !verify.json?.ok) return finishReport(report, { reason: 'verify-failed', paths, writeReport: options.writeReport !== false });

    const verifiedItem = verify.json.items?.find((item) => item.findingId === finding.id || item.baselineId === finding.id) || verify.json.items?.[0] || null;
    report.verificationStatus = verifiedItem?.status || null;
    report.artifacts.verification = verify.json.artifacts?.verificationPath || path.join(baselineSee.json.dir, 'verification.json');
    report.artifacts.verificationReport = verify.json.artifacts?.reportPath || path.join(baselineSee.json.dir, 'verification.md');

    if (report.verificationStatus !== 'verified-fixed') {
      addSyntheticStage(stages, 'verify-status', false, `Expected verified-fixed, got ${report.verificationStatus || 'none'}.`, { status: report.verificationStatus });
      return finishReport(report, { reason: 'verification-not-fixed', paths, writeReport: options.writeReport !== false });
    }

    addSyntheticStage(stages, 'verify-status', true, 'Selected finding is verified-fixed against fresh runtime evidence.', { status: report.verificationStatus });
    report.ok = true;
    return finishReport(report, { paths, writeReport: options.writeReport !== false });
  } catch (error) {
    addSyntheticStage(stages, 'unhandled-error', false, error.message, { stack: error.stack });
    return finishReport(report, { reason: 'unhandled-error', paths, writeReport: options.writeReport !== false });
  } finally {
    restoreBaselineSource(paths.contentView);
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
 * Chooses the RuntimeSmoke finding that should be patched.
 * @param {object[]} findings Critique findings.
 * @returns {object|null} Selected finding.
 */
export function selectRuntimeFinding(findings) {
  const matches = findings.filter((finding) => {
    const identifier = finding.evidence?.node?.identifier || finding.evidence?.sourceHint || '';
    return identifier === runtimeIdentifier && autoFixableRules.has(finding.ruleId);
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
    device: null,
    udid: null,
    keepDerivedData: false,
    skipApply: false,
    launchWaitMs: 2500
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--device') parsed.device = argv[++index] || null;
    else if (arg === '--udid') parsed.udid = argv[++index] || null;
    else if (arg === '--keep-derived-data') parsed.keepDerivedData = true;
    else if (arg === '--skip-apply') parsed.skipApply = true;
    else if (arg === '--launch-wait-ms') parsed.launchWaitMs = Number(argv[++index] || 2500);
  }

  return parsed;
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
function buildRunArgs({ paths, device, derivedDataPath }) {
  return [
    'simulator', 'build-and-run',
    '--workspace-path', paths.workspace,
    '--scheme', scheme,
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
 * Checks that fix patches stayed inside the sample app root.
 * @param {object} options Scope options.
 * @returns {object} Scope result.
 */
function assertFixScope({ repoRoot, appRoot, fix }) {
  const patches = fix.session?.appliedPatches || [];
  if (!patches.length) return { ok: false, message: 'No applied patches were recorded.', details: { patches: 0 } };
  const bad = patches.filter((patch) => {
    const absolute = path.resolve(repoRoot, patch.file || '');
    const relative = path.relative(appRoot, absolute);
    return relative.startsWith('..') || path.isAbsolute(relative);
  });
  return {
    ok: bad.length === 0,
    message: bad.length ? 'Fix wrote outside examples/runtime-smoke-app.' : 'Fix patches stayed inside examples/runtime-smoke-app.',
    details: { patches: patches.map((patch) => patch.file), bad }
  };
}

/**
 * Finishes, writes, and returns the smoke report.
 * @param {object} report Report object.
 * @param {object} options Finish options.
 * @returns {object} Final report.
 */
function finishReport(report, { reason = null, paths, writeReport }) {
  report.finishedAt = new Date().toISOString();
  report.reason = reason;
  report.artifacts.report = paths.reportPath;
  if (writeReport) {
    fs.mkdirSync(path.dirname(paths.reportPath), { recursive: true });
    fs.writeFileSync(paths.reportPath, `${JSON.stringify(report, null, 2)}\n`);
  }
  return report;
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
