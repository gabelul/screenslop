import fs from 'node:fs';
import path from 'node:path';

const BLOCKED_DIRS = new Set(['.git', '.omx', 'node_modules', 'build', 'DerivedData', 'artifacts']);

/**
 * Detects Apple project metadata from a repository root without shelling out.
 *
 * @param {string} [root=process.cwd()] Project root to inspect.
 * @returns {object} Structured candidate metadata for setup planning.
 */
export function detectAppleProject(root = process.cwd()) {
  const projectRoot = fs.realpathSync.native(path.resolve(root));
  const entries = safeReaddir(projectRoot);
  const projects = findBundles(entries, '.xcodeproj');
  const workspaces = findBundles(entries, '.xcworkspace');
  const schemeSet = new Set();
  const bundleIds = new Set();

  for (const project of projects) {
    for (const scheme of readSchemes(path.join(projectRoot, project))) schemeSet.add(scheme);
    for (const bundleId of readBundleIds(path.join(projectRoot, project, 'project.pbxproj'))) bundleIds.add(bundleId);
  }

  for (const workspace of workspaces) {
    for (const scheme of readSchemes(path.join(projectRoot, workspace))) schemeSet.add(scheme);
  }

  const schemes = [...schemeSet].sort();
  const appBundleIds = [...bundleIds].filter(isAppBundleId).sort();
  const sourceRoots = detectSourceRoots(projectRoot, { projects, schemes });

  return {
    root: projectRoot,
    projects,
    workspaces,
    schemes,
    bundleIds: appBundleIds,
    sourceRoots,
    status: classifyDetection({ projects, workspaces, schemes, bundleIds: appBundleIds, sourceRoots })
  };
}

/**
 * Chooses setup defaults when detection and explicit overrides produce one safe answer.
 *
 * @param {object} detection Output from detectAppleProject.
 * @param {Record<string,string>} [overrides={}] CLI-provided values.
 * @returns {{ok:boolean,status:string,values:Record<string,string>,missing:string[],ambiguous:Record<string,string[]>,detection:object}}
 */
export function chooseSetupDefaults(detection, overrides = {}) {
  const values = cleanValues(overrides);
  const ambiguous = {};
  const missing = [];

  chooseTargetContainer(values, detection, ambiguous);
  chooseValue(values, 'scheme', detection.schemes, ambiguous);
  chooseValue(values, 'bundle-id', detection.bundleIds, ambiguous);
  chooseValue(values, 'source-root', detection.sourceRoots, ambiguous);

  if (!values.workspace && !values.project) missing.push('workspace-or-project');
  if (!values.scheme) missing.push('scheme');
  if (!values['bundle-id']) missing.push('bundle-id');
  if (!values['source-root']) missing.push('source-root');

  const unresolvedAmbiguity = Object.fromEntries(
    Object.entries(ambiguous).filter(([key]) => !values[key])
  );
  const ok = missing.length === 0 && Object.keys(unresolvedAmbiguity).length === 0;

  return {
    ok,
    status: ok ? 'ready' : 'needs-selection',
    values,
    missing,
    ambiguous: unresolvedAmbiguity,
    detection
  };
}

/**
 * Reads directory entries safely.
 *
 * @param {string} dir Directory path.
 * @returns {fs.Dirent[]} Directory entries, or an empty array.
 */
function safeReaddir(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

/**
 * Finds top-level Xcode bundle directories.
 *
 * @param {fs.Dirent[]} entries Directory entries.
 * @param {string} suffix Bundle suffix.
 * @returns {string[]} Sorted bundle directory names.
 */
function findBundles(entries, suffix) {
  return entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(suffix) && !BLOCKED_DIRS.has(entry.name))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Reads shared scheme names from an Xcode project or workspace bundle.
 *
 * @param {string} containerPath Xcode project/workspace bundle path.
 * @returns {string[]} Sorted scheme names.
 */
function readSchemes(containerPath) {
  const schemesDir = path.join(containerPath, 'xcshareddata', 'xcschemes');
  return safeReaddir(schemesDir)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.xcscheme'))
    .map((entry) => path.basename(entry.name, '.xcscheme'))
    .filter((scheme) => !isTestName(scheme))
    .sort();
}

/**
 * Reads app-looking bundle identifiers from an Xcode project file.
 *
 * @param {string} pbxprojPath Path to project.pbxproj.
 * @returns {string[]} Sorted bundle identifiers.
 */
function readBundleIds(pbxprojPath) {
  if (!fs.existsSync(pbxprojPath)) return [];
  const text = fs.readFileSync(pbxprojPath, 'utf8');
  const ids = new Set();
  for (const match of text.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*([^;\n]+);/g)) {
    const value = match[1].trim().replace(/^"|"$/g, '');
    if (value && !value.includes('$(')) ids.add(value);
  }
  return [...ids].sort();
}

