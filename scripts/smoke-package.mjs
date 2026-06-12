#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-package-smoke-'));

try {
  const packOutput = run('npm', ['pack', '--json', '--pack-destination', tempRoot], { cwd: repoRoot, parseJson: true });
  const packed = Array.isArray(packOutput.json) ? packOutput.json[0] : packOutput.json;
  const files = packed.files.map((file) => file.path);
  assertNoForbiddenPackageFiles(files);

  const tarballPath = path.join(tempRoot, packed.filename);
  run('tar', ['-xzf', tarballPath, '-C', tempRoot], { cwd: repoRoot });

  const packageRoot = path.join(tempRoot, 'package');
  assertPackageBinary(packageRoot);
  run('node', ['bin/screenslop.mjs', 'doctor'], { cwd: packageRoot });
  runJson('node', ['bin/screenslop.mjs', 'see', '--dry-run', '--json'], {
    cwd: packageRoot,
    assertPayload: (payload) => {
      assertEqual(payload.command, 'see', 'see command');
      assertEqual(payload.capture.status, 'dry-run', 'see dry-run status');
    }
  });
  runJson('node', ['bin/screenslop.mjs', 'matrix', '--dry-run', '--json'], {
    cwd: packageRoot,
    assertPayload: (payload) => {
      assertEqual(payload.command, 'matrix', 'matrix command');
      assertEqual(payload.summary.total, 6, 'matrix cell count');
    }
  });
  run(
    'node',
    [
      '--test',
      'tests/check-dogfood-redaction.test.mjs',
      'tests/config.test.mjs',
      'tests/contracts.test.mjs',
      'tests/matrix.test.mjs',
      'tests/verify.test.mjs'
    ],
    { cwd: packageRoot }
  );
  run('npm', ['run', '--silent', 'smoke:e2e', '--', '--fresh-mode', 'fixed'], { cwd: packageRoot });

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: 'package-smoke',
        package: packed.filename,
        files: files.length,
        checks: [
          'forbidden-files',
          'package-bin',
          'doctor',
          'see-dry-run-json',
          'matrix-dry-run-json',
          'package-tests',
          'fixture-e2e'
        ]
      },
      null,
      2
    )
  );
} finally {
  if (!process.argv.includes('--keep')) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

/**
 * Ensures the packed npm package keeps the public CLI binary intact.
 *
 * @param {string} packageRoot Extracted package root.
 * @returns {void}
 */
function assertPackageBinary(packageRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
  assertEqual(manifest.bin?.screenslop, 'bin/screenslop.mjs', 'package bin.screenslop');

  const binary = fs.readFileSync(path.join(packageRoot, manifest.bin.screenslop), 'utf8');
  if (!binary.startsWith('#!/usr/bin/env node')) {
    throw new Error('package bin.screenslop must keep the node shebang');
  }
}

/**
 * Runs a command and optionally parses stdout as JSON.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Command arguments.
 * @param {{cwd: string, parseJson?: boolean}} options Command options.
 * @returns {{stdout: string, json?: unknown}} Captured command output.
 */
function run(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe']
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} failed with ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
    );
  }

  return {
    stdout: result.stdout,
    json: options.parseJson ? JSON.parse(result.stdout) : undefined
  };
}

/**
 * Runs a command that must print JSON and validates the parsed payload.
 *
 * @param {string} command Executable name.
 * @param {string[]} args Command arguments.
 * @param {{cwd: string, assertPayload: (payload: any) => void}} options Command options.
 * @returns {void}
 */
function runJson(command, args, options) {
  const { json } = run(command, args, { cwd: options.cwd, parseJson: true });
  options.assertPayload(json);
}

/**
 * Fails when the npm pack file list contains local/private workflow state.
 *
 * @param {string[]} files Packed file paths.
 * @returns {void}
 */
function assertNoForbiddenPackageFiles(files) {
  const forbiddenPatterns = [
    /^\.omx\//,
    /^\.omc\//,
    /^artifacts\//,
    /^research\//,
    /^\.screenslop\//,
    /^\.github\/assets\/generated\//,
    /\/\.cursor\//,
    /\/\.github\//,
    /CLAUDE\.md$/
  ];

  const offenders = files.filter((file) => forbiddenPatterns.some((pattern) => pattern.test(file)));
  if (offenders.length > 0) {
    throw new Error(`Package includes forbidden local/private files:\n${offenders.join('\n')}`);
  }
}

/**
 * Tiny assertion helper for script-readable error messages.
 *
 * @param {unknown} actual Actual value.
 * @param {unknown} expected Expected value.
 * @param {string} label Assertion label.
 * @returns {void}
 */
function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
