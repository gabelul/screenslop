import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readProjectConfig, resolveTargetConfig } from '../config/project-config.mjs';
import { DEFAULT_DESIGN_PROFILE_PATH, DESIGN_PROFILE_SCHEMA_VERSION } from './index.mjs';

const SCANNED_EXTENSIONS = new Set(['.swift', '.md', '.json', '.yml', '.yaml']);
const BLOCKED_DIRS = new Set(['.build', '.git', '.github', '.omx', '.screenslop', '.swiftpm', 'artifacts', 'build', 'DerivedData', 'node_modules']);
const MAX_SOURCE_FILES = 320;
const TOKEN_LIMIT_PER_BUCKET = 80;
const CORE_TOKEN_BUCKETS = ['colors', 'typography', 'spacing', 'cornerRadii'];

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
  let current;
  try {
    current = collectProjectDesignContext({ root, surface: options.surface || null });
  } catch (error) {
    return failure('config-invalid', error.message, { root, profilePath, action: options.check ? 'check' : (options.refresh ? 'refresh' : 'plan') });
  }

  if (options.check) return checkDesignProfile({ root, profilePath, current });

  const existing = loadDesignProfile(profilePath);
  if (existing.error) {
    return failure('read-failed', existing.error, { root, profilePath, action: options.refresh ? 'refresh' : 'plan' });
  }

  const profile = buildDesignProfile({ context: current, existing: existing.profile });
  const previousFreshness = existing.profile
    ? compareProfileWithContext(existing.profile, current)
    : { status: 'missing-profile', stale: true, missingSources: [] };
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
      freshness: previousFreshness,
      profile
    };
  }

  let freshness = previousFreshness;
  if (mayWrite) {
    writeDesignProfile(root, profilePath, profile);
    freshness = compareProfileWithContext(profile, current);
  }

  return {
    ok: true,
    command: 'learn',
    action,
    status: mayWrite ? 'written' : (previousFreshness.status === 'current' ? 'current' : 'ready'),
    wrote: Boolean(mayWrite),
    dryRun: Boolean(options.dryRun),
    profilePath,
    sourceHash: current.sourceHash,
    sourceCount: current.sources.length,
    freshness,
    previousFreshness: mayWrite ? previousFreshness : undefined,
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
  if (configRead.error) throw new Error(`Invalid Screenslop config: ${configRead.error}`);
  const config = configRead.config || null;
  const target = config ? resolveTargetConfig(config, { root }) : null;
  const sourceRoot = target?.sourceRoot || inferSourceRoot(root);
  const designSources = target?.designSources || [];
  const sources = scanDesignSources(root, sourceRoot, designSources);
  const sourceHash = hashSources(sources);

  return {
    root,
    sourceRoot: path.relative(root, sourceRoot) || '.',
    designSources: designSources.map((source) => displaySourcePath(root, source)),
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
  const inferredTokens = inferTokens(context.root, context.sources);
  const inferredMetadata = inferProjectMetadata(context.root, context.sources);
  const existingRules = Array.isArray(existing?.reviewRules) ? existing.reviewRules : [];
  const tokens = mergeTokens(inferredTokens, existing?.tokens);
  const profileGaps = inferProfileGaps({ context, tokens });

  return {
    schemaVersion: DESIGN_PROFILE_SCHEMA_VERSION,
    project: {
      name: existing?.project?.name || context.projectName,
      platform: existing?.project?.platform || context.platform || 'ios',
      appCategory: existing?.project?.appCategory || inferredMetadata.appCategory || null,
      audience: Array.isArray(existing?.project?.audience) && existing.project.audience.length ? existing.project.audience : inferredMetadata.audience,
      tone: Array.isArray(existing?.project?.tone) && existing.project.tone.length ? existing.project.tone : inferredMetadata.tone
    },
    sources: context.sources,
    designSources: context.designSources || [],
    tokens,
    components: mergeNamedObjects(existing?.components, inferredComponents),
    screenTypes: mergeNamedObjects(existing?.screenTypes, defaultScreenTypes(context.surface)),
    stateSemantics: mergeNamedObjects(existing?.stateSemantics, defaultStateSemantics()),
    reviewRules: mergeRules(existingRules, defaultReviewRules()),
    profileGaps,
    freshness: {
      createdAt: existing?.freshness?.createdAt || now,
      updatedAt: now,
      sourceHash: context.sourceHash,
      status: 'current'
    }
  };
}

/**
 * Summarizes a private design profile without exposing source content.
 * @param {object} profile Private profile.
 * @returns {object} Public-safe profile summary.
 */
export function summarizeDesignProfile(profile) {
  return {
    schemaVersion: profile.schemaVersion || null,
    platform: profile.project?.platform || null,
    sourceCount: Array.isArray(profile.sources) ? profile.sources.length : 0,
    tokenCounts: Object.fromEntries(Object.entries(profile.tokens || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])),
    trustedTokenCounts: Object.fromEntries(Object.entries(profile.tokens || {}).map(([key, value]) => [key, Array.isArray(value) ? value.filter(isTrustedToken).length : 0])),
    designSourceCount: Array.isArray(profile.designSources) ? profile.designSources.length : 0,
    profileGapCount: Array.isArray(profile.profileGaps) ? profile.profileGaps.length : 0,
    profileGapIds: Array.isArray(profile.profileGaps) ? profile.profileGaps.map((gap) => gap.id).filter(Boolean) : [],
    componentCount: Array.isArray(profile.components) ? profile.components.length : 0,
    screenTypeCount: Array.isArray(profile.screenTypes) ? profile.screenTypes.length : 0,
    stateSemanticCount: Array.isArray(profile.stateSemantics) ? profile.stateSemantics.length : 0,
    reviewRuleCount: Array.isArray(profile.reviewRules) ? profile.reviewRules.length : 0,
    freshnessStatus: profile.freshness?.status || null
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
  return resolveProjectContainedPath(root, configuredPath, 'Design profile');
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
    profileSummary: summarizeDesignProfile(existing.profile),
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
function scanDesignSources(root, sourceRoot, designSources = []) {
  const files = [];
  const seen = new Set();
  for (const candidate of designDocCandidates(root)) {
    addSourceCandidate({ root, file: candidate, files, seen });
  }
  for (const designSource of designSources) {
    walk(designSource, files, root, seen, 'design-source');
  }
  walk(sourceRoot, files, root, seen, 'source-root');

  return files
    .slice(0, MAX_SOURCE_FILES)
    .map((entry) => ({
      path: displaySourcePath(root, entry.file),
      kind: sourceKind(entry.file, entry.origin),
      origin: entry.origin,
      hash: `sha256:${hashFile(entry.file)}`,
      lastSeenAt: new Date().toISOString()
    }));
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
function walk(dir, files, root, seen, origin) {
  if (!fs.existsSync(dir) || files.length >= MAX_SOURCE_FILES) return;
  const stat = fs.lstatSync(dir);
  if (stat.isSymbolicLink()) return;
  if (stat.isFile()) {
    addSourceCandidate({ root, file: dir, files, seen, origin });
    return;
  }
  if (!stat.isDirectory()) return;

  const relative = path.relative(root, dir);
  const parts = relative.split(path.sep).filter(Boolean);
  if (parts.some((part) => BLOCKED_DIRS.has(part))) return;

  for (const entry of fs.readdirSync(dir).sort(compareWalkEntries)) {
    if (entry.startsWith('._')) continue;
    walk(path.join(dir, entry), files, root, seen, origin);
    if (files.length >= MAX_SOURCE_FILES) return;
  }
}

/**
 * Checks that a source file exists and is not a symlink. Explicit designSources may live outside the repo.
 * @param {string} root Project root.
 * @param {string} file Candidate source file.
 * @returns {boolean} True when safe to read.
 */
function isSafeSourceFile(root, file) {
  if (!fs.existsSync(file)) return false;
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || !stat.isFile()) return false;
  return true;
}

/**
 * Sorts likely design-system files early so bounded scans reach tokens before examples.
 * @param {string} left First directory entry name.
 * @param {string} right Second directory entry name.
 * @returns {number} Sort order.
 */
function compareWalkEntries(left, right) {
  const priority = walkEntryPriority(left) - walkEntryPriority(right);
  return priority || left.localeCompare(right);
}

/**
 * Scores an entry name for design-profile learning.
 * @param {string} entry Directory entry name.
 * @returns {number} Lower means earlier.
 */
function walkEntryPriority(entry) {
  const normalized = entry.toLowerCase();
  if (normalized === 'sources') return 0;
  if (normalized === 'tokens') return 1;
  if (['primitive', 'semantic', 'theme', 'environment'].includes(normalized)) return 2;
  if (/token|color|typography|spacing|radius|theme|design|brand|palette/.test(normalized)) return 3;
  if (/readme|design|\.md$|\.docc$/.test(normalized)) return 4;
  return 10;
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
    const text = safeRead(resolveSourceFile(root, source.path));
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


/**
 * Adds one scanned source while preserving priority order.
 * @param {object} options Source candidate options.
 * @param {string} options.root Project root.
 * @param {string} options.file Absolute candidate file.
 * @param {{file:string,origin:string}[]} options.files Output records.
 * @param {Set<string>} options.seen Seen file keys.
 * @param {string} [options.origin] Source origin label.
 * @returns {void}
 */
function addSourceCandidate({ root, file, files, seen, origin = 'design-doc' }) {
  if (files.length >= MAX_SOURCE_FILES) return;
  if (!SCANNED_EXTENSIONS.has(path.extname(file)) || !isSafeSourceFile(root, file)) return;
  const key = fs.realpathSync.native(file);
  if (seen.has(key)) return;
  seen.add(key);
  files.push({ file: key, origin });
}

/**
 * Builds a private source path for repo-local and explicit external sources.
 * @param {string} root Project root.
 * @param {string} file Absolute source file.
 * @returns {string} Repo-relative path or absolute external path.
 */
function displaySourcePath(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative)) ? relative || '.' : file;
}

/**
 * Extracts lightweight tokens from Swift and Markdown design sources.
 * @param {string} root Project root.
 * @param {object[]} sources Source records.
 * @returns {object} Token buckets.
 */
function inferTokens(root, sources) {
  const tokens = emptyTokens();
  for (const source of sources) {
    if (shouldSkipTokenExtraction(source)) continue;
    const text = safeRead(resolveSourceFile(root, source.path));
    if (!text) continue;
    const found = source.path.endsWith('.md') ? extractMarkdownTokens(text, source) : extractSwiftTokens(text, source);
    for (const [bucket, values] of Object.entries(found)) {
      tokens[bucket] = dedupeTokens([...(tokens[bucket] || []), ...values]);
    }
  }
  resolveAliasColorTokens(tokens.colors);
  // Cap once at the end, not per merge: a big primitive palette scans first
  // (Tokens/Primitive/ sorts before Themes/) and would otherwise fill the
  // bucket before a single semantic role arrives. Semantic and component
  // tokens are the scarce, high-value records — they survive the trim.
  for (const bucket of Object.keys(tokens)) {
    tokens[bucket] = capTokensByLayer(tokens[bucket]);
  }
  return tokens;
}

/**
 * Trims a token bucket to the per-bucket limit, preferring layered value:
 * semantic > component > unknown > primitive, stable within each layer.
 * Aliases are resolved before this runs, so trimmed primitives have already
 * donated their hex to the semantic records that reference them.
 * @param {object[]} values Deduped token records.
 * @returns {object[]} Capped token records.
 */
function capTokensByLayer(values) {
  if (values.length <= TOKEN_LIMIT_PER_BUCKET) return values;
  const priority = { semantic: 0, component: 1, unknown: 2, primitive: 3 };
  // Resolved aliases outrank everything in their layer: a real design system
  // yields hundreds of theme-palette literals but only a few dozen named
  // roles, and the roles are what drift findings exist to recommend.
  const rank = (token) => (token.extraction === 'swift-color-alias' && token.resolvedValue ? 0 : 1);
  return values
    .map((token, index) => ({ token, index }))
    .sort((left, right) => {
      const layerDelta = (priority[left.token.layer] ?? 2) - (priority[right.token.layer] ?? 2);
      if (layerDelta !== 0) return layerDelta;
      const rankDelta = rank(left.token) - rank(right.token);
      return rankDelta !== 0 ? rankDelta : left.index - right.index;
    })
    .slice(0, TOKEN_LIMIT_PER_BUCKET)
    .sort((left, right) => left.index - right.index)
    .map((entry) => entry.token);
}

/**
 * Resolves alias color tokens against the tokens they reference.
 * Layered design systems write semantic roles as computed aliases —
 * `var primary: Color { PrimitiveColors.blue500 }` — so the role's value is a
 * reference, not a hex. This pass looks the reference up among the extracted
 * colors and stamps the alias with `resolvedValue` (the target's value text)
 * and `aliasOf` (the target's name). One hop only: aliases pointing at other
 * aliases stay unresolved rather than chasing chains. Unresolvable references
 * keep their raw value and gain nothing.
 * @param {object[]} colors Extracted color token records (mutated in place).
 * @returns {object[]} The same array, with alias records annotated.
 */
function resolveAliasColorTokens(colors) {
  const byName = new Map();
  for (const token of colors) {
    if (token.extraction === 'swift-color-alias') continue;
    if (!byName.has(token.name)) byName.set(token.name, token);
  }
  for (const token of colors) {
    if (token.extraction !== 'swift-color-alias') continue;
    const target = byName.get(token.value);
    if (!target) continue;
    token.resolvedValue = target.value;
    token.aliasOf = target.name;
  }
  return colors;
}

/**
 * Extracts design tokens from Markdown tables and bullet-style docs.
 * @param {string} text Markdown source text.
 * @param {object} source Source record.
 * @returns {object} Token buckets.
 */
function extractMarkdownTokens(text, source) {
  const tokens = emptyTokens();
  const lines = text.split(/\r?\n/);
  let heading = '';
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^#{1,6}\s+/.test(trimmed)) heading = trimmed.replace(/^#{1,6}\s+/, '').toLowerCase();
    if (!trimmed || /^\|?\s*:?-{3,}/.test(trimmed)) continue;

    const tableCells = parseMarkdownTableRow(trimmed);
    if (tableCells.length >= 2) {
      const [first, second, third] = tableCells;
      if (/^(token|name)$/i.test(first) && /^(value|hex|usage)$/i.test(second)) continue;
      const bucket = classifyMarkdownTokenBucket({ heading, name: first, value: second, extra: third || '' });
      if (bucket) tokens[bucket].push(tokenRecord(first, second, source, 'markdown-table'));
      continue;
    }

    const pair = trimmed.match(/^(?:[-*]\s*)?`?([A-Za-z][A-Za-z0-9_. -]{1,60})`?\s*[:=]\s*`?([^`]+?)`?\s*$/);
    if (!pair) continue;
    const bucket = classifyMarkdownTokenBucket({ heading, name: pair[1], value: pair[2], extra: '' });
    if (bucket) tokens[bucket].push(tokenRecord(pair[1], pair[2], source, 'markdown-pair'));
  }
  return tokens;
}

/**
 * Extracts SwiftUI design tokens from common static constants and symbols.
 * @param {string} text Swift source text.
 * @param {object} source Source record.
 * @returns {object} Token buckets.
 */
function extractSwiftTokens(text, source) {
  const tokens = emptyTokens();
  const lines = text.split(/\r?\n/);
  let scopeName = '';
  let scopeContext = '';
  for (const line of lines) {
    if (/^\s*\/\//.test(line)) continue;
    const scopeMatch = line.match(/\b(?:enum|struct|class|protocol)\s+([A-Za-z][A-Za-z0-9_]*)([^{}]*)/);
    if (scopeMatch) {
      scopeName = scopeMatch[1];
      scopeContext = `${scopeMatch[1]} ${scopeMatch[2] || ''}`;
    }
    const constant = line.match(/\b(?:static\s+)?(?:let|var)\s+([A-Za-z][A-Za-z0-9_]*)\s*(?::\s*([^=\{]+))?\s*(?:=|\{)\s*(.+)$/);
    if (constant) {
      const name = `${scopeName ? `${scopeName}.` : ''}${constant[1]}`;
      const typeHint = constant[2] || '';
      const value = constant[3].replace(/\s*\/\/.*$/, '').trim();
      if (/^(?:get|set)\b/.test(value)) continue;
      // Semantic layers alias primitives instead of repeating literals:
      // `var primary: Color { PrimitiveColors.blue500 }`. Check the alias
      // shape BEFORE the bucket classifier — scope names like ColorPalette
      // contain "palette", so these lines classify as colors and would be
      // recorded as opaque statics, never reaching an else-branch. A literal
      // marker (parenthesis, hash, quote) means a real value, not an alias.
      const aliasRef = /[("#]/.test(value)
        ? null
        : value.match(/\b([A-Z][A-Za-z0-9_]*(?:Colors|Palette|Tokens))\s*\.\s*([a-zA-Z][A-Za-z0-9_]*)\b/);
      const saysColor = /\bcolor\b/i.test(typeHint) || /(Colors|Palette)$/.test(aliasRef?.[1] || '');
      const bucket = classifySwiftTokenBucket({ name, typeHint, value, line, scopeContext, source });
      if (aliasRef && saysColor) {
        tokens.colors.push(tokenRecord(name, `${aliasRef[1]}.${aliasRef[2]}`, source, 'swift-color-alias', 'medium'));
      } else if (bucket) {
        tokens[bucket].push(tokenRecord(name, value, source, 'swift-static', 'medium'));
      }
    }

    for (const match of line.matchAll(/Color\(\s*"([^"]+)"\s*\)/g)) {
      tokens.colors.push(tokenRecord(match[1], `Color("${match[1]}")`, source, 'swift-color-asset', 'high'));
    }
    for (const match of line.matchAll(/(?:Color|UIColor)\s*\(\s*hex\s*:\s*"?([^"\),]+)"?/gi)) {
      tokens.colors.push(tokenRecord(`${scopeName || 'color'}.hex`, match[1], source, 'swift-color-hex', 'high'));
    }
    for (const match of line.matchAll(/(?:Color|UIColor)\s*\([^)]*(?:hue\s*:|saturation\s*:|brightness\s*:)[^)]*\)/gi)) {
      tokens.colors.push(tokenRecord(`${scopeName || 'color'}.hsb`, match[0], source, 'swift-color-hsb', 'high'));
    }
    for (const match of line.matchAll(/DynamicTheme\s*\(|brandColor\s*:/g)) {
      tokens.colors.push(tokenRecord(`${scopeName || 'theme'}.dynamicTheme`, line.trim(), source, 'swift-dynamic-theme', 'medium'));
    }
    for (const match of line.matchAll(/Font\.custom\(\s*"([^"]+)"\s*,\s*size:\s*([0-9.]+)/g)) {
      tokens.typography.push(tokenRecord(match[1], `Font.custom(size: ${match[2]})`, source, 'swift-font-custom', 'high'));
    }
    for (const match of line.matchAll(/(?:Image\(\s*systemName:|systemImage:)\s*"([^"]+)"/g)) {
      tokens.icons.push(tokenRecord(match[1], match[1], source, 'swift-symbol', 'high'));
    }
    if (/material/i.test(line)) {
      for (const match of line.matchAll(/(?:Material\.)?(ultraThinMaterial|thinMaterial|regularMaterial|thickMaterial|ultraThickMaterial|thin|regular|thick|bar)\b/g)) {
        tokens.materials.push(tokenRecord(match[1], match[0], source, 'swift-material', 'high'));
      }
    }
  }
  return Object.fromEntries(Object.entries(tokens).map(([bucket, values]) => [bucket, dedupeTokens(values)]));
}

/**
 * Reads high-level product metadata from common design docs.
 * @param {string} root Project root.
 * @param {object[]} sources Source records.
 * @returns {{appCategory:string|null,audience:string[],tone:string[]}}
 */
function inferProjectMetadata(root, sources) {
  const metadata = { appCategory: null, audience: [], tone: [] };
  for (const source of sources.filter((item) => item.path.endsWith('.md'))) {
    const text = safeRead(resolveSourceFile(root, source.path));
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*(?:[-*]\s*)?(Category|App Category|Audience|Tone|Voice)\s*:\s*(.+)$/i);
      if (!match) continue;
      const key = match[1].toLowerCase();
      const values = splitList(match[2]);
      if (key.includes('category') && !metadata.appCategory) metadata.appCategory = values[0] || null;
      if (key === 'audience') metadata.audience = dedupeStrings([...metadata.audience, ...values]);
      if (key === 'tone' || key === 'voice') metadata.tone = dedupeStrings([...metadata.tone, ...values]);
    }
  }
  return metadata;
}

/**
 * Builds profile gaps that agents can report honestly.
 * @param {object} options Gap options.
 * @param {object} options.context Current context.
 * @param {object} options.tokens Token buckets.
 * @returns {object[]} Profile gap records.
 */
function inferProfileGaps({ context, tokens }) {
  const gaps = [];
  const tokenCounts = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, value.length]));
  const trustedCounts = Object.fromEntries(Object.entries(tokens).map(([key, value]) => [key, value.filter(isTrustedToken).length]));
  if (Object.values(tokenCounts).every((count) => count === 0)) {
    gaps.push({
      id: 'design.tokens.empty',
      severity: 'P2',
      detail: 'No color, typography, spacing, radius, material, or icon tokens were extracted. Design-system drift checks need explicit designSources or parseable design docs.'
    });
  }
  const weakCoreBuckets = CORE_TOKEN_BUCKETS.filter((bucket) => trustedCounts[bucket] === 0);
  if (context.designSources?.length && weakCoreBuckets.length > 0) {
    gaps.push({
      id: 'design.tokens.incomplete-core',
      severity: 'P2',
      detail: `Configured design sources were scanned, but credible core token buckets are still missing: ${weakCoreBuckets.join(', ')}. Treat design-system drift checks as incomplete until the extractor learns those patterns or the profile is hand-reviewed.`
    });
  }
  if (!context.designSources?.length) {
    gaps.push({
      id: 'design.sources.not-configured',
      severity: 'P3',
      detail: 'No extra designSources are configured. External Swift packages or shared design-system folders will not be scanned.'
    });
  }
  return gaps;
}


/**
 * Skips generated/localization sources that look like copy catalogs, not design-system definitions.
 * @param {object} source Source record.
 * @returns {boolean} True when token extraction should skip the file.
 */
function shouldSkipTokenExtraction(source) {
  const normalized = source.path.replace(/\\/g, '/').toLowerCase();
  return /(^|\/)l10n\.swift$/.test(normalized)
    || normalized.includes('/localization')
    || normalized.includes('/localizable')
    || normalized.includes('/strings')
    || normalized.includes('/generated/')
    || normalized.endsWith('/generated.swift');
}

/**
 * Classifies Swift constants only when the declaration looks like a real design token.
 * @param {object} options Classification options.
 * @returns {string|null} Token bucket.
 */
function classifySwiftTokenBucket(options) {
  const text = `${options.name} ${options.typeHint} ${options.value} ${options.scopeContext}`.toLowerCase();
  const sourceText = `${options.source.path} ${options.source.origin || ''}`.toLowerCase();
  const designContext = /design|theme|token|style|brand|palette|spacing|radius|typography|font/.test(sourceText)
    || /design|theme|token|style|brand|palette|spacing|radius|typography|font/.test(options.scopeContext.toLowerCase());
  if (/image\s*\(|systemimage|systemname|sf symbol|icon/.test(text)) return 'icons';
  if (/color\s*\(|uicolor|cgcolor|#[0-9a-f]{3,8}\b|\bhex\b|hue\s*:|saturation\s*:|brightness\s*:|dynamictheme|brandcolor|themecolor|palette/.test(text)) return 'colors';
  if (/font\s*\.|uifont|font\b|typography|textstyle|serif|sans|weight/.test(text)) return 'typography';
  if (/material\b|ultrathinmaterial|thinmaterial|regularmaterial|thickmaterial|blur/.test(options.value.toLowerCase()) || /material\b|blur/.test(options.name.toLowerCase())) return 'materials';
  if (/radius|corner|rounded/.test(text) && designContext) return 'cornerRadii';
  if (/spacing|padding|inset|margin|gap/.test(text) && designContext) return 'spacing';
  if (/\b(xxs|xs|sm|md|lg|xl|xxl|small|medium|large)\b/.test(options.name.toLowerCase()) && /cgfloat|double|int|spacing|scale/.test(text) && designContext) return 'spacing';
  return null;
}

/** @param {object} token Token record. @returns {boolean} True when it can clear profile gaps. */
function isTrustedToken(token) {
  return token?.confidence === 'high' || token?.confidence === 'medium' || token?.extraction === 'manual';
}

/** @param {object} token Existing token record. @returns {boolean} True when the token should survive refresh. */
function shouldPreserveExistingToken(token) {
  if (!token || typeof token !== 'object') return false;
  if (token.extraction && token.extraction !== 'manual') return false;
  return token.confidence !== 'low';
}

/**
 * Classifies Markdown token rows without letting prose headings create material tokens.
 * @param {object} options Markdown token hints.
 * @returns {string|null} Token bucket.
 */
function classifyMarkdownTokenBucket(options) {
  const bucket = classifyTokenBucket(`${options.heading} ${options.name} ${options.value} ${options.extra}`);
  if (bucket !== 'materials') return bucket;
  return looksLikeExplicitMaterialToken(`${options.name} ${options.value} ${options.extra}`) ? bucket : null;
}

/**
 * Checks for actual SwiftUI material tokens rather than prose like Material Design.
 * @param {string} text Markdown name/value text.
 * @returns {boolean} True when the text names a concrete material token.
 */
function looksLikeExplicitMaterialToken(text) {
  return /(?:Material\.)?(?:ultraThinMaterial|thinMaterial|regularMaterial|thickMaterial|ultraThickMaterial)\b|\bMaterial\.(?:thin|regular|thick|bar)\b|\.(?:thin|regular|thick|bar)Material\b/i.test(text);
}

/** @param {string} line Markdown line. @returns {string[]} Table cells. */
function parseMarkdownTableRow(line) {
  if (!line.includes('|')) return [];
  return line.split('|').map((cell) => cell.trim()).filter(Boolean);
}

/** @param {string} text Token hint text. @returns {string|null} Token bucket. */
function classifyTokenBucket(text) {
  const value = text.toLowerCase();
  if (/#[0-9a-f]{3,8}\b|\bcolor\b|\bcolour\b|\bpalette\b|\bteal\b|\bhex\b/.test(value)) return 'colors';
  if (/\bfont\b|\btypography\b|\bserif\b|\bsans\b|\bweight\b|\btextstyle\b/.test(value)) return 'typography';
  if (/radius|corner|rounded/.test(value)) return 'cornerRadii';
  if (/spacing|padding|gap|inset|margin/.test(value)) return 'spacing';
  if (/\bmaterial\b|\bblur\b|\bglass\b|ultrathinmaterial|thinmaterial|regularmaterial|thickmaterial/.test(value)) return 'materials';
  if (/\bicon\b|\bsymbol\b|\bsf symbol\b|\bsystemimage\b|\bsystemname\b/.test(value)) return 'icons';
  return null;
}

// Semantic-role vocabulary: names that say what a token is *for* (primary,
// onSurface, error) rather than what it looks like.
const SEMANTIC_NAME_PATTERN = /\b(primary|secondary|tertiary|accent|background|surface|onsurface|onprimary|error|warning|success|info|label|separator|palette)\b/i;
// Primitive vocabulary: raw scale names like blue500 — what a token *is*, not what it's for.
const PRIMITIVE_NAME_PATTERN = /\b(blue|red|green|gray|grey|purple|orange|yellow|pink|slate|neutral)\d{2,3}\b/i;

/**
 * Classifies which design-system layer a token belongs to, from cheap signals.
 * Real design systems stack primitives (blue500) under semantic roles (primary,
 * onSurface) under component tokens; knowing the layer lets drift findings say
 * "you used a primitive where a role belongs." Precedence: source path segments
 * first (a /Primitive/ directory beats any name pattern), then semantic name
 * patterns, then primitive name patterns, else 'unknown'.
 * @param {string} name Token name, usually `Scope.constant`.
 * @param {object} source Source record with the file path.
 * @returns {'primitive'|'semantic'|'component'|'unknown'} Token layer.
 */
function classifyTokenLayer(name, source) {
  const fromPath = classifyLayerFromPath(source?.path);
  if (fromPath) return fromPath;
  // Split camelCase so surfacePrimary matches \bprimary\b, but keep the raw
  // name too — onSurface only matches \bonsurface\b when it stays glued.
  const spaced = String(name || '').replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  const haystack = `${name} ${spaced}`;
  if (SEMANTIC_NAME_PATTERN.test(haystack)) return 'semantic';
  if (PRIMITIVE_NAME_PATTERN.test(haystack) || /\bprimitive\b/i.test(spaced)) return 'primitive';
  return 'unknown';
}

/**
 * Reads the token layer from path segments like Tokens/Primitive/ or
 * PrimitiveColors.swift. The deepest matching segment wins so
 * DesignSystem/Semantic/ComponentTokens.swift classifies as component.
 * @param {string|undefined} sourcePath Source file path.
 * @returns {'primitive'|'semantic'|'component'|null} Layer or null when the path says nothing.
 */
function classifyLayerFromPath(sourcePath) {
  let layer = null;
  for (const segment of String(sourcePath || '').replace(/\\/g, '/').split('/')) {
    if (/^primitive/i.test(segment)) layer = 'primitive';
    else if (/^semantic/i.test(segment)) layer = 'semantic';
    else if (/^component/i.test(segment)) layer = 'component';
  }
  return layer;
}

/**
 * Builds a normalized token record.
 * @param {string} name Token name.
 * @param {string} value Token value.
 * @param {object} source Source record.
 * @param {string} extraction Extraction strategy.
 * @param {string} [confidence='medium'] Token confidence used by profile-gap checks.
 * @returns {object} Token record.
 */
function tokenRecord(name, value, source, extraction, confidence = 'medium') {
  const cleanName = cleanTokenText(name);
  return {
    name: cleanName,
    value: cleanTokenText(value),
    source: source.path,
    sourceKind: source.kind || null,
    layer: classifyTokenLayer(cleanName, source),
    extraction,
    confidence
  };
}

/** @param {object[]} values Token records. @returns {object[]} Deduped records. */
function dedupeTokens(values) {
  const seen = new Set();
  const output = [];
  for (const token of values) {
    if (!token?.name || !token?.value) continue;
    const key = `${token.name.toLowerCase()}=${token.value.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(token);
  }
  return output;
}

