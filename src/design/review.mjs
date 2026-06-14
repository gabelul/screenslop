import fs from 'node:fs';
import path from 'node:path';
import { flattenAxTree } from '../critique/ax-tree.mjs';
import { createFinding, sortFindings, summarizeFindings } from '../critique/findings.mjs';
import { loadEvidenceBundle, displayPath } from '../critique/load-evidence.mjs';
import { writeCritiqueArtifacts } from '../critique/report.mjs';
import { collectDesignProfile, loadDesignProfile, resolveDesignProfilePath, resolveProjectContainedPath } from './profile.mjs';

const designKinds = new Set(['design', 'product-logic', 'profile-gap']);
const proofLevels = new Set(['runtime-informed', 'profile-informed', 'agent-judgment']);

/**
 * Adds design-aware review artifacts and optional findings to a critique result.
 *
 * @param {object} options Review options.
 * @param {string} options.root Project root.
 * @param {string} options.bundlePath Evidence bundle path.
 * @param {object} options.critiqueResult Deterministic critique result.
 * @param {string|null} [options.profilePath] Optional profile path override.
 * @param {boolean} [options.agentPacket] Whether to write agent packet artifacts.
 * @param {string|null} [options.importPath] Optional imported design findings path.
 * @param {boolean} [options.strictMissingProfile] Whether a missing profile should fail.
 * @returns {object} Updated critique result.
 */
export function collectDesignReview(options) {
  const root = path.resolve(options.root || process.cwd());
  const context = loadEvidenceBundle({ root, bundlePath: options.bundlePath });
  const profilePath = resolveDesignProfilePath(root, options.profilePath || undefined);
  const profileRead = loadDesignProfile(profilePath);
  const profileCheck = collectDesignProfile({ root, profilePath, check: true });
  if (options.strictMissingProfile && profileCheck.status === 'missing-profile') {
    throw new Error('missing-design-profile: run screenslop learn --json --dry-run, review the profile, then write with --write --yes.');
  }
  const localFindings = buildProfileFindings({ context, profileCheck });
  const importedFindings = options.importPath ? loadImportedDesignFindings({ root, importPath: options.importPath, context }) : [];
  const designFindings = sortFindings([...localFindings, ...importedFindings]);
  const allFindings = sortFindings([...(options.critiqueResult.findings || []), ...designFindings]);
  const summary = summarizeFindings(allFindings);
  const packet = options.agentPacket
    ? writeAgentPacket({ context, critiqueResult: options.critiqueResult, profile: profileRead.profile, profileCheck })
    : null;
  const written = writeCritiqueArtifacts(context, allFindings, summary, {
    designReview: {
      ran: true,
      profileStatus: profileCheck.status,
      importedFindings: importedFindings.length,
      localFindings: localFindings.length,
      agentPacket: Boolean(packet)
    }
  });

  return {
    ...options.critiqueResult,
    artifacts: {
      ...options.critiqueResult.artifacts,
      ...written,
      ...(packet ? { designPacketPath: packet.packetPath, designPromptPath: packet.promptPath } : {})
    },
    summary,
    findings: allFindings,
    design: {
      enabled: true,
      profilePath: displayPath(root, profilePath),
      profileStatus: profileCheck.status,
      importedFindings: importedFindings.length,
      localFindings: localFindings.length,
      packet: packet ? { path: packet.packetPath, promptPath: packet.promptPath } : null
    }
  };
}

/**
 * Builds profile freshness findings for design critique.
 *
 * @param {object} options Finding options.
 * @param {object} options.context Evidence context.
 * @param {object} options.profileCheck Profile check result.
 * @returns {object[]} Design findings.
 */
