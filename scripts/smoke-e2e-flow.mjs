#!/usr/bin/env node
import { runFixtureE2EFlow } from '../tests/helpers/e2e-flow.mjs';

/**
 * Runs the fixture-backed end-to-end Screenslop smoke flow.
 * @returns {Promise<void>}
 */
async function main() {
  const mode = valueFor('--fresh-mode') || 'fixed';
  const result = await runFixtureE2EFlow({ freshMode: mode });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok || result.stages.some((stage) => !stage.ok)) process.exitCode = 1;
}

/**
 * Reads a simple `--flag value` CLI option.
 * @param {string} name Option name.
 * @returns {string|null} Option value.
 */
function valueFor(name) {
  const index = process.argv.indexOf(name);
  if (index === -1) return null;
  return process.argv[index + 1] || null;
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, command: 'e2e-flow', error: error.message }, null, 2));
  process.exitCode = 1;
});
