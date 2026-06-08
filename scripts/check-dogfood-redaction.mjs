#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  runCli(process.argv.slice(2));
}

/**
 * Runs the CLI entrypoint.
 *
 * @param {string[]} argv Raw command-line arguments.
 * @returns {void}
 */
function runCli(argv) {
  const args = parseArgs(argv);

  try {
  if (!args.reportPath) throw new Error('Usage: node scripts/check-dogfood-redaction.mjs <report.json> [--forbid <value>]...');

  const report = JSON.parse(fs.readFileSync(args.reportPath, 'utf8'));
  const failures = inspectReport(report, args.forbidden);

  if (failures.length > 0) {
    console.error(
      JSON.stringify(
        {
          ok: false,
          command: 'check-dogfood-redaction',
          report: args.reportPath,
          failures
        },
        null,
        2
      )
    );
    process.exit(1);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        command: 'check-dogfood-redaction',
        report: args.reportPath,
        checkedStrings: collectStrings(report).length,
        forbiddenValues: args.forbidden.length
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(
    JSON.stringify(
      {
        ok: false,
        command: 'check-dogfood-redaction',
        report: args.reportPath || null,
        failures: [{ path: '$', reason: error.message }]
      },
      null,
      2
    )
  );
  process.exit(1);
  }
}

/**
 * Parses command-line arguments for the dogfood redaction checker.
 *
 * @param {string[]} argv Raw command-line arguments.
 * @returns {{reportPath: string|null, forbidden: string[]}} Parsed options.
 */
export function parseArgs(argv) {
  const parsed = { reportPath: null, forbidden: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--forbid') {
      const value = argv[index + 1];
      if (!value) throw new Error('--forbid requires a value');
      parsed.forbidden.push(value);
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      throw new Error('Usage: node scripts/check-dogfood-redaction.mjs <report.json> [--forbid <value>]...');
    } else if (!parsed.reportPath) {
      parsed.reportPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  return parsed;
}

/**
 * Checks a dogfood report for private values that should not be published.
 *
 * @param {unknown} report Parsed JSON report.
 * @param {string[]} forbidden Explicit private strings to reject.
 * @returns {{path: string, reason: string, value?: string}[]} Redaction failures.
 */
export function inspectReport(report, forbidden = []) {
  const failures = [];

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return [{ path: '$', reason: 'report must be a JSON object' }];
  }

  if (report.pathDisplayMode !== 'redacted') {
    failures.push({ path: '$.pathDisplayMode', reason: 'expected pathDisplayMode to be "redacted"' });
  }

  const normalizedForbidden = forbidden.filter((value) => value && !/^<[^>]+>$/.test(value));

  for (const entry of collectStrings(report)) {
    for (const privateValue of normalizedForbidden) {
      if (entry.value.includes(privateValue)) {
        failures.push({ path: entry.path, reason: 'contains forbidden private value', value: safeSnippet(entry.value) });
      }
    }

    if (containsRawAbsolutePath(entry.value)) {
      failures.push({ path: entry.path, reason: 'contains raw absolute path', value: safeSnippet(entry.value) });
    }
  }

  return failures;
}

/**
 * Collects every string from a JSON-like value with JSONPath-ish locations.
 *
 * @param {unknown} value JSON-like value.
 * @param {string} location Current location.
 * @returns {{path: string, value: string}[]} String entries.
 */
export function collectStrings(value, location = '$') {
  if (typeof value === 'string') return [{ path: location, value }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectStrings(entry, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return [];

  return Object.entries(value).flatMap(([key, entry]) => collectStrings(entry, `${location}.${key}`));
}

/**
 * Detects raw absolute filesystem paths in report strings.
 *
 * @param {string} value String value to inspect.
 * @returns {boolean} True when the string exposes a raw absolute path.
 */
export function containsRawAbsolutePath(value) {
  const text = String(value || '');
  if (!text || text.startsWith('<')) return false;

  const trimmed = text.trim();
  if (path.isAbsolute(trimmed) && !trimmed.startsWith('/dev/null')) return true;

  return /(^|[\s"'=:([{,])\/(?:private\/)?(?:Applications|Library|System|Users|Volumes|bin|etc|home|opt|private|sbin|tmp|usr|var)\/[^\s"')\]},]+/.test(
    text
  );
}

/**
 * Keeps failure output useful without leaking a full private value again.
 *
 * @param {string} value Raw leaked value.
 * @returns {string} Short diagnostic snippet.
 */
function safeSnippet(value) {
  const text = String(value || '');
  if (text.length <= 80) return text;
  return `${text.slice(0, 77)}...`;
}
