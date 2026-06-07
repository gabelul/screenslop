import fs from 'node:fs';
import path from 'node:path';
import { displayPath } from '../critique/load-evidence.mjs';

const excludedDirs = new Set(['.git', '.omx', 'artifacts', 'DerivedData', 'build', 'node_modules']);

/**
 * Finds Swift source candidates for a critique finding.
 * @param {object} options Locator options.
 * @param {string} options.root Screenslop project root.
 * @param {string} options.sourceRoot App source root.
 * @param {object} options.finding Critique finding.
 * @returns {{sourceRoot:string, candidates:object[], strongCandidates:object[]}}
 */
export function locateSource(options) {
  const root = path.resolve(options.root || process.cwd());
  const requestedSourceRoot = path.resolve(root, options.sourceRoot || process.cwd());
  const sourceRoot = fs.existsSync(requestedSourceRoot) ? fs.realpathSync(requestedSourceRoot) : requestedSourceRoot;
  const files = listSwiftFiles(sourceRoot);
  const candidates = [];
  const finding = options.finding;

  addSourceHintCandidates({ root, sourceRoot, files, finding, candidates });
  addIdentifierCandidates({ root, files, finding, candidates });
  addVisibleLabelCandidates({ root, files, finding, candidates });

  const unique = dedupeCandidates(candidates);
  const strongCandidates = unique.filter((candidate) => candidate.strong);
  return {
    sourceRoot,
    candidates: unique,
    strongCandidates
  };
}

/**
 * Recursively lists Swift files inside a source root.
 * @param {string} sourceRoot Source root.
 * @returns {string[]} Swift file paths.
 */
export function listSwiftFiles(sourceRoot) {
  if (!fs.existsSync(sourceRoot)) return [];
  const files = [];
  walk(sourceRoot, files);
  return files;
}

/**
 * Checks whether an absolute path stays inside the declared source root.
 * @param {string} sourceRoot Source root.
 * @param {string} candidate Candidate file.
 * @returns {boolean} True when candidate is inside source root.
 */
export function isInsideSourceRoot(sourceRoot, candidate) {
  if (!fs.existsSync(candidate) || !fs.existsSync(sourceRoot)) return false;
  const realSourceRoot = fs.realpathSync(sourceRoot);
  const realCandidate = fs.realpathSync(candidate);
  const relative = path.relative(realSourceRoot, realCandidate);
  return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * Walks a directory tree for Swift files.
 * @param {string} dir Directory.
 * @param {string[]} files Output array.
 * @returns {void}
 */
function walk(dir, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (excludedDirs.has(entry.name)) continue;
      walk(path.join(dir, entry.name), files);
      continue;
    }
    if (entry.isFile() && entry.name.endsWith('.swift')) files.push(path.join(dir, entry.name));
  }
}

/**
 * Adds candidates from source hints when the file exists under sourceRoot.
 * @param {object} options Candidate options.
 * @returns {void}
 */
function addSourceHintCandidates({ root, sourceRoot, files, finding, candidates }) {
  const rawHint = finding.evidence?.sourceHint;
  if (!rawHint) return;
  const parsed = parseSourceHint(rawHint);
  if (!parsed.file.endsWith('.swift')) return;

  const hinted = path.isAbsolute(parsed.file) ? parsed.file : path.resolve(sourceRoot, parsed.file);
  const matches = fs.existsSync(hinted)
    ? [hinted]
    : files.filter((file) => path.basename(file) === path.basename(parsed.file));

  for (const file of matches) {
    if (!isInsideSourceRoot(sourceRoot, file)) continue;
    candidates.push({
      file: displayPath(root, file),
      absolutePath: file,
      line: parsed.line || 1,
      confidence: parsed.line ? 'high' : 'medium',
      reason: parsed.line ? `matched sourceHint line ${parsed.line}` : 'matched sourceHint file',
      matchedBy: 'sourceHint',
      strong: Boolean(parsed.line)
    });
  }
}

/**
 * Parses source hints like `SettingsView.swift` or `SettingsView.swift:42`.
 * @param {string} value Raw source hint.
 * @returns {{file:string,line:number|null}} Parsed hint.
 */
function parseSourceHint(value) {
  const text = String(value);
  const match = text.match(/^(.*\.swift)(?::(\d+))?$/);
  if (!match) return { file: text, line: null };
  return { file: match[1], line: match[2] ? Number(match[2]) : null };
}

/**
 * Adds high-confidence candidates from accessibility identifiers or review IDs.
 * @param {object} options Candidate options.
 * @returns {void}
 */
function addIdentifierCandidates({ root, files, finding, candidates }) {
  const identifier = finding.evidence?.node?.identifier;
  if (!identifier) return;

  const patterns = [
    `.accessibilityIdentifier("${escapeSwiftString(identifier)}")`,
    `.reviewID("${escapeSwiftString(identifier)}")`
  ];

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!patterns.some((pattern) => line.includes(pattern))) return;
      candidates.push({
        file: displayPath(root, file),
        absolutePath: file,
        line: index + 1,
        confidence: 'high',
        reason: `matched node identifier ${identifier}`,
        matchedBy: 'identifier',
        identifier,
        strong: true
      });
    });
  }
}

/**
 * Adds low-confidence visible-label candidates for manual planning only.
 * @param {object} options Candidate options.
 * @returns {void}
 */
function addVisibleLabelCandidates({ root, files, finding, candidates }) {
  const label = finding.evidence?.node?.label || finding.evidence?.node?.title;
  if (!label || String(label).length > 80) return;

  const escaped = escapeSwiftString(label);
  const patterns = [`"${escaped}"`, `Text("${escaped}")`, `Button("${escaped}"`];

  for (const file of files) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, index) => {
      if (!patterns.some((pattern) => line.includes(pattern))) return;
      candidates.push({
        file: displayPath(root, file),
        absolutePath: file,
        line: index + 1,
        confidence: 'low',
        reason: `matched visible label ${label}`,
        matchedBy: 'visibleLabel',
        strong: false
      });
    });
  }
}

/**
 * Removes duplicate candidates.
 * @param {object[]} candidates Source candidates.
 * @returns {object[]} Dedupe candidates.
 */
function dedupeCandidates(candidates) {
  const seen = new Set();
  const unique = [];
  for (const candidate of candidates) {
    const key = `${candidate.absolutePath}:${candidate.line}:${candidate.matchedBy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

/**
 * Escapes text for simple Swift string matching.
 * @param {string} value Raw value.
 * @returns {string} Escaped value.
 */
function escapeSwiftString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}
