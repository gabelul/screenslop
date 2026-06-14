import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readProjectConfig, resolveTargetConfig } from '../config/project-config.mjs';
import { DEFAULT_DESIGN_PROFILE_PATH, DESIGN_PROFILE_SCHEMA_VERSION } from './index.mjs';

const SCANNED_EXTENSIONS = new Set(['.swift', '.md', '.json', '.yml', '.yaml']);
const BLOCKED_DIRS = new Set(['.git', '.omx', '.screenslop', 'artifacts', 'build', 'DerivedData', 'node_modules']);
const MAX_SOURCE_FILES = 80;

/**
 * Plans, checks, refreshes, and writes the project-local design profile.
 *
 * @param {object} options Learn options.
 * @param {string} options.root Project root.
 * @param {string|null} [options.profilePath] Optional profile path override.
 * @param {boolean} [options.check] Whether to check the existing profile.
 * @param {boolean} [options.refresh] Whether to refresh from an existing profile.
 * @param {boolean} [options.write] Whether a write was requested.
 * @param {boolean} [options.dryRun] Whether writes are disabled.
 * @param {boolean} [options.yes] Whether writes are confirmed.
 * @param {string|null} [options.surface] Optional surface name.
 * @param {boolean} [options.confirmed] Whether an interactive confirmation approved writing.
 * @returns {object} Agent-facing learn result.
 */
export function collectDesignProfile(options) {
  const root = canonicalRoot(options.root || process.cwd());
  const profilePath = resolveDesignProfilePath(root, options.profilePath || DEFAULT_DESIGN_PROFILE_PATH);
  const current = collectProjectDesignContext({ root, surface: options.surface || null });

  if (options.check) return checkDesignProfile({ root, profilePath, current });

  const existing = loadDesignProfile(profilePath);
  if (existing.error) {
    return failure('read-failed', existing.error, { root, profilePath, action: options.refresh ? 'refresh' : 'plan' });
  }

  const profile = buildDesignProfile({ context: current, existing: existing.profile });
  const comparison = existing.profile ? compareProfileWithContext(existing.profile, current) : { status: 'missing-profile', stale: true, missingSources: [] };
  const action = options.refresh ? 'refresh' : 'plan';
  const wantsWrite = options.write && !options.dryRun;
  const mayWrite = wantsWrite && (options.yes || options.confirmed);

  if (wantsWrite && !mayWrite) {
    return {
      ok: false,
      command: 'learn',
      action,
      status: 'requires-write-confirmation',
      wrote: false,
      dryRun: Boolean(options.dryRun),
      profilePath,
      freshness: comparison,
      profile
    };
  }

  if (mayWrite) {
    writeDesignProfile(root, profilePath, profile);
  }

  return {
    ok: true,
    command: 'learn',
    action,
    status: mayWrite ? 'written' : (comparison.status === 'current' ? 'current' : 'ready'),
    wrote: Boolean(mayWrite),
    dryRun: Boolean(options.dryRun),
    profilePath,
    sourceHash: current.sourceHash,
    sourceCount: current.sources.length,
    freshness: comparison,
    profile
  };
}

/**
 * Collects design-relevant project context without leaving the repo root.
 *
 * @param {object} options Context options.
 * @param {string} options.root Project root.
 * @param {string|null} [options.surface] Optional screen/surface name.
 * @returns {object} Normalized project context and source hash.
 */
export function collectProjectDesignContext(options) {
  const root = canonicalRoot(options.root || process.cwd());
  const configRead = readProjectConfig(root);
  const config = configRead.config || null;
  const target = config ? safeResolveTargetConfig(config, root) : null;
  const sourceRoot = target?.sourceRoot || inferSourceRoot(root);
  const sources = scanDesignSources(root, sourceRoot);
  const sourceHash = hashSources(sources);

  return {
    root,
    sourceRoot: path.relative(root, sourceRoot) || '.',
    projectName: inferProjectName(root, config),
    platform: 'ios',
    surface: options.surface || config?.defaultSurface || null,
    sources,
    sourceHash
  };
}

/**
 * Builds a schemaVersion: 1 design profile from collected context.
 *
 * @param {object} options Build options.
 * @param {object} options.context Project design context.
 * @param {object|null} [options.existing] Existing profile to preserve.
 * @returns {object} Design profile payload.
 */
