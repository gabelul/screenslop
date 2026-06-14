import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const engineContract = readJson('docs/engine-contract.json');

test('public JSON examples keep the agent-facing command shape', () => {
  const expectations = {
    'see.json': ['ok', 'command', 'runtime', 'runId', 'dir', 'evidence', 'artifacts'],
    'critique.json': ['ok', 'command', 'bundle', 'summary', 'findings'],
    'fix.json': ['ok', 'command', 'bundle', 'summary', 'artifacts'],
    'verify.json': ['ok', 'command', 'baselineBundle', 'freshBundle', 'summary', 'items'],
    'matrix.json': ['ok', 'command', 'runId', 'profile', 'summary', 'cells', 'artifacts']
  };

  for (const [file, requiredKeys] of Object.entries(expectations)) {
    const payload = readJson(`examples/json/${file}`);
    assert.equal(payload.ok, true, `${file} should be a successful example`);
    assert.equal(payload.command, path.basename(file, '.json'));

    for (const key of requiredKeys) {
      assert.ok(Object.hasOwn(payload, key), `${file} is missing ${key}`);
    }
  }

  const verify = readJson('examples/json/verify.json');
  assert.equal(verify.items[0].status, 'verified-fixed');

  const matrix = readJson('examples/json/matrix.json');
  assert.equal(matrix.profile.schemaVersion, 1);
  assert.equal(matrix.profile.cells, 6);
  assert.equal(matrix.cells[0].status, 'unavailable');
});

test('public schemas accept shipped examples and fixture evidence', () => {
  validateAgainstSchema(
    readJson('tests/fixtures/evidence/problem/evidence.json'),
    readJson('schemas/evidence.schema.json')
  );
  validateAgainstSchema(readJson('examples/json/matrix.json'), readJson('schemas/matrix-report.schema.json'));
  validateAgainstSchema(readJson('examples/design-profile/minimal.json'), readJson('schemas/design-profile.schema.json'));
  validateAgainstSchema(readJson('examples/json/design-review-packet.json'), readJson('schemas/design-review.schema.json'));

  const findingSchema = readJson('schemas/finding.schema.json');
  validateAgainstSchema(
    {
      id: 'ax-missing-name-example',
      ruleId: 'ax.missing-name',
      severity: 'P1',
      pillar: 'accessibility',
      title: 'Interactive element has no accessible name',
      detail: 'The button is focusable but has no usable accessibility name.',
      evidence: {
        artifact: 'artifacts/example/accessibility.json',
        sourceHint: 'settings.saveButton'
      },
      suggestedFix: 'Add a specific accessibility label.',
      verification: 'Recapture and verify the AX node has a meaningful label.',
      confidence: 'high',
      effort: 'low'
    },
    findingSchema
  );
  validateAgainstSchema(
    {
      id: 'design-weak-primary-action-example',
      ruleId: 'design.cta.weak-primary-action',
      severity: 'P2',
      pillar: 'hierarchy',
      title: 'Primary action is visually weak',
      detail: 'The captured screen makes the secondary action feel stronger than the intended primary action.',
      evidence: {
        artifact: 'artifacts/example-settings/design-review-packet.json',
        sourceHint: 'SettingsView.primaryCTA',
        note: 'Runtime-informed design judgment from the design profile.'
      },
      suggestedFix: 'Make the primary CTA visually dominant and keep secondary actions quieter.',
      verification: 'Recapture the screen and run a fresh design review against the same profile rule.',
      confidence: 'medium',
      effort: 'medium',
      kind: 'design',
      proofLevel: 'profile-informed',
      requiresHumanReview: true,
      profileRuleId: 'design.cta.weak-primary-action',
      judgment: 'The hierarchy does not match the profile expectation for a single obvious primary action.',
      alternatives: ['Move the secondary action below the primary CTA.', 'Use a quieter secondary button style.']
    },
    findingSchema
  );
});

