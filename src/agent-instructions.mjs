import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagedSkillDir = path.join(repoRoot, 'skills', 'screenslop');
const allowedAgents = new Set(['codex', 'claude', 'cursor', 'generic']);

/**
 * Builds the agent-facing Screenslop bootstrap contract.
 *
 * @param {object} [options] Instruction options.
 * @param {string} [options.agent='generic'] Agent host name.
 * @param {string} [options.root=process.cwd()] Project root where the command runs.
 * @returns {object} Bootstrap payload with prompt text and local skill status.
 */
export function buildAgentInstructions(options = {}) {
  const agent = normalizeAgent(options.agent || 'generic');
  const root = path.resolve(options.root || process.cwd());
  const cli = readPackageInfo();
  const skill = inspectInstalledSkill({ agent, root });
  const commands = buildCommandLoop();
  const prompt = buildPrompt({ agent, commands });

  return {
    ok: true,
    command: 'instructions',
    agent,
    cli,
    skill,
    prompt,
    commands,
    stopRules: [
      'Use runtime evidence before critique when capture is available.',
      'Run setup as a dry run first and ask before writing private config.',
      'Do not commit .screenslop/config.json, screenshots, dogfood reports, or private artifacts.',
      'Do not claim a fix until fresh capture, fresh critique, and verify prove it.'
    ]
  };
}

/**
 * Prints the bootstrap contract as JSON or copyable text.
 *
 * @param {object} payload Bootstrap payload from buildAgentInstructions.
 * @param {boolean} json Whether to print JSON.
 * @returns {string} Printable output.
 */
export function formatAgentInstructions(payload, json = false) {
  if (json) return `${JSON.stringify(payload, null, 2)}\n`;

  return `Screenslop agent instructions\n\nAgent: ${payload.agent}\nCLI: ${payload.cli.name}@${payload.cli.version}\nSkill: ${payload.skill.status}${payload.skill.path ? ` (${payload.skill.path})` : ''}\n\n${payload.prompt}\n`;
}

/**
 * Normalizes supported agent names.
 *
 * @param {string} value Agent flag value.
 * @returns {string} Normalized agent name.
 */
function normalizeAgent(value) {
  const normalized = String(value || 'generic').trim().toLowerCase();
  return allowedAgents.has(normalized) ? normalized : 'generic';
}

/**
 * Reads package metadata without importing JSON at runtime.
 *
 * @returns {{name:string,version:string,packagePath:string}}
 */
function readPackageInfo() {
  const packagePath = path.join(repoRoot, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  return {
    name: pkg.name || 'screenslop',
    version: pkg.version || '0.0.0',
    packagePath: redactPath(packagePath)
  };
}

/**
 * Checks likely skill install locations for the selected agent.
 *
 * @param {object} options Skill inspection options.
 * @param {string} options.agent Agent host name.
 * @param {string} options.root Current app repo root.
 * @returns {object} Redacted skill status for agents.
 */
function inspectInstalledSkill(options) {
  const packagedHash = hashSkill(path.join(packagedSkillDir, 'SKILL.md'));
  const candidates = skillCandidates(options);
  const installed = [];

  for (const candidate of candidates) {
    const skillFile = path.join(candidate.path, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;
    const hash = hashSkill(skillFile);
    installed.push({
      scope: candidate.scope,
      path: redactPath(candidate.path, options.root),
      status: hash && packagedHash && hash === packagedHash ? 'same' : 'different'
    });
  }

  if (installed.length === 0) {
    return {
      status: 'missing',
      expected: candidates.map((candidate) => ({ scope: candidate.scope, path: redactPath(candidate.path, options.root) }))
    };
  }

  const best = installed.find((candidate) => candidate.status === 'same') || installed[0];
  return {
    status: best.status === 'same' ? 'installed' : 'installed-different',
    scope: best.scope,
    path: best.path,
    candidates: installed
  };
}

/**
 * Builds agent-specific skill path candidates.
 *
 * @param {object} options Candidate options.
 * @param {string} options.agent Agent host name.
 * @param {string} options.root Current app repo root.
 * @returns {{scope:string,path:string}[]} Candidate skill folders.
 */
function skillCandidates(options) {
  const home = os.homedir();
  const project = options.root;
  const generic = [
    { scope: 'project-generic', path: path.join(project, '.agents', 'skills', 'screenslop') },
    { scope: 'user-generic', path: path.join(home, '.agents', 'skills', 'screenslop') }
  ];

  if (options.agent === 'codex') {
    return [
      { scope: 'project-codex', path: path.join(project, '.codex', 'skills', 'screenslop') },
      { scope: 'user-codex', path: path.join(home, '.codex', 'skills', 'screenslop') },
      ...generic
    ];
  }

  if (options.agent === 'claude') {
    return [
      { scope: 'project-claude', path: path.join(project, '.claude', 'skills', 'screenslop') },
      { scope: 'user-claude', path: path.join(home, '.claude', 'skills', 'screenslop') },
      ...generic
    ];
  }

  if (options.agent === 'cursor') return generic;
  return generic;
}

/**
 * Hashes a skill file when readable.
 *
 * @param {string} file Skill file path.
 * @returns {string|null} SHA-256 digest, or null when unavailable.
 */
function hashSkill(file) {
  try {
    return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Builds the command loop agents should follow.
 *
 * @returns {string[]} Ordered Screenslop command loop.
 */
function buildCommandLoop() {
  return [
    'screenslop setup --json --dry-run',
    'screenslop doctor',
    'screenslop see --surface <surface> --boot --json',
    'screenslop critique artifacts/<baseline-run> --json',
    'screenslop fix artifacts/<baseline-run> --finding <id> --source-root <app-root> --apply --yes --label "<label>" --json',
    'screenslop see --surface <surface> --boot --json',
    'screenslop critique artifacts/<fresh-run> --json',
    'screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id> --fix-session artifacts/<baseline-run>/fix-session.json --json'
  ];
}

/**
 * Builds a copyable prompt for coding agents that do not auto-load the skill.
 *
 * @param {object} options Prompt options.
 * @param {string} options.agent Agent host name.
 * @param {string[]} options.commands Ordered command loop.
 * @returns {string} Prompt text.
 */
function buildPrompt(options) {
  return `Use the Screenslop skill for Apple UI review. If the skill is not auto-loaded, follow this contract exactly.\n\n` +
    `Screenslop is evidence-first. Capture runtime evidence before critique whenever capture is available. Do not replace Screenslop with source-only SwiftUI review.\n\n` +
    `First-use setup is private and dry-run-first. Run setup, show the planned config, and ask before writing .screenslop/config.json. Never commit private config or generated private artifacts.\n\n` +
    `Command loop:\n${options.commands.map((command) => `- ${command}`).join('\n')}\n\n` +
    `A fix is not proven by source edits or fix-session.json. Only fresh capture, fresh critique, and screenslop verify can prove a selected finding is fixed.`;
}

/**
 * Redacts local filesystem paths from agent-facing status.
 *
 * @param {string} value Path to redact.
 * @param {string} [root=process.cwd()] Project root.
 * @returns {string} Redacted path.
 */
function redactPath(value, root = process.cwd()) {
  const absolute = path.resolve(value);
  const projectRoot = path.resolve(root);
  const relative = path.relative(projectRoot, absolute);
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return path.join('<repo>', relative);
  }

  const home = os.homedir();
  if (home && (absolute === home || absolute.startsWith(`${home}${path.sep}`))) {
    return path.join('<home>', path.relative(home, absolute));
  }

  return '<absolute-path>';
}
