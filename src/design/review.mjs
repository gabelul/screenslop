import fs from 'node:fs';
import path from 'node:path';
import { flattenAxTree } from '../critique/ax-tree.mjs';
import { createFinding, sortFindings, summarizeFindings } from '../critique/findings.mjs';
import { loadEvidenceBundle, displayPath } from '../critique/load-evidence.mjs';
import { loadScreenshotPixels } from '../critique/pixels.mjs';
import { writeCritiqueArtifacts } from '../critique/report.mjs';
import { collectDesignProfile, loadDesignProfile, resolveDesignProfilePath, resolveProjectContainedPath } from './profile.mjs';
import { detectTokenDrift } from './token-drift.mjs';

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
  const driftFindings = buildTokenDriftFindings({ context, profile: profileRead.profile });
  const importedFindings = options.importPath ? loadImportedDesignFindings({ root, importPath: options.importPath, context }) : [];
  const designFindings = sortFindings([...localFindings, ...driftFindings, ...importedFindings]);
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
 * Builds token-drift design findings by sampling the screenshot against learned profile colors.
 * Skips silently when the profile has no usable color tokens or pixels are unavailable
 * (fake fixture screenshots, sips-less machines) — the design lane must never fail critique.
 * @param {object} options Drift options.
 * @param {object} options.context Evidence context.
 * @param {object|null} options.profile Loaded design profile.
 * @returns {object[]} Design-lane drift findings.
 */
function buildTokenDriftFindings(options) {
  const screenshot = options.context.artifacts.screenshot;
  if (!options.profile || !screenshot?.exists) return [];

  const image = loadScreenshotPixels(screenshot.absolutePath);
  const items = detectTokenDrift({ profile: options.profile, image });

  return items.map((item) => withDesignFields(createFinding({
    ruleId: item.ruleId,
    severity: item.severity,
    pillar: 'color',
    title: item.title,
    detail: item.detail,
    evidence: {
      artifact: screenshot.displayPath || null,
      note: `screen=${item.screenColor} nearestToken=${item.nearestToken || 'none'} distance=${item.distance} share=${item.share}`
    },
    suggestedFix: 'Adopt the nearest learned token, or refresh the profile with screenslop learn --refresh --json --dry-run and review the delta.',
    verification: 'Recapture, rerun critique --design, and confirm the accent resolves to a learned token or the refreshed profile claims it.',
    confidence: item.confidence,
    effort: 'low',
    fingerprint: `token-drift:${item.ruleId}:${item.screenColor}:${item.nearestToken || 'none'}`
  }), {
    kind: item.kind,
    proofLevel: item.proofLevel,
    requiresHumanReview: true,
    judgment: item.detail
  }));
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
    personas: buildPersonaWalkthroughs(options.context),
    findings: [],
    outputSchema: {
      findingKind: ['design', 'product-logic', 'profile-gap'],
      proofLevel: ['runtime-informed', 'profile-informed', 'agent-judgment'],
      requiredFields: ['kind', 'proofLevel', 'severity', 'pillar', 'title', 'detail', 'judgment']
    }
  };
}

/**
 * Builds the five persona walkthroughs for the agent packet.
 *
 * Personas come from the Impeccable translation in docs/design-intelligence-sources.md:
 * each one is a review lens plus concrete questions the reviewing agent answers
 * against this screenshot and AX evidence. Answers come back as design,
 * product-logic, or profile-gap findings only — this is the judgment lane,
 * so no persona answer may claim a measured defect.
 *
 * @param {object} context Evidence context.
 * @returns {object[]} Persona entries with id, name, lens, and questions.
 */