/**
 * Detects likely source root folders for setup defaults.
 *
 * @param {string} root Project root.
 * @param {{projects:string[],schemes:string[]}} context Detection context.
 * @returns {string[]} Sorted source root candidates.
 */
function detectSourceRoots(root, context) {
  const candidates = new Set();
  const names = new Set([
    ...context.schemes,
    ...context.projects.map((project) => path.basename(project, '.xcodeproj'))
  ]);

  for (const name of names) {
    if (!name || isTestName(name)) continue;
    const candidate = path.join(root, name);
    if (isSafeSourceDir(root, candidate)) candidates.add(name);
  }

  return [...candidates].sort();
}

/**
 * Checks whether a source directory candidate is inside the root and not blocked.
 *
 * @param {string} root Project root.
 * @param {string} candidate Candidate directory.
 * @returns {boolean} True when usable as a source-root guess.
 */
function isSafeSourceDir(root, candidate) {
  if (!fs.existsSync(candidate) || !fs.statSync(candidate).isDirectory()) return false;
  const relative = path.relative(root, candidate);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return !relative.split(path.sep).some((part) => BLOCKED_DIRS.has(part));
}

/**
 * Classifies detection quality for agent-facing output.
 *
 * @param {object} candidates Candidate metadata.
 * @returns {string} Detection status label.
 */
function classifyDetection(candidates) {
  const hasTarget = candidates.projects.length + candidates.workspaces.length > 0;
  if (!hasTarget) return 'missing-project';
  const ambiguous = candidates.projects.length + candidates.workspaces.length > 1
    || [candidates.projects, candidates.workspaces, candidates.schemes, candidates.bundleIds, candidates.sourceRoots]
    .some((items) => items.length > 1);
  return ambiguous ? 'ambiguous' : 'single-match';
}

/**
 * Copies non-empty override values.
 *
 * @param {Record<string,string>} overrides CLI override map.
 * @returns {Record<string,string>} Clean value map.
 */
function cleanValues(overrides) {
  return Object.fromEntries(
    Object.entries(overrides).filter(([, value]) => typeof value === 'string' && value.trim() !== '')
  );
}

/**
 * Chooses one Xcode container, or records ambiguity when multiple are present.
 *
 * @param {Record<string,string>} values Mutable value map.
 * @param {object} detection Detection payload with project/workspace candidates.
 * @param {Record<string,string[]>} ambiguous Mutable ambiguity map.
 * @returns {void}
 */
function chooseTargetContainer(values, detection, ambiguous) {
  if (values.workspace || values.project) return;

  const candidates = [
    ...detection.workspaces.map((workspace) => ({ key: 'workspace', value: workspace })),
    ...detection.projects.map((project) => ({ key: 'project', value: project }))
  ];

  if (candidates.length === 1) {
    values[candidates[0].key] = candidates[0].value;
  } else if (candidates.length > 1) {
    ambiguous['workspace-or-project'] = candidates.map((candidate) => candidate.value);
  }
}

/**
 * Chooses a scalar value when there is exactly one candidate.
 *
 * @param {Record<string,string>} values Mutable value map.
 * @param {string} key Value key.
 * @param {string[]} candidates Candidate values.
 * @param {Record<string,string[]>} ambiguous Mutable ambiguity map.
 * @returns {void}
 */
function chooseValue(values, key, candidates, ambiguous) {
  if (values[key]) return;
  if (candidates.length === 1) values[key] = candidates[0];
  else if (candidates.length > 1) ambiguous[key] = candidates;
}

/**
 * Returns whether a name looks like a test target/scheme.
 *
 * @param {string} value Candidate name.
 * @returns {boolean} True for test-like names.
 */
function isTestName(value) {
  return /(?:UITests|Tests)$/.test(value) || /(?:^|[._-])(?:ui)?tests$/i.test(value);
}

/**
 * Returns whether a bundle ID looks like the app target rather than a test bundle.
 *
 * @param {string} bundleId Bundle identifier.
 * @returns {boolean} True for app-like bundle identifiers.
 */
function isAppBundleId(bundleId) {
  return !isTestName(bundleId.split('.').at(-1) || bundleId);
}
