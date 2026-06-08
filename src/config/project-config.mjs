import fs from 'node:fs';
import path from 'node:path';

export const CONFIG_SCHEMA_VERSION = 1;
export const DEFAULT_RUNTIME_PREFERENCE = ['baguette', 'xcodebuildmcp', 'simctl', 'manual'];

/**
 * Builds the default Screenslop config payload.
 * @param {object} options Config options.
 * @param {object} [options.detected] Runtime detection result.
 * @param {Record<string,string>} [options.values] CLI-provided config values.
 * @returns {object} Versioned config payload.
 */
export function createDefaultConfig(options = {}) {
  const detected = options.detected || { preferred: 'manual' };
  const values = options.values || {};

  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    runtimePreference: [...DEFAULT_RUNTIME_PREFERENCE],
    preferredRuntime: values.runtime || detected.preferred || 'manual',
    defaultSurface: values.surface || null,
    defaultScheme: values.scheme || null,
    defaultBundleId: values['bundle-id'] || null,
    defaultDevice: values.device || null,
    workspacePath: values.workspace || null,
    projectPath: values.project || null,
    sourceRoot: values['source-root'] || null,
    artifactsDir: values['artifacts-dir'] || 'artifacts',
    sourceHints: parseList(values['source-hint'])
  };
}

/**
 * Reads a project config when present.
 * @param {string} root Project root.
 * @returns {{exists:boolean,file:string,config:object|null,error:string|null}}
 */
export function readProjectConfig(root = process.cwd()) {
  const file = configPath(root);
  if (!fs.existsSync(file)) return { exists: false, file, config: null, error: null };
  const safety = checkConfigFileSafety(root);
  if (!safety.ok) return { exists: true, file, config: null, error: safety.error };

  try {
    return { exists: true, file, config: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, file, config: null, error: `Invalid JSON in .screenslop/config.json: ${error.message}` };
  }
}

/**
 * Plans config creation or migration without writing files.
 * @param {object} options Init options.
 * @param {string} [options.root] Project root.
 * @param {object} [options.detected] Runtime detection result.
 * @param {Record<string,string>} [options.values] CLI-provided config values.
 * @returns {object} Init plan with config payload and validation state.
 */
export function planInitConfig(options = {}) {
  const root = options.root || process.cwd();
  const read = readProjectConfig(root);
  if (read.error) return failure('invalid-config', read.error, { file: read.file });

  const defaults = createDefaultConfig({ detected: options.detected, values: options.values });

  if (!read.exists) {
    const validation = validateProjectConfig(defaults, { root });
    if (!validation.ok) return failure('invalid-new-config', validation.errors.join('; '), { file: read.file, config: defaults, validation });
    return {
      ok: true,
      action: 'create',
      file: read.file,
      config: defaults,
      validation,
      migration: null
    };
  }

  const migration = migrateProjectConfig(read.config, { defaults });
  const validation = validateProjectConfig(migration.config, { root });
  if (!validation.ok) {
    return failure('unsafe-migration', validation.errors.join('; '), {
      file: read.file,
      existing: read.config,
      config: migration.config,
      migration,
      validation
    });
  }

  return {
    ok: true,
    action: migration.changed ? 'migrate' : 'exists',
    file: read.file,
    existing: read.config,
    config: migration.config,
    validation,
    migration
  };
}

/**
 * Migrates old config fields into the schemaVersion: 1 shape.
 * @param {object|null} existing Existing config payload.
 * @param {object} options Migration options.
 * @param {object} options.defaults Default config payload.
 * @returns {{changed:boolean,fromVersion:number|null,toVersion:number,notes:string[],config:object}}
 */
