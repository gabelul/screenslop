import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

import {
  DESIGN_PROFILE_SCHEMA_VERSION,
  defaultDesignProfilePath,
  designFindingKinds,
  designProofLevels,
  isDesignFindingKind,
  isDesignProofLevel
} from '../src/design/index.mjs';

test('design intelligence module exposes a separate boundary', () => {
  assert.equal(DESIGN_PROFILE_SCHEMA_VERSION, 1);
  assert.equal(defaultDesignProfilePath(), '.screenslop/design-profile.json');
  assert.deepEqual(designFindingKinds, ['design', 'product-logic', 'profile-gap']);
  assert.deepEqual(designProofLevels, ['runtime-informed', 'profile-informed', 'agent-judgment']);
});

test('design intelligence helpers reject measured proof concepts', () => {
  assert.equal(isDesignFindingKind('design'), true);
  assert.equal(isDesignFindingKind('measured'), false);
  assert.equal(isDesignProofLevel('profile-informed'), true);
  assert.equal(isDesignProofLevel('measured'), false);
});

test('deterministic critique does not import design intelligence, transitively', () => {
  // This used to read collect-critique.mjs as a single string, which said
  // nothing about what its detectors import. A detector reaching into the
  // design lane passed the check while breaking the boundary it named.
  const critiqueRoot = new URL('../src/critique/', import.meta.url);
  const visited = new Set();
  const offenders = [];

  /**
   * Walks the import graph from one module, staying inside src/.
   * @param {URL} moduleUrl Module to inspect.
   * @param {string[]} trail Import chain that reached it.
   * @returns {void}
   */
  function walk(moduleUrl, trail) {
    const key = moduleUrl.pathname;
    if (visited.has(key)) return;
    visited.add(key);

    // Static imports are not the only edge into another lane: `export … from`
    // and dynamic `import()` both create one while a plain import scan stays
    // quiet. Match every form that can pull a module in.
    const source = fs.readFileSync(moduleUrl, 'utf8');
    const patterns = [
      /^\s*import\s[^'"]*['"]([^'"]+)['"]/gm,
      /^\s*export\s[^'"]*\sfrom\s*['"]([^'"]+)['"]/gm,
      /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
    ];
    for (const match of patterns.flatMap((pattern) => [...source.matchAll(pattern)])) {
      const specifier = match[1];
      if (!specifier.startsWith('.')) continue;
      const resolved = new URL(specifier, moduleUrl);
      const chain = [...trail, specifier];
      if (resolved.pathname.includes('/src/design/')) {
        offenders.push(`${trail[0]} -> ${chain.join(' -> ')}`);
        continue;
      }
      walk(resolved, chain);
    }
  }

  for (const entry of fs.readdirSync(critiqueRoot).filter((name) => name.endsWith('.mjs'))) {
    walk(new URL(entry, critiqueRoot), [`src/critique/${entry}`]);
  }
  for (const entry of fs.readdirSync(new URL('detectors/', critiqueRoot)).filter((name) => name.endsWith('.mjs'))) {
    walk(new URL(`detectors/${entry}`, critiqueRoot), [`src/critique/detectors/${entry}`]);
  }

  assert.deepEqual(offenders, [], `deterministic critique reaches the design lane:\n${offenders.join('\n')}`);
});

test('default design profile stays private by git default', () => {
  const result = spawnSync('git', ['check-ignore', defaultDesignProfilePath()], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8'
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\.screenslop\/design-profile\.json/);
});
