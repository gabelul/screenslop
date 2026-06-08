import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts/check-dogfood-redaction.mjs');

test('dogfood redaction checker accepts a public-safe report', () => {
  const workspace = makeWorkspace();
  const reportPath = writeReport(workspace, 'clean.json', {
    ok: true,
    pathDisplayMode: 'redacted',
    target: {
      kind: 'configured',
      sourceRoot: '<repo>/ConfiguredApp',
      workspace: '<absolute-path>',
      bundleId: '<bundle-id>'
    },
    summary: {
      status: 'passed',
      verifyStatus: 'verified-fixed'
    },
    artifacts: ['artifacts/dogfood/report.json']
  });

  const result = runChecker([reportPath, '--forbid', 'dev.example.Secret', '--forbid=/Users/gabel/PrivateApp']);
  const payload = parseStdout(result);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.pathDisplayMode, 'redacted');
  assert.deepEqual(payload.checks, ['json-parse', 'pathDisplayMode', 'absolute-paths', 'forbid-values']);
});

test('dogfood redaction checker does not echo private report paths', () => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'PrivateAppRedaction-'));
  const reportPath = writeReport(workspace, 'private-app-report.json', {
    ok: true,
    pathDisplayMode: 'redacted',
    summary: {
      status: 'passed',
      verifyStatus: 'verified-fixed'
    }
  });

  const result = runChecker([reportPath, '--forbid', 'PrivateAppRedaction']);
  const payload = parseStdout(result);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(payload.report, '<redacted-report-path>');
  assert.doesNotMatch(result.stdout, /PrivateAppRedaction|private-app-report\.json/);
});


test('dogfood redaction checker does not echo missing report paths', () => {
  const missingPath = path.join(os.tmpdir(), 'PrivateAppRedaction-missing-report.json');
  const result = runChecker([missingPath]);
  const payload = parseStdout(result);

  assert.equal(result.status, 1);
  assert.equal(payload.report, '<redacted-report-path>');
  assert.equal(payload.summary, 'could not read or parse JSON report');
  assert.doesNotMatch(result.stdout, /PrivateAppRedaction|missing-report/);
});

test('dogfood redaction checker rejects missing redacted path mode', () => {
  const workspace = makeWorkspace();
  const reportPath = writeReport(workspace, 'missing-mode.json', {
    ok: true,
    summary: { status: 'passed' }
  });

  const result = runChecker([reportPath]);
  const payload = parseStdout(result);

  assert.equal(result.status, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, 'redaction-check-failed');
  assert.equal(payload.issues.some((issue) => issue.code === 'path-display-mode'), true);
});

test('dogfood redaction checker rejects raw absolute paths', () => {
  const workspace = makeWorkspace();
  const reportPath = writeReport(workspace, 'leaking-path.json', {
    ok: true,
    pathDisplayMode: 'redacted',
    target: {
      sourceRoot: '/Volumes/MyEXT/PrivateApp/Sources',
      screenshotUrl: 'file:///Users/gabel/PrivateApp/artifacts/screenshot.png'
    },
    stage: {
      stderr: 'opened /tmp/screenslop-private/output.json during capture'
    }
  });

  const result = runChecker([reportPath]);
  const payload = parseStdout(result);
  const absolutePathIssues = payload.issues.filter((issue) => issue.code === 'absolute-path');

  assert.equal(result.status, 1);
  assert.equal(absolutePathIssues.length, 3);
  assert.equal(absolutePathIssues.every((issue) => issue.value === '<raw-absolute-path>'), true);
  assert.doesNotMatch(result.stdout, /PrivateApp|\/Users\/gabel|\/Volumes\/MyEXT|file:\/\/\//);
});

test('dogfood redaction checker rejects caller-forbidden values', () => {
  const workspace = makeWorkspace();
  const reportPath = writeReport(workspace, 'forbid.json', {
    ok: true,
    pathDisplayMode: 'redacted',
    target: {
      bundleId: 'dev.example.Secret'
    }
  });

  const result = runChecker([reportPath, '--forbid', 'dev.example.Secret']);
  const payload = parseStdout(result);

  assert.equal(result.status, 1);
  assert.equal(payload.issues.some((issue) => issue.code === 'forbid-value' && issue.value === '<forbidden-value>'), true);
  assert.doesNotMatch(result.stdout, /dev\.example\.Secret/);
});

test('dogfood redaction checker reports invalid JSON without a stack trace', () => {
  const workspace = makeWorkspace();
  const reportPath = path.join(workspace, 'bad.json');
  fs.writeFileSync(reportPath, '{ nope', 'utf8');

  const result = runChecker([reportPath]);
  const payload = parseStdout(result);

  assert.equal(result.status, 1);
  assert.equal(payload.ok, false);
  assert.equal(payload.reason, 'json-parse-error');
  assert.equal(payload.summary, 'could not read or parse JSON report');
  assert.equal(payload.issues[0].value, '<redacted-error>');
  assert.doesNotMatch(result.stderr, /SyntaxError|at JSON\.parse/);
  assert.doesNotMatch(result.stdout, /bad\.json|screenslop-redaction-test/);
});

/**
 * Creates a temporary test workspace.
 *
 * @returns {string} Temporary directory path.
 */
function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-redaction-test-'));
}

/**
 * Writes a JSON report fixture into the temporary workspace.
 *
 * @param {string} workspace Temp workspace path.
 * @param {string} filename Fixture filename.
 * @param {object} payload JSON payload.
 * @returns {string} Fixture path.
 */
function writeReport(workspace, filename, payload) {
  const reportPath = path.join(workspace, filename);
  fs.writeFileSync(reportPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return reportPath;
}

/**
 * Runs the dogfood redaction checker script.
 *
 * @param {string[]} args CLI arguments.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} Spawn result.
 */
function runChecker(args) {
  return spawnSync(process.execPath, [scriptPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
}

/**
 * Parses JSON from checker stdout.
 *
 * @param {import('node:child_process').SpawnSyncReturns<string>} result Spawn result.
 * @returns {object} Parsed checker payload.
 */
function parseStdout(result) {
  assert.doesNotThrow(() => JSON.parse(result.stdout), result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
