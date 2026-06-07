import fs from 'node:fs';
import path from 'node:path';
import { createRunId } from './run-id.mjs';

/**
 * Creates a new evidence directory and writes the initial manifest.
 * @param {object} options Bundle options.
 * @param {string} [options.surface] Surface name.
 * @param {string} [options.driver] Runtime driver name.
 * @param {string} [options.root] Project root.
 * @returns {{runId:string, dir:string, manifestPath:string, manifest:object}}
 */
export function createEvidenceBundle(options = {}) {
  const root = options.root || process.cwd();
  const runId = createRunId(options.surface);
  const dir = path.join(root, 'artifacts', runId);
  fs.mkdirSync(dir, { recursive: true });

  const manifest = {
    runId,
    createdAt: new Date().toISOString(),
    surface: options.surface || null,
    runtime: {
      driver: options.driver || 'manual',
      deviceName: options.deviceName || null,
      udid: options.udid || null
    },
    environment: {
      appearance: 'unspecified'
    },
    artifacts: {
      screenshot: null,
      accessibilityTree: null,
      logs: null,
      summary: path.relative(root, path.join(dir, 'summary.md'))
    },
    sourceHints: []
  };

  const manifestPath = path.join(dir, 'evidence.json');
  writeEvidenceBundle({ root, dir, manifestPath, manifest });

  return { runId, dir, manifestPath, manifest };
}

/**
 * Persists a bundle manifest and its markdown summary.
 * @param {object} bundle Bundle metadata.
 * @param {string} bundle.root Project root.
 * @param {string} bundle.dir Evidence directory.
 * @param {string} bundle.manifestPath Evidence JSON path.
 * @param {object} bundle.manifest Evidence manifest object.
 * @returns {void}
 */
export function writeEvidenceBundle(bundle) {
  fs.writeFileSync(bundle.manifestPath, `${JSON.stringify(bundle.manifest, null, 2)}\n`);
  fs.writeFileSync(path.join(bundle.dir, 'summary.md'), renderSummary(bundle.manifest));
}

/**
 * Renders a markdown summary for humans and agents.
 * @param {object} manifest Evidence manifest.
 * @returns {string} Markdown summary.
 */
function renderSummary(manifest) {
  const artifacts = Object.entries(manifest.artifacts || {})
    .filter(([, value]) => value)
    .map(([key, value]) => `- ${key}: ${value}`)
    .join('\n') || '- none yet';
  const statuses = Array.isArray(manifest.capture?.steps)
    ? manifest.capture.steps.map(renderStepStatus).join('\n')
    : '- not started';

  return `# Screenslop Evidence

Run: ${manifest.runId}

Driver: ${manifest.runtime.driver}

Device: ${manifest.runtime.deviceName || 'unknown'}

Surface: ${manifest.surface || 'unknown'}

Status: ${manifest.capture?.status || 'scaffold'}

## Artifacts

${artifacts}

## Capture steps

${statuses}
`;
}

/**
 * Renders one capture step for the markdown summary.
 * @param {object} step Capture step status.
 * @returns {string} Markdown list item.
 */
function renderStepStatus(step) {
  const status = step.ok ? 'ok' : 'failed';
  const message = step.message ? ` — ${step.message}` : '';
  return `- ${step.name}: ${status}${message}`;
}
