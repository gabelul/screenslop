import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { runRealRuntimeSmoke, selectRuntimeFinding } from '../scripts/smoke-real-runtime.mjs';

test('real runtime smoke runner orders live stages and restores baseline source', async () => {
  const workspace = createRuntimeWorkspace();
  const calls = [];
  const report = await runRealRuntimeSmoke({
    repoRoot: workspace.root,
    paths: workspace.paths,
    argv: ['--launch-wait-ms', '0'],
    writeReport: false,
    sleep: async () => {},
    commandRunner: fakeRuntimeCommandRunner({ workspace, calls })
  });

  assert.equal(report.ok, true);
  assert.equal(report.findingId, 'runtime-save-missing');
  assert.equal(report.verificationStatus, 'verified-fixed');
  assert.deepEqual(report.stages.map((stage) => stage.name), [
    'preflight-xcodebuildmcp',
    'preflight-baguette',
    'preflight-doctor',
    'preflight-baguette-list',
    'select-device',
    'build-run-baseline',
    'baseline-see',
    'baseline-artifacts',
    'baseline-critique',
    'select-finding',
    'fix-apply',
    'fix-scope',
    'build-run-fresh',
    'fresh-see',
    'fresh-artifacts',
    'fresh-critique',
    'verify',
    'verify-status'
  ]);
  assert.equal(calls.some((call) => call.command === 'xcodebuildmcp' && call.args.includes('build-and-run')), true);
  assert.equal(calls.some((call) => call.command === 'node' && call.args.includes('verify')), true);
  assert.equal(fs.readFileSync(workspace.paths.contentView, 'utf8').includes('.accessibilityLabel("Save changes")'), false);
});

test('real runtime smoke reports preflight failures as parseable JSON objects', async () => {
  const workspace = createRuntimeWorkspace();
  const report = await runRealRuntimeSmoke({
    repoRoot: workspace.root,
    paths: workspace.paths,
    writeReport: false,
    sleep: async () => {},
    commandRunner({ command, args }) {
      if (command === 'xcodebuildmcp' && args[0] === '--version') return shellResult({ status: 1, stderr: 'missing xcodebuildmcp' });
      return shellResult();
    }
  });

  assert.equal(report.ok, false);
  assert.equal(report.reason, 'xcodebuildmcp-unavailable');
  assert.doesNotThrow(() => JSON.parse(JSON.stringify(report)));
});

test('real runtime smoke does not verify when fresh capture fails', async () => {
  const workspace = createRuntimeWorkspace();
  const calls = [];
  const report = await runRealRuntimeSmoke({
    repoRoot: workspace.root,
    paths: workspace.paths,
    argv: ['--launch-wait-ms', '0'],
    writeReport: false,
    sleep: async () => {},
    commandRunner: fakeRuntimeCommandRunner({ workspace, calls, failFreshSee: true })
  });

  assert.equal(report.ok, false);
  assert.equal(report.reason, 'fresh-see-failed');
  assert.equal(calls.some((call) => call.command === 'node' && call.args.includes('verify')), false);
});

test('selectRuntimeFinding prefers the stable runtime identifier and missing-name rule', () => {
  const selected = selectRuntimeFinding([
    finding({ id: 'wrong', ruleId: 'ax.missing-name', identifier: 'settings.saveButton' }),
    finding({ id: 'touch', ruleId: 'layout.touch-target', identifier: 'runtimeSmoke.saveButton' }),
    finding({ id: 'missing', ruleId: 'ax.missing-name', identifier: 'runtimeSmoke.saveButton' })
  ]);

  assert.equal(selected.id, 'missing');
});

test('real runtime smoke does not verify when fresh critique fails', async () => {
  const workspace = createRuntimeWorkspace();
  const calls = [];
  const report = await runRealRuntimeSmoke({
    repoRoot: workspace.root,
    paths: workspace.paths,
    argv: ['--launch-wait-ms', '0'],
    writeReport: false,
    sleep: async () => {},
    commandRunner: fakeRuntimeCommandRunner({ workspace, calls, failFreshCritique: true })
  });

  assert.equal(report.ok, false);
  assert.equal(report.reason, 'fresh-critique-failed');
  assert.equal(calls.some((call) => call.command === 'node' && call.args.includes('verify')), false);
});

/**
 * Creates a temporary RuntimeSmoke-like workspace.
 * @returns {object} Workspace paths.
 */
function createRuntimeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-real-runtime-test-'));
  const appRoot = path.join(root, 'examples/runtime-smoke-app');
  const contentView = path.join(appRoot, 'RuntimeSmokePackage/Sources/RuntimeSmokeFeature/ContentView.swift');
  fs.mkdirSync(path.dirname(contentView), { recursive: true });
  fs.writeFileSync(contentView, 'placeholder');
  return {
    root,
    paths: {
      appRoot,
      workspace: path.join(appRoot, 'RuntimeSmoke.xcworkspace'),
      contentView,
      reportPath: path.join(root, 'artifacts/runtime-smoke-test-report.json')
    }
  };
}

