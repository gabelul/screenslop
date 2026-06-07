import fs from 'node:fs';
import readline from 'node:readline';
import { createFinding } from '../findings.mjs';

const maxFindings = 20;
const patterns = [
  { kind: 'crash', severity: 'P1', regex: /uncaught exception|terminating app|fatal error|crash/i },
  { kind: 'fault', severity: 'P1', regex: /\bfault\b/i },
  { kind: 'error', severity: 'P2', regex: /\berror\b/i },
  { kind: 'constraints', severity: 'P2', regex: /unable to simultaneously satisfy constraints|unsatisfiable constraints|autolayout/i },
  { kind: 'swiftui-layout', severity: 'P2', regex: /invalid frame|nan|layout cycle|attributegraph/i }
];

/**
 * Finds runtime log issues from a bounded line-by-line scan.
 * @param {object} context Evidence context.
 * @returns {Promise<object[]>} Log findings.
 */
export async function detectLogIssues(context) {
  if (!context.artifacts.logs.exists) return [];

  const findings = [];
  const stream = fs.createReadStream(context.artifacts.logs.absolutePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let lineNumber = 0;

  for await (const line of lines) {
    lineNumber += 1;
    const text = extractLogText(line);
    const matches = patterns.filter((pattern) => pattern.regex.test(text));
    if (matches.length === 0) continue;

    for (const match of matches) {
      findings.push(createFinding({
        ruleId: `logs.${match.kind}`,
        severity: match.severity,
        pillar: match.kind === 'swiftui-layout' || match.kind === 'constraints' ? 'layout' : 'performance',
        title: logTitle(match.kind),
        detail: `Runtime logs include: ${truncate(text, 220)}`,
        evidence: {
          artifact: context.artifacts.logs.displayPath || null,
          line: lineNumber,
          snippet: truncate(text, 500)
        },
        suggestedFix: logFix(match.kind),
        verification: 'Recapture logs after the fix and confirm this line no longer appears.',
        confidence: 'medium',
        effort: 'medium',
        fingerprint: `${match.kind}:${lineNumber}:${truncate(text, 120)}`
      }));

      if (findings.length >= maxFindings) break;
    }

    if (findings.length >= maxFindings) break;
  }

  return findings;
}

/**
 * Extracts useful text from JSON or plain log lines.
 * @param {string} line Raw log line.
 * @returns {string} Human-readable line.
 */
function extractLogText(line) {
  try {
    const parsed = JSON.parse(line);
    return [parsed.eventMessage, parsed.message, parsed.composedMessage, parsed.category, parsed.subsystem, parsed.level]
      .filter(Boolean)
      .join(' ')
      || line;
  } catch {
    return line;
  }
}

/**
 * Returns a readable log finding title.
 * @param {string} kind Matched log kind.
 * @returns {string} Finding title.
 */
function logTitle(kind) {
  const titles = {
    crash: 'Runtime log reports a crash or fatal error',
    fault: 'Runtime log reports a fault',
    error: 'Runtime log reports an error',
    constraints: 'Runtime log reports Auto Layout constraint trouble',
    'swiftui-layout': 'Runtime log reports SwiftUI layout trouble'
  };
  return titles[kind] || 'Runtime log issue';
}

/**
 * Returns a short suggested fix for log findings.
 * @param {string} kind Matched log kind.
 * @returns {string} Suggested fix.
 */
function logFix(kind) {
  if (kind === 'constraints') return 'Inspect the affected view constraints and remove conflicting fixed sizes or priorities.';
  if (kind === 'swiftui-layout') return 'Inspect the SwiftUI layout path for invalid dimensions, NaN values, or recursive layout updates.';
  return 'Inspect the logged subsystem and fix the underlying runtime error before treating the screen as clean.';
}

/**
 * Truncates long log text.
 * @param {string} value Text value.
 * @param {number} limit Maximum characters.
 * @returns {string} Truncated value.
 */
function truncate(value, limit) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