export function migrateProjectConfig(existing, options) {
  const input = existing && typeof existing === 'object' && !Array.isArray(existing) ? existing : {};
  const config = { ...options.defaults };
  const notes = [];

  copyIfPresent(input, config, 'runtimePreference');
  copyIfPresent(input, config, 'preferredRuntime');
  copyIfPresent(input, config, 'defaultSurface');
  copyIfPresent(input, config, 'defaultScheme');
  copyIfPresent(input, config, 'defaultBundleId');
  copyIfPresent(input, config, 'defaultDevice');
  copyIfPresent(input, config, 'workspacePath');
  copyIfPresent(input, config, 'projectPath');
  copyIfPresent(input, config, 'sourceRoot');
  copyIfPresent(input, config, 'artifactsDir');

  if (Array.isArray(input.sourceHints)) config.sourceHints = input.sourceHints;
  else if (typeof input.sourceHints === 'string') config.sourceHints = parseList(input.sourceHints);

  if (input.schemaVersion !== CONFIG_SCHEMA_VERSION) notes.push(`schemaVersion set to ${CONFIG_SCHEMA_VERSION}`);
  config.schemaVersion = CONFIG_SCHEMA_VERSION;

  const knownKeys = new Set(Object.keys(config));
  for (const [key, value] of Object.entries(input)) {
    if (!knownKeys.has(key)) config[key] = value;
  }

  return {
    changed: stableJson(input) !== stableJson(config),
    fromVersion: Number.isInteger(input.schemaVersion) ? input.schemaVersion : null,
    toVersion: CONFIG_SCHEMA_VERSION,
    notes,
    config
  };
}

/**
 * Validates a Screenslop config payload.
 * @param {object|null} config Config payload.
 * @param {object} [options] Validation options.
 * @param {string} [options.root] Project root for path containment checks.
 * @returns {{ok:boolean,errors:string[]}}
 */
export function validateProjectConfig(config, options = {}) {
  const errors = [];
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return { ok: false, errors: ['Config must be a JSON object.'] };
  }

  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) errors.push(`schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`);
  if (!Array.isArray(config.runtimePreference) || config.runtimePreference.length === 0) errors.push('runtimePreference must be a non-empty array.');
  if (typeof config.artifactsDir !== 'string' || config.artifactsDir.trim() === '') errors.push('artifactsDir must be a non-empty string.');
  if (!Array.isArray(config.sourceHints)) errors.push('sourceHints must be an array.');

  for (const key of ['preferredRuntime', 'defaultSurface', 'defaultScheme', 'defaultBundleId', 'defaultDevice', 'workspacePath', 'projectPath', 'sourceRoot']) {
    const value = config[key];
    if (value !== null && value !== undefined && typeof value !== 'string') errors.push(`${key} must be a string or null.`);
  }

  for (const key of ['artifactsDir', 'sourceRoot']) {
    const value = config[key];
    if (!value) continue;
    if (isUnsafePath(value)) errors.push(`${key} must not contain NUL bytes.`);
  }

  const root = options.root ? canonicalizeExistingPath(path.resolve(options.root)) : null;
  if (root && config.sourceRoot) {
    const resolved = resolveConfiguredPath(root, config.sourceRoot);
    if (!isPathInside(root, resolved)) errors.push('sourceRoot must resolve inside the project root.');
    if (isBlockedPath(root, resolved)) errors.push('sourceRoot must not point at blocked folders such as .git, .omx, node_modules, build, DerivedData, or artifacts.');
  }

  if (root && config.artifactsDir) {
    const resolved = resolveConfiguredPath(root, config.artifactsDir);
    if (!isPathInside(root, resolved)) errors.push('artifactsDir must resolve inside the project root for v0.1.');
    if (isBlockedArtifactPath(root, resolved)) errors.push('artifactsDir must not point at .git, .omx, node_modules, build, DerivedData, or the repository root.');
  }

  if (root && config.sourceRoot && config.artifactsDir) {
    const sourceRoot = resolveConfiguredPath(root, config.sourceRoot);
    const artifactsDir = resolveConfiguredPath(root, config.artifactsDir);
    if (pathsOverlap(sourceRoot, artifactsDir)) errors.push('sourceRoot and artifactsDir must not overlap.');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Writes a config payload to `.screenslop/config.json`.
 * @param {string} root Project root.
 * @param {object} config Config payload.
 * @returns {string} Written config path.
 */
export function writeProjectConfig(root, config) {
  const dir = path.join(root, '.screenslop');
  const file = configPath(root);
  const safety = checkConfigFileSafety(root);
  if (!safety.ok) throw new Error(safety.error);

  fs.mkdirSync(dir, { recursive: true });
  const afterMkdirSafety = checkConfigFileSafety(root);
  if (!afterMkdirSafety.ok) throw new Error(afterMkdirSafety.error);

  const tempFile = path.join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempFile, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempFile, file);
  return file;
}

