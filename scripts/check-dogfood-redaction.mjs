#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) runCli(process.argv.slice(2));

/**
 * Runs the dogfood redaction checker CLI.
 *
 * @param {string[]} argv Raw command-line arguments.
 * @returns {void}
 */
function runCli(argv) {
  let args;
  try {
    args = parseArgs(argv);
  } catch (error) {
    writePayload(
      {
        ok: false,
        command: 'check-dogfood-redaction',
        reason: 'argument-error',
        summary: error.message,
        issues: [{ code: 'argument', path: '$', value: error.message }]
      },
      1
    );
    return;
  }

  let rawReport;
  try {
    rawReport = fs.readFileSync(args.reportPath, 'utf8');
  } catch {
    writePayload(
      {
        ok: false,
        command: 'check-dogfood-redaction',
        report: '<redacted-report-path>',
        reason: 'report-read-error',
        summary: 'could not read JSON report',
        issues: [{ code: 'report-read', path: '$', value: '<report-read-error>' }]
      },
      1
    );
    return;
  }

  let report;
  try {
    report = JSON.parse(rawReport);
  } catch {
    writePayload(
      {
        ok: false,
        command: 'check-dogfood-redaction',
        report: '<redacted-report-path>',
        reason: 'json-parse-error',
        summary: 'could not parse JSON report',
        issues: [{ code: 'json-parse', path: '$', value: '<json-parse-error>' }]
      },
      1
    );
    return;
  }

  const issues = inspectReport(report, args.forbidden);
  if (issues.length > 0) {
    writePayload(
      {
        ok: false,
        command: 'check-dogfood-redaction',
        report: '<redacted-report-path>',
        reason: 'redaction-check-failed',
        pathDisplayMode: report?.pathDisplayMode || null,
        summary: `${issues.length} redaction issue(s) found`,
        issues
      },
      1
    );
    return;
  }

  writePayload(
    {
      ok: true,
      command: 'check-dogfood-redaction',
      report: '<redacted-report-path>',
      pathDisplayMode: report.pathDisplayMode,
      checks: ['json-parse', 'pathDisplayMode', 'absolute-paths', 'forbid-values'],
      checkedStrings: collectStrings(report).length,
      forbiddenValues: args.forbidden.length
    },
    0
  );
}

/**
 * Parses checker arguments.
 *
 * @param {string[]} argv Raw command-line arguments.
 * @returns {{reportPath: string, forbidden: string[]}} Parsed options.
 */
export function parseArgs(argv) {
  const parsed = { reportPath: '', forbidden: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--forbid') {
      const value = argv[index + 1];
      if (!value) throw new Error('--forbid requires a value');
      parsed.forbidden.push(value);
      index += 1;
    } else if (arg.startsWith('--forbid=')) {
      const value = arg.slice('--forbid='.length);
      if (!value) throw new Error('--forbid requires a value');
      parsed.forbidden.push(value);
    } else if (arg === '--help' || arg === '-h') {
      throw new Error('Usage: node scripts/check-dogfood-redaction.mjs <report.json> [--forbid <value>]...');
    } else if (!parsed.reportPath) {
      parsed.reportPath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }

  if (!parsed.reportPath) throw new Error('Usage: node scripts/check-dogfood-redaction.mjs <report.json> [--forbid <value>]...');
  return parsed;
}

/**
 * Inspects a report for public-safety redaction issues.
 *
 * @param {unknown} report Parsed JSON report.
 * @param {string[]} forbidden Caller-provided private values.
 * @returns {{code: string, path: string, value: string}[]} Redaction issues.
 */
export function inspectReport(report, forbidden = []) {
  const issues = [];

  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    return [{ code: 'report-shape', path: '$', value: 'report must be a JSON object' }];
  }

  if (report.pathDisplayMode !== 'redacted') {
    issues.push({ code: 'path-display-mode', path: '$.pathDisplayMode', value: String(report.pathDisplayMode || '') });
  }

  const forbiddenValues = forbidden.filter((value) => value && !/^<[^>]+>$/.test(value));
  for (const entry of collectStrings(report)) {
    if (containsRawAbsolutePath(entry.value)) {
      issues.push({ code: 'absolute-path', path: entry.path, value: '<raw-absolute-path>' });
    }

    for (const forbiddenValue of forbiddenValues) {
      if (entry.value.includes(forbiddenValue)) {
        issues.push({ code: 'forbid-value', path: entry.path, value: '<forbidden-value>' });
      }
    }
  }

  return issues;
}

/**
 * Collects every string value from a JSON-like payload.
 *
 * @param {unknown} value JSON-like value.
 * @param {string} location JSONPath-ish location.
 * @returns {{path: string, value: string}[]} String entries.
 */
export function collectStrings(value, location = '$') {
  if (typeof value === 'string') return [{ path: location, value }];
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectStrings(entry, `${location}[${index}]`));
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, entry]) => collectStrings(entry, `${location}.${key}`));
}

/**
 * Detects raw absolute paths, including file URLs that expose absolute paths.
 *
 * @param {string} value String to inspect.
 * @returns {boolean} True when a raw absolute path is present.
 */
export function containsRawAbsolutePath(value) {
  const text = String(value || '');
  if (!text || text.startsWith('<')) return false;

  const trimmed = text.trim();
  if (path.isAbsolute(trimmed) && !trimmed.startsWith('/dev/null')) return true;
  if (/file:\/\/\/(?:private\/)?(?:Applications|Library|System|Users|Volumes|tmp|var)\//.test(text)) return true;

  return /(^|[\s"'=:([{,])\/(?:private\/)?(?:Applications|Library|System|Users|Volumes|bin|etc|home|opt|private|sbin|tmp|usr|var)\/[^\s"')\]},]+/.test(
    text
  );
}

/**
 * Writes a JSON payload to stdout and exits.
 *
 * @param {object} payload Output payload.
 * @param {number} status Process exit status.
 * @returns {void}
 */
function writePayload(payload, status) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(status);
}