test('design intelligence contracts are documented without overclaiming shipped CLI support', () => {
  const pkg = readJson('package.json');
  const readme = readText('README.md');
  const commands = readText('docs/commands.md');
  const integrations = readText('docs/agent-integrations.md');
  const playbook = readText('docs/agent-playbook.md');
  const skill = readText('skills/screenslop/SKILL.md');
  const limitations = readText('docs/known-limitations.md');
  const checklist = readText('docs/release-checklist.md');
  const designDoc = readText('docs/design-intelligence.md');
  const profileDoc = readText('docs/design-profile-format.md');
  const gitignore = fileExists('.gitignore') ? readText('.gitignore') : '';

  for (const requiredFile of [
    'docs/design-intelligence.md',
    'docs/design-profile-format.md',
    'examples/design-profile/'
  ]) {
    assert.ok(pkg.files.includes(requiredFile), `${requiredFile} must ship in npm package`);
  }

  assert.match(designDoc, /--design-profile/);
  assert.match(designDoc, /agent-packet/);
  assert.match(designDoc, /Only measured findings can become `verified-fixed` automatically/);
  assert.match(profileDoc, /\.screenslop\/design-profile\.json/);
  assert.match(profileDoc, /refresh/i);
  if (gitignore) {
    assert.match(gitignore, /\.screenslop\/design-profile\.json/);
  }

  assert.match(readme, /Design Intelligence \(planned\)/);
  assert.match(readme, /`screenslop learn` \| Future/);
  assert.match(commands, /Design Intelligence command boundary/);
  assert.match(commands, /planned, not shipped/);
  assert.match(commands, /--agent-packet/);
  assert.match(integrations, /Design profile integration boundary/);
  assert.match(integrations, /agent packet/);
  assert.match(playbook, /Design Intelligence when shipped/);
  assert.match(playbook, /Do not run these as proof until the CLI help exposes the design commands/);
  assert.match(skill, /Design Intelligence planned path/);
  assert.match(skill, /Do not invent command support/);
  assert.match(limitations, /Design Intelligence is not shipped yet/);
  assert.match(checklist, /Design Intelligence contract checks/);
  assert.match(checklist, /examples\/design-profile\/minimal\.json/);
});

test('public schemas reject malformed evidence, findings, and matrix reports', () => {
  const evidenceSchema = readJson('schemas/evidence.schema.json');
  const findingSchema = readJson('schemas/finding.schema.json');
  const matrixSchema = readJson('schemas/matrix-report.schema.json');

  assert.throws(
    () => validateAgainstSchema({ ...readJson('tests/fixtures/evidence/problem/evidence.json'), runtime: {} }, evidenceSchema),
    /runtime\.driver/
  );

  assert.throws(
    () =>
      validateAgainstSchema(
        {
          id: 'bad-finding',
          ruleId: 'ax.bad',
          severity: 'P9',
          pillar: 'accessibility',
          title: 'Bad',
          detail: 'Bad',
          evidence: {},
          suggestedFix: 'Fix it',
          verification: 'Check it',
          confidence: 'high',
          effort: 'low'
        },
        findingSchema
      ),
    /severity/
  );

  const badMatrix = { ...readJson('examples/json/matrix.json'), command: 'matrx' };
  assert.throws(() => validateAgainstSchema(badMatrix, matrixSchema), /command/);
});

test('CLI help and Screenslop skill advertise the same command set', () => {
  const help = runCliHelp();
  const skill = readText('skills/screenslop/SKILL.md');
  const advertised = extractSkillCommands(skill);

  assert.deepEqual(advertised, engineContract.commands);

  for (const command of engineContract.commands) {
    assert.match(help, new RegExp(`\\n\\s*${command}\\s+`), `CLI help should list ${command}`);
  }
});

test('agent docs keep unavailable fallback and dogfood gates explicit', () => {
  const skill = readText('skills/screenslop/SKILL.md');
  const limitations = readText('docs/known-limitations.md');
  const checklist = readText('docs/release-checklist.md');

  assert.equal(engineContract.schemaVersion, 1);
  assert.deepEqual(engineContract.blockerOutcomes, ['passed', 'recorded-blocker', 'blocked']);
  assert.equal(engineContract.outcomeSemantics.status, 'workflow-state');
  assert.equal(engineContract.outcomeSemantics.outcome, 'proof-state');
  assert.match(skill, /non-Baguette capture fallback is future work/);
  assert.match(skill, /verifyStatus: "verified-fixed"/);
  assert.match(skill, /sample app is not/i);
  assert.match(limitations, /private dogfood gate outcome is `recorded-blocker`/i);
  assert.match(limitations, /not a substitute for a real app capture/i);
  assert.match(checklist, /summary\.freshCritiqueStatus: "passed"/);
  assert.match(checklist, /pathDisplayMode: "redacted"/);
  assert.match(checklist, /recorded-blocker/);
});