export function buildDesignProfile(options) {
  const context = options.context;
  const existing = options.existing || null;
  const now = new Date().toISOString();
  const inferredComponents = inferComponents(context.root, context.sources);
  const existingRules = Array.isArray(existing?.reviewRules) ? existing.reviewRules : [];

  return {
    schemaVersion: DESIGN_PROFILE_SCHEMA_VERSION,
    project: {
      name: existing?.project?.name || context.projectName,
      platform: existing?.project?.platform || context.platform || 'ios',
      appCategory: existing?.project?.appCategory || null,
      audience: Array.isArray(existing?.project?.audience) ? existing.project.audience : [],
      tone: Array.isArray(existing?.project?.tone) ? existing.project.tone : []
    },
    sources: context.sources,
    tokens: existing?.tokens || emptyTokens(),
    components: mergeNamedObjects(existing?.components, inferredComponents),
    screenTypes: mergeNamedObjects(existing?.screenTypes, defaultScreenTypes(context.surface)),
    stateSemantics: mergeNamedObjects(existing?.stateSemantics, defaultStateSemantics()),
    reviewRules: mergeRules(existingRules, defaultReviewRules()),
    freshness: {
      createdAt: existing?.freshness?.createdAt || now,
      updatedAt: now,
      sourceHash: context.sourceHash,
      status: 'current'
    }
  };
}

/**
 * Returns the resolved private design profile path after containment checks.
 *
 * @param {string} root Project root.
 * @param {string} configuredPath User-provided or default path.
 * @returns {string} Absolute profile path.
 */
export function resolveDesignProfilePath(root, configuredPath = DEFAULT_DESIGN_PROFILE_PATH) {
  if (!configuredPath || configuredPath.includes('\0')) throw new Error('Design profile path must be a safe string.');
  const resolved = path.isAbsolute(configuredPath) ? path.resolve(configuredPath) : path.resolve(root, configuredPath);
  if (!isPathInside(root, resolved)) throw new Error('Design profile path must resolve inside the project root.');
  if (fs.existsSync(resolved) && fs.lstatSync(resolved).isSymbolicLink()) {
    throw new Error('.screenslop/design-profile.json must not be a symlink.');
  }
  const dir = path.dirname(resolved);
  if (fs.existsSync(dir) && fs.lstatSync(dir).isSymbolicLink()) {
    throw new Error('.screenslop must not be a symlink.');
  }
  return resolved;
}

/**
 * Checks the profile against current source hashes.
 *
 * @param {object} options Check options.
 * @param {string} options.root Project root.
 * @param {string} options.profilePath Absolute profile path.
 * @param {object} options.current Current design context.
 * @returns {object} Check result.
 */
function checkDesignProfile(options) {
  const existing = loadDesignProfile(options.profilePath);
  if (existing.error) return failure('read-failed', existing.error, { root: options.root, profilePath: options.profilePath, action: 'check' });
  if (!existing.profile) {
    return {
      ok: false,
      command: 'learn',
      action: 'check',
      status: 'missing-profile',
      wrote: false,
      profilePath: options.profilePath,
      next: ['screenslop learn --json --dry-run', 'screenslop learn --write --yes --json']
    };
  }

  const freshness = compareProfileWithContext(existing.profile, options.current);
  return {
    ok: freshness.status === 'current',
    command: 'learn',
    action: 'check',
    status: freshness.status,
    wrote: false,
    profilePath: options.profilePath,
    sourceHash: options.current.sourceHash,
    sourceCount: options.current.sources.length,
    freshness,
    next: freshness.status === 'current' ? [] : ['screenslop learn --refresh --json --dry-run']
  };
}

/**
 * Compares saved profile freshness against current source context.
 *
 * @param {object} profile Existing profile.
 * @param {object} context Current project context.
 * @returns {{status:string,stale:boolean,missingSources:string[],expectedSourceHash:string|null,currentSourceHash:string}}
 */
function compareProfileWithContext(profile, context) {
  const sourcePaths = new Set(context.sources.map((source) => source.path));
  const missingSources = (profile.sources || [])
    .map((source) => source.path)
    .filter((sourcePath) => !sourcePaths.has(sourcePath));
  const expectedSourceHash = profile.freshness?.sourceHash || null;
  const status = missingSources.length > 0
    ? 'missing-sources'
    : (expectedSourceHash === context.sourceHash ? 'current' : 'stale');

  return {
    status,
    stale: status !== 'current',
    missingSources,
    expectedSourceHash,
    currentSourceHash: context.sourceHash
  };
}

