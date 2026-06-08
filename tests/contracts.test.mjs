import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');
const cliCommands = ['init', 'doctor', 'see', 'critique', 'fix', 'matrix', 'verify', 'watch'];

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

  assert.deepEqual(advertised, cliCommands);

  for (const command of cliCommands) {
    assert.match(help, new RegExp(`\\n\\s*${command}\\s+`), `CLI help should list ${command}`);
  }
});

test('agent docs keep unavailable fallback and dogfood gates explicit', () => {
  const skill = readText('skills/screenslop/SKILL.md');
  const limitations = readText('docs/known-limitations.md');
  const checklist = readText('docs/release-checklist.md');

  assert.match(skill, /non-Baguette capture fallback is future work/);
  assert.match(skill, /verifyStatus: "verified-fixed"/);
  assert.match(skill, /sample app is not/i);
  assert.match(limitations, /private dogfood gate is not complete/i);
  assert.match(limitations, /not a substitute for a real app capture/i);
  assert.match(checklist, /summary\.freshCritiqueStatus: "passed"/);
  assert.match(checklist, /pathDisplayMode: "redacted"/);
});

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
