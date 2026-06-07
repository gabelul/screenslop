import { createFinding } from '../findings.mjs';

const weakCaptureStatuses = new Set(['dry-run', 'failed', 'partial', 'unavailable', 'scaffold']);

/**
 * Finds missing or weak evidence before deeper critique rules run.
 * @param {object} context Loaded evidence context.
 * @returns {object[]} Evidence-quality findings.
 */
export function detectEvidenceQuality(context) {
  const findings = [];
  const status = context.manifest.capture?.status || 'scaffold';

  if (weakCaptureStatuses.has(status)) {
    findings.push(createFinding({
      ruleId: 'evidence.capture-status',
      severity: status === 'partial' ? 'P2' : 'P1',
      pillar: 'platform',
      title: `Evidence capture is ${status}`,
      detail: `This bundle is marked ${status}, so critique coverage is limited. Screenslop should not pretend this is a complete runtime capture.`,
      evidence: {
        artifact: context.manifestPathDisplay,
        note: `capture.status=${status}`
      },
      suggestedFix: 'Recapture the screen with `screenslop see` until capture.status is complete.',
      verification: 'Run `screenslop see --json --surface <name>` and confirm capture.status is complete.',
      confidence: 'high',
      effort: 'low',
      fingerprint: `capture-status:${status}`
    }));
  }

  if (!context.artifacts.screenshot.exists) {
    findings.push(createFinding({
      ruleId: 'evidence.missing-screenshot',
      severity: context.artifacts.accessibilityTree.exists ? 'P2' : 'P1',
      pillar: 'platform',
      title: 'Screenshot evidence is missing',
      detail: 'The bundle has no readable screenshot, so visual claims and screenshot regions cannot be verified.',
      evidence: {
        artifact: context.artifacts.screenshot.displayPath || context.artifacts.screenshot.manifestPath || null,
        note: 'Missing screenshot artifact.'
      },
      suggestedFix: 'Recapture with a runtime that can write `screenshot.jpg`.',
      verification: 'Confirm `evidence.json.artifacts.screenshot` points to an existing file.',
      confidence: 'high',
      effort: 'low',
      fingerprint: 'missing-screenshot'
    }));
  }

  if (!context.artifacts.accessibilityTree.exists) {
    findings.push(createFinding({
      ruleId: 'evidence.missing-ax-tree',
      severity: 'P1',
      pillar: 'accessibility',
      title: 'Accessibility tree evidence is missing',
      detail: 'The bundle has no readable AX tree, so Screenslop cannot verify labels, roles, hit targets, or layout frames.',
      evidence: {
        artifact: context.artifacts.accessibilityTree.displayPath || context.artifacts.accessibilityTree.manifestPath || null,
        note: 'Missing accessibility tree artifact.'
      },
      suggestedFix: 'Recapture with Baguette `describe-ui` support or another runtime that can export AX JSON.',
      verification: 'Confirm `evidence.json.artifacts.accessibilityTree` points to an existing file.',
      confidence: 'high',
      effort: 'low',
      fingerprint: 'missing-ax-tree'
    }));
  }

  const requestedLogs = Array.isArray(context.manifest.capture?.steps)
    && context.manifest.capture.steps.some((step) => step.name === 'logs');
  if (requestedLogs && !context.artifacts.logs.exists) {
    findings.push(createFinding({
      ruleId: 'evidence.missing-logs',
      severity: 'P3',
      pillar: 'performance',
      title: 'Requested logs are missing',
      detail: 'The capture steps mention logs, but no readable log artifact exists.',
      evidence: {
        artifact: context.artifacts.logs.displayPath || context.artifacts.logs.manifestPath || null,
        note: 'Missing logs artifact.'
      },
      suggestedFix: 'Recapture with `--logs` and a short `--log-duration` sample.',
      verification: 'Confirm `logs.ndjson` exists in the evidence bundle.',
      confidence: 'high',
      effort: 'low',
      fingerprint: 'missing-logs'
    }));
  }

  return findings;
}