/**
 * Creates a fake command runner for runtime smoke orchestration tests.
 * @param {object} options Fake runner options.
 * @returns {Function} Command runner.
 */
function fakeRuntimeCommandRunner({ workspace, calls, failFreshSee = false, failFreshCritique = false }) {
  let seeCount = 0;
  return ({ command, args, cwd }) => {
    calls.push({ command, args, cwd });

    if (command === 'xcodebuildmcp' && args[0] === '--version') return shellResult({ stdout: '2.5.1' });
    if (command === 'baguette' && args[0] === '--version') return shellResult({ stdout: '0.1.74' });
    if (command === 'baguette' && args[0] === 'list') {
      return shellResult({ stdout: JSON.stringify({ running: [{ name: 'iPhone 17', runtime: 'iOS 26.4', state: 'Booted', udid: 'SIM-1' }], available: [] }) });
    }
    if (command === 'xcodebuildmcp' && args.includes('build-and-run')) return shellResult({ stdout: JSON.stringify({ didError: false }) });
    if (command === 'node' && args.includes('doctor')) return shellResult({ stdout: 'Screenslop doctor' });

    if (command === 'node' && args.includes('see')) {
      seeCount += 1;
      if (failFreshSee && seeCount === 2) return shellResult({ status: 1, stdout: JSON.stringify({ ok: false }) });
      const name = seeCount === 1 ? 'baseline-runtime' : 'fresh-runtime';
      writeEvidenceBundle(workspace.root, name);
      return shellResult({ stdout: JSON.stringify({
        ok: true,
        dir: `artifacts/${name}`,
        evidence: `artifacts/${name}/evidence.json`,
        artifacts: {
          screenshot: `artifacts/${name}/screenshot.jpg`,
          accessibilityTree: `artifacts/${name}/accessibility.json`,
          summary: `artifacts/${name}/summary.md`
        }
      }) });
    }

    if (command === 'node' && args.includes('critique')) {
      const bundle = args[args.indexOf('critique') + 1];
      if (failFreshCritique && bundle.includes('fresh-runtime')) return shellResult({ status: 1, stdout: JSON.stringify({ ok: false }) });
      const findings = bundle.includes('baseline-runtime') ? [finding({ id: 'runtime-save-missing', ruleId: 'ax.missing-name', identifier: 'runtimeSmoke.saveButton' })] : [];
      return shellResult({ stdout: JSON.stringify({ ok: true, findings, artifacts: { findingsPath: `${bundle}/findings.json` } }) });
    }

    if (command === 'node' && args.includes('fix')) {
      const source = fs.readFileSync(workspace.paths.contentView, 'utf8');
      fs.writeFileSync(workspace.paths.contentView, source.replace('.accessibilityIdentifier("runtimeSmoke.saveButton")', '.accessibilityIdentifier("runtimeSmoke.saveButton")\n            .accessibilityLabel("Save changes")'));
      return shellResult({ stdout: JSON.stringify({
        ok: true,
        artifacts: {
          fixPlanPath: 'artifacts/baseline-runtime/fix-plan.json',
          reportPath: 'artifacts/baseline-runtime/fix.md',
          sessionPath: 'artifacts/baseline-runtime/fix-session.json'
        },
        session: {
          appliedPatches: [{ findingId: 'runtime-save-missing', file: 'examples/runtime-smoke-app/RuntimeSmokePackage/Sources/RuntimeSmokeFeature/ContentView.swift' }]
        }
      }) });
    }

    if (command === 'node' && args.includes('verify')) {
      return shellResult({ stdout: JSON.stringify({
        ok: true,
        items: [{ findingId: 'runtime-save-missing', status: 'verified-fixed' }],
        artifacts: {
          verificationPath: 'artifacts/baseline-runtime/verification.json',
          reportPath: 'artifacts/baseline-runtime/verification.md'
        }
      }) });
    }

    return shellResult();
  };
}

/**
 * Writes a minimal fake evidence bundle.
 * @param {string} root Workspace root.
 * @param {string} name Bundle name.
 * @returns {void}
 */
function writeEvidenceBundle(root, name) {
  const dir = path.join(root, 'artifacts', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'screenshot.jpg'), 'fake image');
  fs.writeFileSync(path.join(dir, 'accessibility.json'), '{}');
  fs.writeFileSync(path.join(dir, 'evidence.json'), '{}');
  fs.writeFileSync(path.join(dir, 'summary.md'), '# fake');
}

/**
 * Creates a fake critique finding.
 * @param {object} options Finding options.
 * @returns {object} Finding.
 */
function finding({ id, ruleId, identifier }) {
  return {
    id,
    ruleId,
    evidence: { node: { identifier } }
  };
}

/**
 * Creates a fake shell result.
 * @param {object} [options] Shell result options.
 * @returns {object} Shell result.
 */
function shellResult(options = {}) {
  return {
    status: options.status ?? 0,
    stdout: options.stdout || '',
    stderr: options.stderr || ''
  };
}
