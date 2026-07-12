import { accessibleName, isVisibleEnabled, nodeEvidence } from '../ax-tree.mjs';
import { createFinding } from '../findings.mjs';

// This whole detector is a heuristic estimate. An AX dump has no glyph metrics,
// so we approximate SwiftUI body text: average character width ≈ 42% of line
// height. The clamp keeps tiny captions and oversized titles from skewing it.
const charWidthPerHeightRatio = 0.42;
const lineHeightFloor = 14;
const lineHeightCap = 34;
// Buttons carry vertical padding, so frame height overstates the font there.
// Cap the per-character estimate at SF Pro body scale (~17pt ≈ 8.5pt average)
// so a 32pt-tall padded button is not treated as 32pt text.
const maxCharWidth = 8.5;
// Frames taller than one clamped line are assumed multi-line (wrapping text);
// the single-line width model does not apply there, so they are skipped.
const maxSingleLineHeight = 34;
// Frames narrower than this are icons and chevrons, not text containers.
const minTextFrameWidth = 20;
// 15% slack absorbs estimate error before we flag anything.
const overflowMargin = 1.15;
// Worst offenders only; a screen of tight labels is one problem, not fifty.
const maxFindingsPerScreen = 5;
const maxNameCharsInDetail = 40;

const textBearingRolePattern = /text|static|label|button/i;

/**
 * Estimates truncation risk for single-line text nodes from AX frames.
 * Confidence is low by design: we guess rendered width from character count
 * and frame height, we do not measure real glyphs. A literal "…" in the
 * accessible name is a direct signal and gets flagged at medium confidence.
 * @param {object} context Critique context.
 * @param {object[]} nodes Flattened AX nodes.
 * @returns {object[]} Truncation-risk findings, worst overflow ratios first.
 */
export function detectTruncationIssues(context, nodes) {
  const candidates = [];

  for (const node of nodes) {
    if (!isVisibleEnabled(node) || !node.frame) continue;
    if (!textBearingRolePattern.test(String(node.role || ''))) continue;

    const name = accessibleName(node);
    if (!name) continue;
    // OS chrome text (back button, return-to-app banner) is not ours to fix.
    if (/^back$/i.test(name) || /^return to\s+/i.test(name)) continue;

    const width = Number(node.frame.width);
    const height = Number(node.frame.height);
    if (!Number.isFinite(width) || !Number.isFinite(height)) continue;
    if (width < minTextFrameWidth || height > maxSingleLineHeight) continue;

    const estimatedWidth = estimateTextWidth(name, height);
    const ratio = estimatedWidth / width;
    const hasEllipsis = name.includes('…');
    if (!hasEllipsis && !(estimatedWidth > width * overflowMargin)) continue;

    candidates.push({ node, name, width, estimatedWidth, ratio, hasEllipsis });
  }

  candidates.sort((left, right) => right.ratio - left.ratio);
  return candidates.slice(0, maxFindingsPerScreen).map((candidate) => truncationFinding(context, candidate));
}

/**
 * Builds the truncation-risk finding for one flagged candidate.
 * @param {object} context Critique context.
 * @param {object} candidate Flagged candidate with estimate data.
 * @returns {object} Truncation finding.
 */
function truncationFinding(context, candidate) {
  const { node, name, width, estimatedWidth, ratio, hasEllipsis } = candidate;
  const shortName = name.length > maxNameCharsInDetail ? `${name.slice(0, maxNameCharsInDetail)}…` : name;
  const signal = hasEllipsis
    ? 'The accessible name already contains "…", so the text is likely truncated on screen.'
    : `Estimated single-line width is ~${round(estimatedWidth)}pt inside a ${round(width)}pt frame (heuristic character-count estimate, not measured glyphs).`;

  return createFinding({
    ruleId: 'typography.truncation-risk',
    severity: 'P3',
    pillar: 'typography',
    title: 'Text may not fit its frame',
    detail: `"${shortName}" — ${signal} German and French strings run 30-40% longer than English, so even a snug English fit is already an overflow risk.`,
    evidence: {
      artifact: context.artifacts.accessibilityTree.displayPath || null,
      node: nodeEvidence(node),
      screenshotRegion: node.frame
    },
    suggestedFix: 'Give the label room to breathe: widen the container, allow wrapping (`lineLimit(nil)`), scale the text (`minimumScaleFactor`), or shorten the copy — and budget for 30-40% longer localized strings.',
    verification: 'Recapture with a long pseudo-localized string and confirm the label renders without an ellipsis, or confirm the truncation is intentional.',
    confidence: hasEllipsis ? 'medium' : 'low',
    effort: 'low',
    fingerprint: `truncation-risk:${node.path}:${round(ratio)}`
  });
}

/**
 * Estimates rendered single-line text width from character count and frame height.
 * @param {string} name Accessible name text.
 * @param {number} height Frame height in points.
 * @returns {number} Estimated width in points.
 */
function estimateTextWidth(name, height) {
  const lineHeight = Math.min(lineHeightCap, Math.max(lineHeightFloor, height));
  const charWidth = Math.min(lineHeight * charWidthPerHeightRatio, maxCharWidth);
  return name.length * charWidth;
}

/**
 * Rounds numeric output for reports and fingerprints.
 * @param {number|string} value Number-like value.
 * @returns {number|string} Value rounded to two decimals.
 */
function round(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : value;
}