/**
 * Reads a design profile when it exists.
 *
 * @param {string} file Absolute profile path.
 * @returns {{profile:object|null,error:string|null}}
 */
export function loadDesignProfile(file) {
  if (!fs.existsSync(file)) return { profile: null, error: null };
  try {
    return { profile: JSON.parse(fs.readFileSync(file, 'utf8')), error: null };
  } catch (error) {
    return { profile: null, error: `Invalid JSON in design profile: ${error.message}` };
  }
}

/**
 * Writes a design profile atomically below `.screenslop`.
 *
 * @param {string} root Project root.
 * @param {string} file Absolute profile path.
 * @param {object} profile Profile payload.
 * @returns {string} Written path.
 */
function writeDesignProfile(root, file, profile) {
  resolveDesignProfilePath(root, file);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tempFile = path.join(path.dirname(file), `.design-profile.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tempFile, `${JSON.stringify(profile, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(tempFile, file);
  return file;
}

/**
 * Scans a bounded set of design-relevant files.
 *
 * @param {string} root Project root.
 * @param {string} sourceRoot Source root.
 * @returns {object[]} Source records.
 */
function scanDesignSources(root, sourceRoot) {
  const files = [];
  const seen = new Set();
  walk(sourceRoot, files, root);
  for (const candidate of designDocCandidates(root)) {
    if (fs.existsSync(candidate)) files.push(candidate);
  }
  const uniqueFiles = files.filter((file) => {
    const relative = path.relative(root, file);
    if (seen.has(relative)) return false;
    seen.add(relative);
    return true;
  });
  return uniqueFiles
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_SOURCE_FILES)
    .map((file) => {
      const relative = path.relative(root, file);
      return {
        path: relative,
        kind: sourceKind(file),
        hash: `sha256:${hashFile(file)}`,
        lastSeenAt: new Date().toISOString()
      };
    });
}


/**
 * Returns common design-doc candidates outside the configured source root.
 *
 * @param {string} root Project root.
 * @returns {string[]} Absolute candidate paths.
 */
function designDocCandidates(root) {
  return ['DESIGN.md', 'design.md', 'docs/DESIGN.md', 'docs/design.md', 'README.md']
    .map((candidate) => path.join(root, candidate));
}

/**
 * Recursively walks source files while skipping generated/private folders.
 *
 * @param {string} dir Directory to walk.
 * @param {string[]} files Output file list.
 * @param {string} root Project root.
 * @returns {void}
 */
function walk(dir, files, root) {
  if (!fs.existsSync(dir) || files.length >= MAX_SOURCE_FILES) return;
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    if (SCANNED_EXTENSIONS.has(path.extname(dir))) files.push(dir);
    return;
  }
  if (!stat.isDirectory()) return;

  const relative = path.relative(root, dir);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.some((part) => BLOCKED_DIRS.has(part))) return;

  for (const entry of fs.readdirSync(dir).sort()) {
    if (entry.startsWith('._')) continue;
    walk(path.join(dir, entry), files, root);
    if (files.length >= MAX_SOURCE_FILES) return;
  }
}

/**
 * Builds a source-set hash from file records.
 *
 * @param {object[]} sources Source records.
 * @returns {string} sha256-prefixed hash.
 */
function hashSources(sources) {
  const hash = crypto.createHash('sha256');
  for (const source of sources) {
    hash.update(source.path);
    hash.update('\0');
    hash.update(source.hash);
    hash.update('\0');
  }
  return `sha256:${hash.digest('hex')}`;
}

/**
 * Hashes one file's current bytes.
 *
 * @param {string} file File path.
 * @returns {string} Hex digest.
 */
