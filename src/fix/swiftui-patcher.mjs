import fs from 'node:fs';

const autoRules = new Set(['ax.missing-name', 'ax.generic-name', 'layout.touch-target']);

/**
 * Builds a deterministic SwiftUI patch for one finding and one source candidate.
 * @param {object} options Patch options.
 * @param {object} options.finding Critique finding.
 * @param {object} options.candidate Strong source candidate.
 * @param {string|null} [options.label] Accessibility label to apply.
 * @returns {object} Patch result.
 */
export function buildSwiftUIPatch(options) {
  const finding = options.finding;
  const candidate = options.candidate;

  if (!autoRules.has(finding.ruleId)) {
    return unsupportedPatch(finding, candidate, `${finding.ruleId} is not auto-fixable in the MVP.`);
  }

  if (finding.ruleId === 'layout.touch-target') return buildTouchTargetPatch(candidate);
  return buildAccessibilityLabelPatch({ finding, candidate, label: options.label || null });
}

/**
 * Applies a generated line patch to disk.
 * @param {object} patch Patch from buildSwiftUIPatch.
 * @returns {object} Applied patch result.
 */
export function applySwiftUIPatch(patch) {
  if (!patch.canApply) return { applied: false, reason: patch.reason };
  const current = fs.readFileSync(patch.absolutePath, 'utf8');
  if (current !== patch.before) {
    return { applied: false, reason: 'Source changed after patch preview was created.' };
  }
  fs.writeFileSync(patch.absolutePath, patch.after);
  return { applied: true, reason: 'Patch applied.' };
}

/**
 * Builds an accessibility label insertion or replacement patch.
 * @param {object} options Patch options.
 * @returns {object} Patch result.
 */
function buildAccessibilityLabelPatch({ finding, candidate, label }) {
  if (!label || !label.trim()) {
    return unsupportedPatch(finding, candidate, 'Accessibility label fixes require --label in non-interactive mode.');
  }

  const before = fs.readFileSync(candidate.absolutePath, 'utf8');
  const lines = before.split('\n');
  const start = Math.max(0, candidate.line - 1);
  if (!lines[start]) return unsupportedPatch(finding, candidate, 'Source hint line is outside the file.');
  const window = modifierWindow(lines, start);
  const modifier = `${leadingWhitespace(lines[start])}.accessibilityLabel("${escapeSwiftString(label.trim())}")`;

  for (let index = window.start; index <= window.end; index += 1) {
    const line = lines[index];
    if (!line.includes('.accessibilityLabel(')) continue;
    if (line.trim() === modifier.trim()) {
      return skippedPatch(finding, candidate, before, 'Matching accessibility label already exists.');
    }
    lines[index] = modifier;
    return patchFromLines(finding, candidate, before, lines, `Replace accessibility label with “${label.trim()}”.`);
  }

  lines.splice(start + 1, 0, modifier);
  return patchFromLines(finding, candidate, before, lines, `Add accessibility label “${label.trim()}”.`);
}

/**
 * Builds a minimum touch-target frame insertion patch.
 * @param {object} candidate Source candidate.
 * @returns {object} Patch result.
 */
function buildTouchTargetPatch(candidate) {
  const finding = { ruleId: 'layout.touch-target' };
  const before = fs.readFileSync(candidate.absolutePath, 'utf8');
  const lines = before.split('\n');
  const start = Math.max(0, candidate.line - 1);
  if (!lines[start]) return unsupportedPatch(finding, candidate, 'Source hint line is outside the file.');
  const windowStart = Math.max(0, start - 3);
  const windowEnd = Math.min(lines.length - 1, start + 8);
  const nearby = lines.slice(windowStart, windowEnd + 1).join('\n');

  if (/\.frame\([^\n)]*minWidth:\s*44[^\n)]*minHeight:\s*44/.test(nearby)) {
    return skippedPatch(finding, candidate, before, 'Minimum 44x44 frame already exists near the matched view.');
  }

  if (/\.frame\(/.test(nearby)) {
    return unsupportedPatch(finding, candidate, 'A frame modifier already exists nearby; manual review is safer for the MVP.');
  }

  const modifier = `${leadingWhitespace(lines[start])}.frame(minWidth: 44, minHeight: 44)`;
  lines.splice(start + 1, 0, modifier);
  return patchFromLines(finding, candidate, before, lines, 'Add minimum 44x44 touch target frame.');
}

