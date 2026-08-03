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

  // A mid-animation frame produces a manifest indistinguishable from a clean
  // one, and every rule downstream inherits it: wrong frames for layout math,
  // half-faded colors for contrast. Say so before any of them run.
  const stability = context.manifest.capture?.stability;
  if (stability?.status === 'unstable') {
    const percent = Number.isFinite(stability.changedRatio)
      ? `${(stability.changedRatio * 100).toFixed(1)}% of sampled pixels`
      : 'a large share of the screen';
    findings.push(createFinding({
      ruleId: 'evidence.unstable-capture',
      severity: 'P1',
      pillar: 'platform',
      title: 'Screen was still moving when captured',
      detail: `Two captures ${stability.delayMs ?? 0}ms apart differ across ${percent}, so this bundle likely caught an animation or transition mid-flight. Layout frames and sampled colors from a moving screen describe a frame no user ever sees.`,
      evidence: {
        artifact: context.manifestPathDisplay,
        note: `capture.stability.status=unstable`
      },
      suggestedFix: 'Let the screen settle before capturing — wait for transitions and loading states to finish, then rerun `screenslop see`.',
      verification: 'Recapture and confirm `capture.stability.status` is stable.',
      confidence: 'high',
      effort: 'low',
      fingerprint: 'unstable-capture'
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