function buildProfileFindings(options) {
  const status = options.profileCheck.status;
  if (status === 'current') return [];

  const detailByStatus = {
    'missing-profile': 'No private design profile exists for this project yet.',
    stale: 'The private design profile source hash does not match the current project files.',
    'missing-sources': 'The private design profile references sources that are no longer present.',
    'read-failed': 'The private design profile could not be read.'
  };

  return [withDesignFields(createFinding({
    ruleId: `design.profile.${status || 'unavailable'}`,
    severity: status === 'missing-profile' ? 'P2' : 'P1',
    pillar: 'slop',
    title: 'Design profile needs attention',
    detail: detailByStatus[status] || 'The design profile is not current.',
    evidence: {
      artifact: options.context.manifestPathDisplay,
      note: `profileStatus=${status}`
    },
    suggestedFix: status === 'missing-profile'
      ? 'Run screenslop learn --json --dry-run, review the profile, then write with --write --yes.'
      : 'Run screenslop learn --refresh --json --dry-run, review the delta, then write with --write --yes.',
    verification: 'Run screenslop learn --check --json and confirm status is current.',
    confidence: 'high',
    effort: 'low',
    fingerprint: `${options.context.bundle}:${status}`
  }), {
    kind: 'profile-gap',
    proofLevel: 'profile-informed',
    requiresHumanReview: true,
    judgment: detailByStatus[status] || 'The profile needs review before subjective design claims.'
  })];
}

/**
 * Loads design findings produced by an agent or local reviewer.
 *
 * @param {object} options Import options.
 * @param {string} options.root Project root.
 * @param {string} options.importPath Import JSON path.
 * @param {object} options.context Evidence context.
 * @returns {object[]} Imported findings normalized to Screenslop schema.
 */
function loadImportedDesignFindings(options) {
  const file = resolveProjectContainedPath(options.root, options.importPath, 'Imported design findings');
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  const rawFindings = Array.isArray(payload) ? payload : payload.findings;
  if (!Array.isArray(rawFindings)) throw new Error('Imported design findings must be an array or an object with findings[].');

  return rawFindings.map((finding, index) => normalizeImportedFinding(finding, index, options.context, displayPath(options.root, file)));
}

/**
 * Normalizes one imported finding and preserves design fields.
 *
 * @param {object} input Raw finding.
 * @param {number} index Finding index.
 * @param {object} context Evidence context.
 * @param {string} importDisplayPath Display path for import file.
 * @returns {object} Screenslop finding.
 */
function normalizeImportedFinding(input, index, context, importDisplayPath) {
  if (!designKinds.has(input.kind)) throw new Error(`Imported design finding ${index} has unsupported kind: ${input.kind}`);
  if (!proofLevels.has(input.proofLevel)) throw new Error(`Imported design finding ${index} has unsupported proofLevel: ${input.proofLevel}`);

  const base = createFinding({
    ruleId: input.ruleId || `design.import.${input.kind}`,
    severity: input.severity || 'P2',
    pillar: input.pillar || (input.kind === 'product-logic' ? 'slop' : 'hierarchy'),
    title: input.title || 'Imported design finding',
    detail: input.detail || input.judgment || 'Imported design review finding.',
    evidence: {
      ...(input.evidence || {}),
      artifact: input.evidence?.artifact || importDisplayPath,
      note: input.evidence?.note || `Imported design finding for ${context.bundle}`
    },
    suggestedFix: input.suggestedFix || 'Review the design finding and make the smallest fitting UI change.',
    verification: input.verification || 'Recapture evidence and run a fresh design review.',
    confidence: input.confidence || 'medium',
    effort: input.effort || 'medium',
    fingerprint: input.id || JSON.stringify({ importDisplayPath, index, input })
  });

  return withDesignFields(base, {
    kind: input.kind,
    proofLevel: input.proofLevel,
    requiresHumanReview: input.requiresHumanReview !== false,
    profileRuleId: input.profileRuleId,
    judgment: input.judgment,
    alternatives: input.alternatives
  });
}

/**
 * Writes a design-review packet and prompt for a coding agent.
 *
 * @param {object} options Packet options.
 * @param {object} options.context Evidence context.
 * @param {object} options.critiqueResult Deterministic critique result.
 * @param {object|null} options.profile Loaded design profile.
 * @param {object} options.profileCheck Profile check result.
 * @returns {{packetPath:string,promptPath:string}} Display paths.
 */