/**
 * Merges generated tokens ahead of existing manual records.
 * @param {object} generated Generated tokens.
 * @param {object|undefined} existing Existing profile tokens.
 * @returns {object} Merged token buckets.
 */
function mergeTokens(generated, existing) {
  const output = emptyTokens();
  for (const bucket of Object.keys(output)) {
    const preserved = (Array.isArray(existing?.[bucket]) ? existing[bucket] : []).filter(shouldPreserveExistingToken);
    output[bucket] = dedupeTokens([...(generated?.[bucket] || []), ...preserved]).slice(0, TOKEN_LIMIT_PER_BUCKET);
  }
  return output;
}

/** @param {string} value Raw token text. @returns {string} Clean token text. */
function cleanTokenText(value) {
  return String(value || '').replace(/^`|`$/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
}

/** @param {string} value Comma-separated text. @returns {string[]} Clean values. */
function splitList(value) {
  return value.split(/[,;\/]|\s+and\s+/i).map((item) => item.trim()).filter(Boolean).slice(0, 12);
}

/** @param {string[]} values Values to dedupe. @returns {string[]} Deduped strings. */
function dedupeStrings(values) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

/**
 * Resolves private profile source paths back to local files.
 * @param {string} root Project root.
 * @param {string} sourcePath Profile source path.
 * @returns {string} Absolute file path.
 */
function resolveSourceFile(root, sourcePath) {
  return path.isAbsolute(sourcePath) ? sourcePath : path.join(root, sourcePath);
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
function sourceKind(file, origin = 'source-root') {
  if (origin === 'design-source' && file.endsWith('.swift')) return 'design-system-source';
  if (file.endsWith('.swift')) return 'swiftui-source';
  if (file.endsWith('.md')) return 'design-doc';
  if (file.endsWith('.json')) return 'json-config';
  return origin === 'design-source' ? 'design-source' : 'project-source';
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
 * Resolves a project-local path while rejecting escapes and symlink ancestors.
 * @param {string} root Project root.
 * @param {string} configuredPath User-provided path.
 * @param {string} label Human label for errors.
 * @returns {string} Absolute path inside the canonical root.
 */
export function resolveProjectContainedPath(root, configuredPath, label = 'Project file') {
  const canonical = canonicalRoot(root);
  if (!configuredPath || configuredPath.includes('\0')) throw new Error(`${label} path must be a safe string.`);
  const resolved = path.isAbsolute(configuredPath) ? path.resolve(configuredPath) : path.resolve(canonical, configuredPath);
  if (!isPathInside(canonical, resolved)) throw new Error(`${label} path must resolve inside the project root.`);
  assertNoSymlinkAncestors(canonical, resolved, label);
  return resolved;
}

/**
 * Rejects existing symlink ancestors and realpath escapes for a project-local path.
 * @param {string} root Canonical project root.
 * @param {string} candidate Absolute candidate path.
 * @param {string} label Human label for errors.
 * @returns {void}
 */
function assertNoSymlinkAncestors(root, candidate, label) {
  const relative = path.relative(root, candidate);
  const parts = relative.split(path.sep).filter(Boolean);
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    if (!fs.existsSync(current)) break;
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) throw new Error(`${label} path must not cross symlinks.`);
    const real = fs.realpathSync.native(current);
    if (!isPathInside(root, real)) throw new Error(`${label} real path must stay inside the project root.`);
  }
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
