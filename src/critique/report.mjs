import fs from 'node:fs';
import path from 'node:path';
import { displayPath } from './load-evidence.mjs';

/**
 * Writes critique artifacts into an evidence bundle.
 * @param {object} context Evidence context.
 * @param {object[]} findings Sorted findings.
 * @param {object} summary Finding summary.
 * @param {object} [metadata] Optional machine-readable metadata for findings.json.
 * @returns {{findingsPath:string, reportPath:string}} Written artifact paths.
 */
export function writeCritiqueArtifacts(context, findings, summary, metadata = {}) {
  const findingsPath = path.join(context.dir, 'findings.json');
  const reportPath = path.join(context.dir, 'critique.md');
  fs.writeFileSync(findingsPath, `${JSON.stringify({ summary, findings, ...metadata }, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderCritiqueMarkdown(context, findings, summary));
  return {
    findingsPath: displayPath(context.root, findingsPath),
    reportPath: displayPath(context.root, reportPath)
  };
}

/**
 * Renders the human critique report.
 * @param {object} context Evidence context.
 * @param {object[]} findings Sorted findings.
 * @param {object} summary Finding summary.
 * @returns {string} Markdown report.
 */
export function renderCritiqueMarkdown(context, findings, summary) {
  const sections = ['P0', 'P1', 'P2', 'P3']
    .map((level) => renderSeveritySection(level, findings.filter((finding) => finding.severity === level)))
    .filter(Boolean)
    .join('\n');

  const empty = findings.length === 0
    ? '\nNo deterministic critique findings from the current evidence. This does not prove typography, contrast, color, or motion quality yet; those need richer evidence.\n'
    : '';

  return `# Screenslop Critique\n\nRun: ${context.manifest.runId || 'unknown'}\n\nSurface: ${context.manifest.surface || 'unknown'}\n\nBundle: ${context.bundle}\n\nTotal findings: ${summary.total}\n\n## Evidence\n\n- screenshot: ${context.artifacts.screenshot.displayPath || 'missing'}\n- accessibilityTree: ${context.artifacts.accessibilityTree.displayPath || 'missing'}\n- logs: ${context.artifacts.logs.displayPath || 'missing'}\n\n${empty}${sections}\n`;
}

/**
 * Renders one severity section.
 * @param {string} severity Severity label.
 * @param {object[]} findings Findings for the severity.
 * @returns {string} Markdown section.
 */
function renderSeveritySection(severity, findings) {
  if (findings.length === 0) return '';
  const body = findings.map(renderFinding).join('\n');
  return `## ${severity}\n\n${body}`;
}

/**
 * Renders one finding as Markdown.
 * @param {object} finding Critique finding.
 * @returns {string} Markdown block.
 */
function renderFinding(finding) {
  return `### ${finding.title}\n\n- id: ${finding.id}\n- pillar: ${finding.pillar}\n- confidence: ${finding.confidence || 'medium'}\n- detail: ${finding.detail || 'No detail provided.'}\n- evidence: ${formatEvidence(finding.evidence)}\n- fix: ${finding.suggestedFix || 'No suggested fix provided.'}\n- verify: ${finding.verification || 'Recapture and compare evidence.'}\n`;
}

/**
 * Formats compact evidence for a report line.
 * @param {object} evidence Evidence object.
 * @returns {string} Evidence text.
 */
function formatEvidence(evidence = {}) {
  const parts = [];
  if (evidence.artifact) parts.push(`artifact=${evidence.artifact}`);
  if (evidence.line) parts.push(`line=${evidence.line}`);
  if (evidence.node?.path) parts.push(`node=${evidence.node.path}`);
  if (evidence.node?.role) parts.push(`role=${evidence.node.role}`);
  if (evidence.node?.frame) parts.push(`frame=${JSON.stringify(evidence.node.frame)}`);
  if (evidence.snippet) parts.push(`snippet=${JSON.stringify(evidence.snippet)}`);
  if (evidence.note) parts.push(`note=${JSON.stringify(evidence.note)}`);
  return parts.length ? parts.join('; ') : 'evidence object present';
}