function writeAgentPacket(options) {
  const packetPath = path.join(options.context.dir, 'design-review-packet.json');
  const promptPath = path.join(options.context.dir, 'design-review-prompt.md');
  const packet = buildAgentPacket(options);
  fs.writeFileSync(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
  fs.writeFileSync(promptPath, renderAgentPrompt(packet));
  return {
    packetPath: displayPath(options.context.root, packetPath),
    promptPath: displayPath(options.context.root, promptPath)
  };
}

/**
 * Builds an agent packet from evidence and profile context.
 *
 * @param {object} options Packet options.
 * @returns {object} Design review packet.
 */
function buildAgentPacket(options) {
  return {
    schemaVersion: 1,
    kind: 'design-review-packet',
    bundle: options.context.bundle,
    profileSummary: summarizeProfile(options.profile),
    profileStatus: options.profileCheck.status,
    screenshot: options.context.artifacts.screenshot.displayPath,
    accessibilitySummary: summarizeAccessibility(options.context),
    deterministicSummary: options.critiqueResult.summary,
    matrixCell: options.context.manifest.matrixCell || null,
    questions: [
      'Does the visual hierarchy match the project profile and captured screen goal?',
      'Does any visible badge, status, or copy contradict the product state?',
      'Does the screen drift from the app tone, spacing, typography, or component rules?',
      'Is this a measured defect, design recommendation, product-logic issue, or profile gap?'
    ],
    findings: [],
    outputSchema: {
      findingKind: ['design', 'product-logic', 'profile-gap'],
      proofLevel: ['runtime-informed', 'profile-informed', 'agent-judgment'],
      requiredFields: ['kind', 'proofLevel', 'severity', 'pillar', 'title', 'detail', 'judgment']
    }
  };
}

/**
 * Summarizes a private profile without copying project-specific rules into packets.
 * @param {object|null} profile Loaded design profile.
 * @returns {object} Redacted profile summary.
 */
function summarizeProfile(profile) {
  if (!profile) return { available: false };
  return {
    available: true,
    schemaVersion: profile.schemaVersion || null,
    platform: profile.project?.platform || null,
    sourceCount: Array.isArray(profile.sources) ? profile.sources.length : 0,
    tokenCounts: Object.fromEntries(Object.entries(profile.tokens || {}).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0])),
    componentCount: Array.isArray(profile.components) ? profile.components.length : 0,
    screenTypeCount: Array.isArray(profile.screenTypes) ? profile.screenTypes.length : 0,
    stateSemanticCount: Array.isArray(profile.stateSemantics) ? profile.stateSemantics.length : 0,
    reviewRuleCount: Array.isArray(profile.reviewRules) ? profile.reviewRules.length : 0,
    freshnessStatus: profile.freshness?.status || null
  };
}

/**
 * Renders the Markdown prompt paired with the packet.
 *
 * @param {object} packet Design review packet.
 * @returns {string} Prompt Markdown.
 */
function renderAgentPrompt(packet) {
  return `# Screenslop Design Review Packet\n\nBundle: ${packet.bundle}\n\nProfile status: ${packet.profileStatus}\n\nUse the packet JSON next to this prompt. Return only findings that fit the output schema. Keep subjective design judgment out of the deterministic verified-fixed lane.\n`;
}

/**
 * Summarizes the AX tree for packet-sized context.
 *
 * @param {object} context Evidence context.
 * @returns {object} Accessibility summary.
 */
function summarizeAccessibility(context) {
  if (!context.artifacts.accessibilityTree.exists) return { available: false, nodeCount: 0, labels: [] };
  const tree = JSON.parse(fs.readFileSync(context.artifacts.accessibilityTree.absolutePath, 'utf8'));
  const nodes = flattenAxTree(tree);
  const labels = nodes
    .map((node) => node.label || node.title || node.value)
    .filter((value) => typeof value === 'string' && value.trim())
    .slice(0, 20);
  return { available: true, nodeCount: nodes.length, labels };
}

/**
 * Adds optional design fields to a finding.
 *
 * @param {object} finding Base finding.
 * @param {object} fields Design fields.
 * @returns {object} Finding with design metadata.
 */
function withDesignFields(finding, fields) {
  return Object.fromEntries(Object.entries({ ...finding, ...fields }).filter(([, value]) => value !== undefined));
}