/**
 * Resolves the target app fields used by runtime commands.
 * @param {object} config Config payload.
 * @param {object} [options] Resolution options.
 * @param {string} [options.root] Project root.
 * @returns {object} Runtime target values with absolute write-sensitive paths.
 */
export function resolveTargetConfig(config, options = {}) {
  const root = canonicalizeExistingPath(path.resolve(options.root || process.cwd()));
  const validation = validateProjectConfig(config, { root });
  if (!validation.ok) {
    const error = new Error(validation.errors.join('; '));
    error.code = 'INVALID_SCREENSlOP_CONFIG';
    throw error;
  }

  return {
    workspacePath: resolveOptionalPath(root, config.workspacePath),
    projectPath: resolveOptionalPath(root, config.projectPath),
    scheme: config.defaultScheme || null,
    bundleId: config.defaultBundleId || null,
    sourceRoot: config.sourceRoot ? resolveConfiguredPath(root, config.sourceRoot) : null,
    device: config.defaultDevice || null,
    artifactsDir: resolveConfiguredPath(root, config.artifactsDir || 'artifacts'),
    preferredRuntime: config.preferredRuntime || 'manual',
    runtimePreference: config.runtimePreference || DEFAULT_RUNTIME_PREFERENCE
  };
}

/**
 * Returns the config path below a project root.
 * @param {string} root Project root.
 * @returns {string} Config path.
 */
export function configPath(root = process.cwd()) {
  return path.join(root, '.screenslop', 'config.json');
}

/**
 * Copies a property when it exists on an object.
 * @param {object} source Source object.
 * @param {object} target Target object.
 * @param {string} key Property key.
 * @returns {void}
 */
function copyIfPresent(source, target, key) {
  if (Object.prototype.hasOwnProperty.call(source, key)) target[key] = source[key];
}

/**
 * Parses comma-separated config list input.
 * @param {string|undefined|null} value Raw list input.
 * @returns {string[]} Parsed items.
 */
