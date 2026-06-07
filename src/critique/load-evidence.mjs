import fs from 'node:fs';
import path from 'node:path';

/**
 * Loads a Screenslop evidence bundle from disk.
 * @param {object} options Load options.
 * @param {string} options.root Project root.
 * @param {string} options.bundlePath Bundle directory or evidence.json path.
 * @returns {object} Loaded bundle context.
 */
export function loadEvidenceBundle(options) {
  const root = path.resolve(options.root || process.cwd());
  const requested = options.bundlePath || '';
  if (!requested) throw new Error('Missing evidence bundle path. Usage: screenslop critique artifacts/<bundle>');

  const absoluteInput = path.resolve(root, requested);
  const manifestPath = fs.existsSync(absoluteInput) && fs.statSync(absoluteInput).isDirectory()
    ? path.join(absoluteInput, 'evidence.json')
    : absoluteInput;
  const dir = path.dirname(manifestPath);

  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Evidence manifest not found: ${displayPath(root, manifestPath)}`);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const artifacts = manifest.artifacts || {};

  return {
    root,
    dir,
    bundle: displayPath(root, dir),
    manifestPath,
    manifestPathDisplay: displayPath(root, manifestPath),
    manifest,
    artifacts: {
      screenshot: resolveArtifact(root, dir, artifacts.screenshot),
      accessibilityTree: resolveArtifact(root, dir, artifacts.accessibilityTree),
      logs: resolveArtifact(root, dir, artifacts.logs),
      summary: resolveArtifact(root, dir, artifacts.summary)
    }
  };
}

/**
 * Resolves an artifact path from manifest conventions.
 *
 * Evidence manifests usually store root-relative paths like
 * `artifacts/<run>/accessibility.json`. A copied bundle should still critique
 * its local files, so bundle-local candidates win before repo-root candidates.
 * @param {string} root Project root.
 * @param {string} dir Bundle directory.
 * @param {string|null|undefined} value Manifest artifact value.
 * @returns {{manifestPath:string|null, absolutePath:string|null, displayPath:string|null, exists:boolean}}
 */
export function resolveArtifact(root, dir, value) {
  if (!value) return { manifestPath: null, absolutePath: null, displayPath: null, exists: false };

  const candidates = path.isAbsolute(value)
    ? [value]
    : uniquePaths([
      path.resolve(dir, value),
      path.resolve(dir, path.basename(value)),
      path.resolve(root, value)
    ]);

  const absolutePath = candidates.find((candidate) => fs.existsSync(candidate)) || candidates[0];
  return {
    manifestPath: value,
    absolutePath,
    displayPath: displayPath(root, absolutePath),
    exists: fs.existsSync(absolutePath)
  };
}

/**
 * Produces repo-relative paths for repo files and absolute paths otherwise.
 * @param {string} root Project root.
 * @param {string} absolutePath Absolute path.
 * @returns {string} Display path for JSON and reports.
 */
export function displayPath(root, absolutePath) {
  const relative = path.relative(root, absolutePath);
  if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) return relative;
  if (!relative) return '.';
  return absolutePath;
}

/**
 * Removes duplicate path candidates while preserving order.
 * @param {string[]} values Candidate paths.
 * @returns {string[]} Unique paths.
 */
function uniquePaths(values) {
  return [...new Set(values)];
}