test('screenslop instructions prints a self-contained agent contract', () => {
  const result = spawnSync(process.execPath, [
    'bin/screenslop.mjs',
    'instructions',
    '--agent',
    'codex',
    '--json'
  ], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.equal(result.stdout.includes(repoRoot), false);
  const payload = JSON.parse(result.stdout);

  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'instructions');
  assert.equal(payload.agent, 'codex');
  assert.equal(payload.cli.name, 'screenslop');
  assert.match(payload.cli.packagePath, /^<repo>/);
  assert.match(payload.prompt, /Use the Screenslop skill/);
  assert.match(payload.prompt, /Do not replace Screenslop with source-only SwiftUI review/);
  assert.match(payload.prompt, /fresh capture, fresh critique, and screenslop verify/);
  assert.ok(payload.commands.includes('screenslop setup --json --dry-run'));
  assert.ok(payload.commands.some((command) => command.startsWith('screenslop verify ')));
  assert.ok(['missing', 'installed', 'installed-different'].includes(payload.skill.status));

  const alias = spawnSync(process.execPath, ['bin/screenslop.mjs', 'agent-bootstrap', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.equal(alias.status, 0, alias.stderr || alias.stdout);
  assert.equal(JSON.parse(alias.stdout).command, 'instructions');
});


test('agent playbook stays aligned with shipped command and dogfood contracts', () => {
  const playbook = readText('docs/agent-playbook.md');
  const advertised = extractScreenslopCommands(playbook);

  for (const command of advertised) {
    assert.ok(engineContract.commands.includes(command), `playbook advertises unshipped command ${command}`);
  }

  assert.match(playbook, /Do not critique Apple UI from source alone when runtime evidence can be captured/);
  assert.match(playbook, /`screenslop verify` needs a fresh bundle/);
  assert.match(playbook, /It proves the public sample app loop\. It does not prove a private app/);
  assert.match(playbook, /summary\.verifyStatus: "verified-fixed"/);
  assert.match(playbook, /pathDisplayMode: "redacted"/);
  assert.match(playbook, /check-dogfood-redaction\.mjs/);
});

test('skill installation docs keep CLI, skill, and private config separate', () => {
  const readme = readText('README.md');
  const playbook = readText('docs/agent-playbook.md');
  const install = readText('docs/skill-installation.md');
  const skill = readText('skills/screenslop/SKILL.md');
  const installRef = readText('skills/screenslop/reference/install.md');
  const integrations = readText('docs/agent-integrations.md');
  const pkg = readJson('package.json');

  assert.ok(pkg.files.includes('docs/skill-installation.md'), 'install doc must ship in npm package');
  assert.ok(pkg.files.includes('skills/'), 'skill directory must ship in npm package');

  assert.match(readme, /docs\/skill-installation\.md/);
  assert.match(playbook, /docs\/skill-installation\.md/);
  assert.match(skill, /reference\/install\.md/);
  assert.match(installRef, /The Screenslop skill is an instruction layer\. The CLI must also be installed\./);

  for (const ref of [
    'reference/install.md',
    'reference/agent-contract.md',
    'reference/project-setup.md',
    'reference/runtime.md',
    'reference/dogfood.md'
  ]) {
    assert.ok(fs.existsSync(path.join(repoRoot, 'skills/screenslop', ref)), `${ref} must exist inside the installed skill folder`);
    assert.match(skill, new RegExp(ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.doesNotMatch(skill, /skills\/screenslop\/reference/);

  assert.match(install, /Screenslop has two separate pieces/);
  assert.match(install, /npx skills add gabelul\/screenslop --list/);
  assert.match(install, /npx skills add gabelul\/screenslop --skill screenslop/);
  assert.match(install, /~\/\.codex\/skills\/screenslop/);
  assert.match(install, /~\/\.claude\/skills\/screenslop/);
  assert.match(install, /~\/\.agents\/skills\/screenslop/);
  assert.match(install, /\.screenslop\/config\.json/);
  assert.match(install, /do not commit it/i);
  assert.match(install, /live `screenslop see` capture still needs Baguette/);
  assert.match(install, /A sample app smoke proves the sample app only/);
  assert.match(install, /--config \/path\/to\/private-app\/\.screenslop\/config\.json/);
  assert.match(install, /verifyStatus: "verified-fixed"/);

  const projectSetup = readText('skills/screenslop/reference/project-setup.md');
  for (const [label, text] of [
    ['skill', skill],
    ['install doc', install],
    ['playbook', playbook],
    ['getting started', readText('docs/getting-started.md')],
    ['commands', readText('docs/commands.md')],
    ['project setup reference', projectSetup],
  ]) {
    const dryRunIndex = text.indexOf('setup --json --dry-run');
    const yesIndex = text.indexOf('setup --json --yes');
    assert.notEqual(dryRunIndex, -1, `${label} must document setup dry-run first`);
    assert.ok(yesIndex === -1 || dryRunIndex < yesIndex, `${label} must mention setup dry-run before setup --yes`);
    assert.match(text, /Setup is configuration only|setup is configuration only|proof starts/i, `${label} must not treat setup as proof`);
  }

  for (const [label, text] of [
    ['install doc', install],
    ['playbook', playbook],
    ['skill', skill],
    ['install reference', installRef],
    ['project setup reference', projectSetup],
    ['dogfood reference', readText('skills/screenslop/reference/dogfood.md')],
    ['getting started', readText('docs/getting-started.md')],
    ['commands', readText('docs/commands.md')],
    ['release checklist', readText('docs/release-checklist.md')],
  ]) {
    assert.doesNotMatch(text, /--config \.screenslop\/config\.json/, `${label} must not imply private config resolves from the Screenslop repo`);
  }

  assert.doesNotMatch(install, /npx skills add[^\n]+creates? `?\.screenslop\/config\.json`?/i);
  assert.match(skill, /reference\/project-setup\.md/);

  assert.match(integrations, /Pixeltamer generates and edits images/);
  assert.match(integrations, /Pixelslop is the browser\/web visual QA sibling/);
  assert.match(integrations, /Stitch Kit helps agents design and convert UI/);
  assert.match(integrations, /Slopbuster cleans prose/);
  assert.match(integrations, /Claude Code Skill Activator can index the Screenslop skill/);
  assert.match(integrations, /not replace the capture -> critique -> fix -> fresh capture -> verify loop/);
});

test('Baguette farm docs ship with the operator-surface proof boundary', () => {
  const pkg = readJson('package.json');
  const farm = readText('docs/baguette-farm.md');
  const gettingStarted = readText('docs/getting-started.md');
  const playbook = readText('docs/agent-playbook.md');
  const skill = readText('skills/screenslop/SKILL.md');
  const runtimeRef = readText('skills/screenslop/reference/runtime.md');
  const commands = readText('docs/commands.md');
  const integrations = readText('docs/agent-integrations.md');
  const limitations = readText('docs/known-limitations.md');

  assert.ok(pkg.files.includes('docs/baguette-farm.md'), 'Baguette farm doc must ship in npm package');
  assert.ok(fs.existsSync(path.join(repoRoot, 'docs/baguette-farm.md')), 'Baguette farm doc must exist');

  for (const [label, text] of [
    ['getting started', gettingStarted],
    ['agent playbook', playbook],
    ['skill', skill],
    ['runtime reference', runtimeRef],
    ['commands', commands],
    ['agent integrations', integrations]
  ]) {
    assert.match(text, /docs\/baguette-farm\.md|Baguette farm/i, `${label} must point to the farm boundary`);
  }

  assert.match(skill, /reference\/runtime\.md/);
  assert.match(farm, /baguette serve/);
  assert.match(farm, /http:\/\/localhost:8421\/farm/);
  assert.match(farm, /GET \/simulators\.json/);
  assert.match(farm, /small, normal, and large iPhones/i);
  assert.match(farm, /farm is not Screenslop proof/i);
  assert.match(farm, /Screenslop proof is still the bundle/i);
  assert.match(commands, /does not ship a `--open-farm` command/);
  assert.match(integrations, /observation only/);
  assert.match(limitations, /does not start or open Baguette farm automatically/);
});

test('phone-size matrix profile teaches agents headless mobile checks', () => {
  const profile = readJson('examples/matrix/phone-sizes.json');
  const readme = readText('README.md');
  const commands = readText('docs/commands.md');
  const playbook = readText('docs/agent-playbook.md');
  const skill = readText('skills/screenslop/SKILL.md');
  const farm = readText('docs/baguette-farm.md');
  const runtimeRef = readText('skills/screenslop/reference/runtime.md');

  assert.equal(profile.schemaVersion, 1);
  assert.equal(profile.name, 'phone-size-check');
  assert.deepEqual(profile.cells.map((cell) => cell.id), ['small-iphone', 'normal-iphone', 'large-iphone']);
  assert.deepEqual(profile.cells.map((cell) => cell.device), ['iPhone 17e', 'iPhone 17', 'iPhone 17 Pro']);

  for (const [label, text] of [
    ['README', readme],
    ['commands', commands],
    ['agent playbook', playbook],
    ['skill', skill],
    ['farm doc', farm],
    ['runtime reference', runtimeRef]
  ]) {
    assert.match(text, /examples\/matrix\/phone-sizes\.json/, `${label} must mention the phone-size matrix profile`);
  }

  assert.match(commands, /Agents do not need the farm for headless checks/);
  assert.match(commands, /layout-sensitive UI work done/);
  assert.match(playbook, /copy `examples\/matrix\/phone-sizes\.json`, replace only the `device` values/);
  assert.match(playbook, /Do not call layout-sensitive UI work done until the phone-size matrix has passed/);
  assert.match(skill, /small \/ normal \/ large phone checks/);
  assert.match(skill, /Before calling layout-sensitive UI work done/);
  assert.match(runtimeRef, /Run that matrix before calling layout-sensitive SwiftUI or Apple UI work done/);
});

test('public docs credit current dependencies without banned legacy references', () => {
  const readme = readText('README.md');
  const notice = readText('NOTICE');

  assert.match(readme, /## Acknowledgements/);
  assert.match(readme, /Baguette/);
  assert.match(readme, /XcodeBuildMCP/);
  assert.match(readme, /Pixelslop/);
  assert.match(notice, /Baguette: https:\/\/github\.com\/tddworks\/baguette/);
  assert.match(notice, /XcodeBuildMCP: https:\/\/github\.com\/cameroncooke\/XcodeBuildMCP/);

  const bannedLegacyReference = new RegExp(['imp', 'eccable'].join(''), 'i');

  const shippedDocs = [
    ['README', readme],
    ['NOTICE', notice],
    ['commands', readText('docs/commands.md')]
  ];
  const repoOnlyDocs = [
    ['research workspace', 'docs/research-workspace.md'],
    ['research adoptions', 'docs/research-adoptions.md']
  ];

  for (const [label, pathName] of repoOnlyDocs) {
    if (fileExists(pathName)) shippedDocs.push([label, readText(pathName)]);
  }

  for (const [label, text] of shippedDocs) {
    assert.doesNotMatch(text, bannedLegacyReference, `${label} must not mention banned legacy reference`);
  }
});

test('readiness gate contract is reflected in release docs', () => {
  const checklist = readText('docs/release-checklist.md');
  const handoff = readText('docs/session-handoff.md');

  assert.equal(engineContract.readinessGates.length, 8);
  assert.equal(engineContract.releaseDecision.noTagWhen, 'private-dogfood-is-recorded-blocker-or-blocked');

  for (const gate of engineContract.readinessGates) {
    assert.ok(gate.id && gate.label, 'each readiness gate needs an id and label');
  }

  assert.match(checklist, /docs\/engine-contract\.json/);
  assert.match(checklist, /`status` is workflow state/);
  assert.match(handoff, /recorded-blocker/);
});

test('release workflow opens Release Please PRs and publishes to npm', (t) => {
  if (!fileExists('.github/workflows/release.yml')) {
    t.skip('release workflow is repository-only and is not shipped in the npm package');
    return;
  }

  const releaseWorkflow = readText('.github/workflows/release.yml');
  const releaseConfig = readJson('release-please-config.json');
  const releaseManifest = readJson('.release-please-manifest.json');
  const checklist = readText('docs/release-checklist.md');

  assert.match(releaseWorkflow, /googleapis\/release-please-action/);
  assert.match(releaseWorkflow, /release-please-config\.json/);
  assert.match(releaseWorkflow, /\.release-please-manifest\.json/);
  assert.match(releaseWorkflow, /id-token: write/);
  assert.match(releaseWorkflow, /environment: npm/);
  assert.match(releaseWorkflow, /package-manager-cache: false/);
  assert.match(releaseWorkflow, /npm publish --provenance --access public/);
  assert.match(releaseWorkflow, /release_created == 'true'/);
  assert.match(releaseWorkflow, /workflow_dispatch/);
  assert.equal(releaseConfig.packages['.']['release-type'], 'node');
  assert.equal(releaseConfig.packages['.']['include-component-in-tag'], false);
  assert.equal(releaseManifest['.'], readJson('package.json').version);
  assert.match(checklist, /Release Please opens a release PR/);
  assert.match(checklist, /trusted publisher/);
});

/**
 * Extracts Screenslop command names used in shell snippets.
 *
 * @param {string} text Markdown text.
 * @returns {string[]} Unique command names.
 */
function extractScreenslopCommands(text) {
  const commands = new Set();
  for (const match of text.matchAll(/(?:^|\s)(?:node bin\/screenslop\.mjs|screenslop)\s+([a-z][a-z-]*)/gm)) {
    commands.add(match[1]);
  }
  return [...commands].sort();
}

/**
 * Reads a repository-local JSON file.
 *
 * @param {string} relativePath Repo-relative JSON path.
 * @returns {object} Parsed JSON payload.
 */
function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

/**
 * Reads a repository-local text file.
 *
 * @param {string} relativePath Repo-relative text path.
 * @returns {string} File contents.
 */
function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

/**
 * Checks if a repository-local path exists before reading optional repo-only files.
 *
 * @param {string} relativePath Repo-relative path.
 * @returns {boolean} True when the path exists.
 */
function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

/**
 * Runs the side-effect-free top-level CLI help command.
 *
 * @returns {string} Help output.
 */
function runCliHelp() {
  const result = spawnSync(process.execPath, ['bin/screenslop.mjs', 'help'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return result.stdout;
}

/**
 * Extracts the documented command names from the Screenslop agent skill.
 *
 * @param {string} skill Skill markdown.
 * @returns {string[]} Command names in documented order.
 */
function extractSkillCommands(skill) {
  const matches = [...skill.matchAll(/^- `([^`]+)`: /gm)];
  return matches.map((match) => match[1]);
}

/**
 * Validates the subset of JSON Schema that Screenslop's public contracts use.
 *
 * This deliberately stays tiny so the test suite has no validator dependency.
 * It checks the rules we publish today: required keys, primitive/object/array
 * types, enum, const, object properties, and array item schemas.
 *
 * @param {unknown} value Payload to validate.
 * @param {object} schema JSON schema object.
 * @param {string} location Human-readable path for assertion errors.
 * @returns {void}
 */
function validateAgainstSchema(value, schema, location = '$') {
  if (schema.const !== undefined) {
    assert.equal(value, schema.const, `${location} should equal ${JSON.stringify(schema.const)}`);
  }

  if (schema.enum) {
    assert.ok(schema.enum.includes(value), `${location} should be one of ${schema.enum.join(', ')}`);
  }

  if (schema.type) {
    const allowedTypes = Array.isArray(schema.type) ? schema.type : [schema.type];
    assert.ok(
      allowedTypes.some((type) => matchesJsonType(value, type)),
      `${location} should be ${allowedTypes.join(' or ')}`
    );
  }

  if (schema.required) {
    for (const key of schema.required) {
      assert.ok(value && Object.hasOwn(value, key), `${location}.${key} is required`);
    }
  }

  if (schema.properties && value && typeof value === 'object' && !Array.isArray(value)) {
    for (const [key, childSchema] of Object.entries(schema.properties)) {
      if (Object.hasOwn(value, key)) {
        validateAgainstSchema(value[key], childSchema, `${location}.${key}`);
      }
    }
  }

  if (schema.items && Array.isArray(value)) {
    value.forEach((item, index) => validateAgainstSchema(item, schema.items, `${location}[${index}]`));
  }
}

/**
 * Checks a JavaScript value against a JSON Schema primitive type name.
 *
 * @param {unknown} value Value to inspect.
 * @param {string} type JSON Schema type.
 * @returns {boolean} True when the value matches the type.
 */
function matchesJsonType(value, type) {
  if (type === 'array') return Array.isArray(value);
  if (type === 'null') return value === null;
  if (type === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  if (type === 'number') return typeof value === 'number';
  if (type === 'boolean') return typeof value === 'boolean';
  if (type === 'string') return typeof value === 'string';
  return false;
}