function parseList(value) {
  if (!value) return [];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

/**
 * Builds a failed init plan.
 * @param {string} action Failure action.
 * @param {string} error Error message.
 * @param {object} extra Extra payload.
 * @returns {object} Failed plan.
 */
function failure(action, error, extra = {}) {
  return { ok: false, action, error, ...extra };
}

/**
 * Checks path strings for invalid bytes.
 * @param {string} value Path value.
 * @returns {boolean} True when unsafe.
 */
function isUnsafePath(value) {
  return value.includes('\0');
}

/**
 * Resolves a user path under the project root unless it is already absolute.
 * @param {string} root Project root.
 * @param {string} value Path value.
 * @returns {string} Resolved path.
 */
function resolveInside(root, value) {
  return path.resolve(root, value);
}

/**
 * Resolves a configured path and canonicalizes existing symlinks.
 * @param {string} root Canonical project root.
 * @param {string} value Configured path value.
 * @returns {string} Canonical candidate path.
 */
function resolveConfiguredPath(root, value) {
  return canonicalizeExistingPath(resolveInside(root, value));
}

/**
 * Resolves optional workspace/project paths without containment rules.
 * @param {string} root Project root.
 * @param {string|null} value Optional path.
 * @returns {string|null} Resolved path or null.
 */
function resolveOptionalPath(root, value) {
  if (!value) return null;
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(root, value);
}

/**
 * Checks whether a resolved path stays inside the project root.
 * @param {string} root Project root.
 * @param {string} candidate Candidate path.
 * @returns {boolean} True when candidate is inside root.
 */
function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

/**
 * Blocks config writes through symlinked config locations.
 * @param {string} root Project root.
 * @returns {{ok:boolean,error:string|null}} Safety result.
 */
function checkConfigFileSafety(root) {
  const dir = path.join(root, '.screenslop');
  const file = path.join(dir, 'config.json');
  try {
    const dirStat = safeLstat(dir);
    if (dirStat?.isSymbolicLink()) return { ok: false, error: '.screenslop must not be a symlink.' };

    const fileStat = safeLstat(file);
    if (fileStat?.isSymbolicLink()) return { ok: false, error: '.screenslop/config.json must not be a symlink.' };
  } catch (error) {
    return { ok: false, error: `Could not inspect .screenslop/config.json safety: ${error.message}` };
  }
  return { ok: true, error: null };
}

/**
 * Checks blocked source-root folders.
 * @param {string} root Project root.
 * @param {string} candidate Resolved source root.
 * @returns {boolean} True when blocked.
 */
function isBlockedPath(root, candidate) {
  if (candidate === root) return false;
  return blockedRelativePath(root, candidate);
}

/**
 * Checks blocked artifact folders.
 * @param {string} root Project root.
 * @param {string} candidate Resolved artifact root.
 * @returns {boolean} True when blocked.
 */
function isBlockedArtifactPath(root, candidate) {
  if (candidate === root) return true;
  const parts = path.relative(root, candidate).split(path.sep).filter(Boolean);
  const blocked = new Set(['.git', '.omx', 'node_modules', 'DerivedData', 'build']);
  return parts.some((part) => blocked.has(part));
}

/**
 * Detects blocked repo-local folders.
 * @param {string} root Project root.
 * @param {string} candidate Resolved candidate path.
 * @returns {boolean} True when candidate enters a blocked folder.
 */
function blockedRelativePath(root, candidate) {
  const parts = path.relative(root, candidate).split(path.sep).filter(Boolean);
  const blocked = new Set(['.git', '.omx', 'node_modules', 'DerivedData', 'build', 'artifacts']);
  return parts.some((part) => blocked.has(part));
}

/**
 * Checks whether either path contains the other.
 * @param {string} left First path.
 * @param {string} right Second path.
 * @returns {boolean} True when paths overlap.
 */
function pathsOverlap(left, right) {
  return isPathInside(left, right) || isPathInside(right, left);
}

/**
 * Serializes values with sorted object keys for semantic comparisons.
 * @param {unknown} value Value to serialize.
 * @returns {string} Stable JSON string.
 */
function stableJson(value) {
  return JSON.stringify(sortKeys(value));
}

/**
 * Recursively sorts object keys.
 * @param {unknown} value Value to normalize.
 * @returns {unknown} Normalized value.
 */
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]));
}

/**
 * Canonicalizes an existing path, or its nearest existing parent.
 * @param {string} candidate Candidate path.
 * @returns {string} Canonicalized path.
 */
function canonicalizeExistingPath(candidate) {
  const missingParts = [];
  let current = path.resolve(candidate);

  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    missingParts.unshift(path.basename(current));
    current = parent;
  }

  const base = fs.existsSync(current) ? fs.realpathSync.native(current) : path.resolve(current);
  return path.join(base, ...missingParts);
}

/**
 * Runs lstat and returns null only when the path is absent.
 * @param {string} file Path to inspect.
 * @returns {fs.Stats|null} File stats or null.
 */
function safeLstat(file) {
  try {
    return fs.lstatSync(file);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}