function hashFile(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

/**
 * Infers a source root from config or common project folders.
 *
 * @param {string} root Project root.
 * @returns {string} Absolute source root.
 */
function inferSourceRoot(root) {
  for (const candidate of ['Sources', 'src', 'App']) {
    const resolved = path.join(root, candidate);
    if (fs.existsSync(resolved)) return resolved;
  }
  return root;
}

/**
 * Resolves target config without letting invalid config block profile planning.
 *
 * @param {object} config Screenslop config.
 * @param {string} root Project root.
 * @returns {object|null} Target config or null.
 */
function safeResolveTargetConfig(config, root) {
  try {
    return resolveTargetConfig(config, { root });
  } catch {
    return null;
  }
}

/**
 * Infers the project display name.
 *
 * @param {string} root Project root.
 * @param {object|null} config Screenslop config.
 * @returns {string} Project name.
 */
function inferProjectName(root, config) {
  return config?.defaultScheme || path.basename(root) || 'AppleApp';
}

/**
 * Infers SwiftUI component names from scanned source files.
 *
 * @param {string} root Project root.
 * @param {object[]} sources Source records.
 * @returns {object[]} Component records.
 */
function inferComponents(root, sources) {
  const components = [];
  for (const source of sources) {
    if (!source.path.endsWith('.swift')) continue;
    const text = safeRead(path.join(root, source.path));
    for (const match of text.matchAll(/struct\s+([A-Za-z][A-Za-z0-9_]*)\s*:\s*View/g)) {
      components.push({
        name: match[1],
        purpose: 'SwiftUI view discovered during design learning',
        expectedTraits: ['matches the project design profile', 'keeps runtime accessibility and visual hierarchy clear']
      });
    }
  }
  return components;
}

/**
 * Reads a repo-relative source if still present.
 *
 * @param {string} file Absolute file path.
 * @returns {string} File contents or empty string.
 */
function safeRead(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

/** @returns {object} Empty token buckets. */
function emptyTokens() {
  return { colors: [], typography: [], spacing: [], cornerRadii: [], materials: [], icons: [] };
}

/**
 * Returns default screen-type rules.
 * @param {string|null} surface Current surface name.
 * @returns {object[]} Screen-type records.
 */
function defaultScreenTypes(surface) {
  return [{
    name: surface || 'general',
    goals: ['make the primary task easy to understand from the captured screen'],
    rules: ['keep primary and secondary actions visually distinct', 'make status text match visible product state']
  }];
}

/** @returns {object[]} Default state semantics. */
function defaultStateSemantics() {
  return [{ name: 'status copy', rules: ['visible badges and labels must not contradict the screen state'] }];
}

/** @returns {object[]} Default review rules. */
function defaultReviewRules() {
  return [
    {
      id: 'design.hierarchy.primary-action',
      pillar: 'hierarchy',
      severity: 'P2',
      description: 'The intended primary action should be visually clear from the runtime screenshot.'
    },
    {
      id: 'design.product-state.copy-match',
      pillar: 'slop',
      severity: 'P2',
      description: 'Visible status copy should match the actual state shown on the screen.'
    }
  ];
}

/**
 * Merges object arrays by `name` while preserving existing records first.
 * @param {object[]|undefined} existing Existing records.
 * @param {object[]} generated Generated records.
 * @returns {object[]} Merged records.
 */
function mergeNamedObjects(existing, generated) {
  const output = [];
  const seen = new Set();
  for (const item of [...(Array.isArray(existing) ? existing : []), ...generated]) {
    const name = item?.name;
    if (!name || seen.has(name)) continue;
    seen.add(name);
    output.push(item);
  }
  return output;
}

/**
 * Merges review rules by `id` while preserving user-authored records.
 * @param {object[]} existing Existing rules.
 * @param {object[]} generated Generated rules.
 * @returns {object[]} Merged rules.
 */
function mergeRules(existing, generated) {
  const output = [];
  const seen = new Set();
  for (const rule of [...existing, ...generated]) {
    if (!rule?.id || seen.has(rule.id)) continue;
    seen.add(rule.id);
    output.push(rule);
  }
  return output;
}

/**
 * Classifies a source file kind from its extension.
 * @param {string} file Source file.
 * @returns {string} Source kind.
 */
function sourceKind(file) {
  if (file.endsWith('.swift')) return 'swiftui-source';
  if (file.endsWith('.md')) return 'design-doc';
  if (file.endsWith('.json')) return 'json-config';
  return 'project-source';
}

/**
 * Creates a failure payload.
 * @param {string} status Failure status.
 * @param {string} error Error message.
 * @param {object} extra Extra payload.
 * @returns {object} Failure result.
 */
function failure(status, error, extra = {}) {
  return { ok: false, command: 'learn', status, error, wrote: false, ...extra };
}

/**
 * Canonicalizes a root path.
 * @param {string} root Project root.
 * @returns {string} Canonical path.
 */
function canonicalRoot(root) {
  return fs.realpathSync.native(path.resolve(root));
}

/**
 * Checks containment below the project root.
 * @param {string} root Project root.
 * @param {string} candidate Candidate path.
 * @returns {boolean} True when candidate is inside root.
 */
function isPathInside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