/**
 * Creates a standard patch object from modified lines.
 * @param {object} finding Critique finding.
 * @param {object} candidate Source candidate.
 * @param {string} before Original content.
 * @param {string[]} lines Modified lines.
 * @param {string} reason Patch reason.
 * @returns {object} Patch object.
 */
function patchFromLines(finding, candidate, before, lines, reason) {
  const after = lines.join('\n');
  return {
    ruleId: finding.ruleId,
    file: candidate.file,
    absolutePath: candidate.absolutePath,
    line: candidate.line,
    canApply: before !== after,
    changed: before !== after,
    reason,
    before,
    after,
    preview: buildPreview(before, after)
  };
}

/**
 * Creates an unsupported patch object.
 * @param {object} finding Critique finding.
 * @param {object|null} candidate Candidate.
 * @param {string} reason Reason.
 * @returns {object} Patch object.
 */
function unsupportedPatch(finding, candidate, reason) {
  return {
    ruleId: finding.ruleId,
    file: candidate?.file || null,
    absolutePath: candidate?.absolutePath || null,
    line: candidate?.line || null,
    canApply: false,
    changed: false,
    reason,
    before: null,
    after: null,
    preview: null
  };
}

/**
 * Creates a skipped patch for already-satisfied simple modifiers.
 * @param {object} finding Critique finding.
 * @param {object} candidate Candidate.
 * @param {string} before Source content.
 * @param {string} reason Reason.
 * @returns {object} Patch object.
 */
function skippedPatch(finding, candidate, before, reason) {
  return {
    ruleId: finding.ruleId,
    file: candidate.file,
    absolutePath: candidate.absolutePath,
    line: candidate.line,
    canApply: false,
    changed: false,
    reason,
    before,
    after: before,
    preview: null,
    alreadySatisfied: true
  };
}

/**
 * Finds nearby SwiftUI modifier lines that belong to the matched view chain.
 * @param {string[]} lines Source lines.
 * @param {number} matchedIndex Matched identifier/source line index.
 * @returns {{start:number,end:number}} Modifier window.
 */
function modifierWindow(lines, matchedIndex) {
  let start = matchedIndex;
  let end = matchedIndex;

  while (start > 0 && isModifierLine(lines[start - 1])) start -= 1;
  while (end + 1 < lines.length && isModifierLine(lines[end + 1])) end += 1;

  return { start, end };
}

/**
 * Checks whether a line is part of a SwiftUI modifier chain.
 * @param {string} line Source line.
 * @returns {boolean} True for `.modifier(...)` lines.
 */
function isModifierLine(line) {
  return line.trimStart().startsWith('.');
}

/**
 * Returns leading whitespace from a line.
 * @param {string} line Source line.
 * @returns {string} Whitespace prefix.
 */
function leadingWhitespace(line) {
  return line.match(/^\s*/)?.[0] || '';
}

/**
 * Escapes text for Swift string insertion.
 * @param {string} value Raw value.
 * @returns {string} Escaped Swift text.
 */
function escapeSwiftString(value) {
  return String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
}

/**
 * Builds a compact before/after preview for reports.
 * @param {string} before Original content.
 * @param {string} after Modified content.
 * @returns {string} Patch preview.
 */
function buildPreview(before, after) {
  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const output = [];
  const max = Math.max(beforeLines.length, afterLines.length);

  for (let index = 0; index < max; index += 1) {
    if (beforeLines[index] === afterLines[index]) continue;
    if (beforeLines[index] !== undefined) output.push(`- ${beforeLines[index]}`);
    if (afterLines[index] !== undefined) output.push(`+ ${afterLines[index]}`);
    if (output.length >= 12) break;
  }

  return output.join('\n');
}
