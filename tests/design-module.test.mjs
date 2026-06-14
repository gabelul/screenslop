import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('deterministic critique does not import design intelligence by default', () => {
  const source = fs.readFileSync(new URL('../src/critique/collect-critique.mjs', import.meta.url), 'utf8');

  assert.equal(source.includes('../design'), false);
  assert.equal(source.includes('src/design'), false);
});