function buildPersonaWalkthroughs(context) {
  const deviceName = context.manifest.runtime?.deviceName || null;
  const matrixLabel = context.manifest.matrixCell?.label || null;
  const deviceNote = deviceName ? ` on the captured ${deviceName}` : '';
  const cellNote = matrixLabel ? ` (matrix cell: ${matrixLabel})` : '';

  return [
    {
      id: 'first-launch',
      name: 'First-launch user',
      lens: 'Opens this screen with zero context; the next step has to be obvious without any prior knowledge.',
      questions: [
        'With zero context, what would you tap first on this screen? If that is not the intended primary action, return a design finding.',
        'Look at the AX action labels: does the screen ask a first-time user to pick between several equally plausible next steps? Report that confusion as a design finding, not a measured claim.',
        'Does any visible copy assume state or knowledge a first-launch user cannot have yet? Return a product-logic finding when the copy and the actual product state disagree.'
      ]
    },
    {
      id: 'one-handed',
      name: 'One-handed phone user',
      lens: `Holds the phone in one hand${deviceNote}${cellNote}; primary actions must sit within comfortable thumb reach.`,
      questions: [
        `Judging from the screenshot${deviceNote}, do the primary actions sit in the lower two-thirds of the screen where a thumb reaches? If not, return a design finding.`,
        'Are frequent actions clustered near screen corners or the top edge where one-handed use strains? Report reach problems as design findings — do not restate measured touch-target results.',
        'Would a stretch to reach the primary action risk an accidental tap on a destructive neighbor? Return that as a design finding with the risky pairing named.'
      ]
    },
    {
      id: 'voiceover-dynamic-type',
      name: 'VoiceOver + accessibility Dynamic Type user',
      lens: 'Navigates by VoiceOver and runs the largest accessibility Dynamic Type sizes; labels and layout must survive both.',
      questions: [
        'Read the AX labels in order: does the spoken sequence tell a coherent story of the screen, or would a VoiceOver user get lost? Return incoherent ordering or vague labels as a design finding.',
        'Which visible text would break the layout at accessibility Dynamic Type sizes — truncate, overlap, or push actions off screen? Return your judgment as a design finding; leave measured truncation to the deterministic detectors.',
        'If the profile summary shows no accessibility guidance for this screen type, return a profile-gap finding instead of guessing the project convention.'
      ]
    },
    {
      id: 'stress-content',
      name: 'Stress-content user',
      lens: 'Brings hostile real-world data: 40-character German labels, 9999 unread, names that never fit the mock.',
      questions: [
        'Which visible element would break first with a 40-character German label or a 9999 badge count? Return the weakest spot as a design finding.',
        'Does the layout rely on the short, tidy content shown in this capture — single-line titles, low counts, empty states never reached? Report that fragility as a design finding, not a measured claim.',
        'Does any count, badge, or status shown here stop making sense at extreme values? Return that as a product-logic finding.'
      ]
    },
    {
      id: 'muscle-memory',
      name: 'Muscle-memory user',
      lens: 'Uses the app daily and taps from habit; primary actions must stay where the rest of the app put them.',
      questions: [
        'Based on the profile summary and this screenshot, is the primary action where this app usually puts it? Return unexplained relocation as a design finding.',
        'Do component styles here match what a daily user expects from the rest of the app, or does this screen invent its own variants? Report drift as a design finding.',
        'If the profile summary lacks screen-type or component conventions to judge placement stability against, return a profile-gap finding naming what is missing.'
      ]
    }
  ];
}

/** @param {object} token Token record. @returns {boolean} True when safe to count as learned. */
function isTrustedProfileToken(token) {
  return token?.confidence === 'high' || token?.confidence === 'medium' || token?.extraction === 'manual';
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
    trustedTokenCounts: Object.fromEntries(Object.entries(profile.tokens || {}).map(([key, value]) => [key, Array.isArray(value) ? value.filter(isTrustedProfileToken).length : 0])),
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
 * Renders the Markdown prompt paired with the packet.
 *
 * @param {object} packet Design review packet.
 * @returns {string} Prompt Markdown.
 */
function renderAgentPrompt(packet) {
  return `# Screenslop Design Review Packet\n\nBundle: ${packet.bundle}\n\nProfile status: ${packet.profileStatus}\n\nUse the packet JSON next to this prompt. Answer the review questions and walk each persona in personas[] against the screenshot and AX summary. Return only findings that fit the output schema. Keep subjective design judgment out of the deterministic verified-fixed lane.\n`;
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
