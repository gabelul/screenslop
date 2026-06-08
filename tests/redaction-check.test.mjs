import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { containsRawAbsolutePath, inspectReport, parseArgs } from '../scripts/check-dogfood-redaction.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const checker = path.join(repoRoot, 'scripts/check-dogfood-redaction.mjs');

test('inspectReport accepts a redacted verified dogfood report', () => {
  const report = {
    ok: true,
    pathDisplayMode: 'redacted',
    summary: {
      status: 'passed',
      verifyStatus: 'verified-fixed'
    },
    target: {
      workspace: '<absolute-path>',
      bundleId: '<bundle-id>',
      sourceRoot: '<repo>/App'
    }
  };

  assert.deepEqual(inspectReport(report, ['/Users/gabel/PrivateApp', 'com.private.App', '<private-source-root>']), []);
});

test('inspectReport rejects missing redacted mode and private strings', () => {
  const failures = inspectReport(
    {
      pathDisplayMode: 'absolute',
      target: {
        workspace: '/Volumes/MyEXT/Private/App.xcworkspace',
        bundleId: 'com.private.App'
      }
    },
    ['com.private.App']
  );

  assert.ok(failures.some((failure) => failure.code === 'path-display-mode'));
  assert.ok(failures.some((failure) => failure.code === 'absolute-path'));
  assert.ok(failures.some((failure) => failure.code === 'forbid-value' && failure.value === '<forbidden-value>'));
});

test('containsRawAbsolutePath ignores placeholders and catches path fragments', () => {
  assert.equal(containsRawAbsolutePath('<absolute-path>'), false);
  assert.equal(containsRawAbsolutePath('<repo>/artifacts/run.json'), false);
  assert.equal(containsRawAbsolutePath('workspace=/Users/gabel/Private/App.xcworkspace'), true);
});

test('parseArgs collects report and repeated forbid values', () => {
  assert.deepEqual(parseArgs(['report.json', '--forbid', 'secret', '--forbid', 'bundle']), {
    reportPath: 'report.json',
    forbidden: ['secret', 'bundle']
  });
});

test('check-dogfood-redaction CLI exits nonzero for leaking reports', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-redaction-test-'));
  const report = path.join(temp, 'report.json');
  fs.writeFileSync(
    report,
    `${JSON.stringify(
      {
        pathDisplayMode: 'redacted',
        stages: [{ message: 'opened /Users/gabel/Private/App.xcworkspace' }]
      },
      null,
      2
    )}\n`
  );

  const result = spawnSync(process.execPath, [checker, report], { cwd: repoRoot, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /absolute-path/);
  assert.doesNotMatch(result.stdout, /\/Users\/gabel|Private/);
});
