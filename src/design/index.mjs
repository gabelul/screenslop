export const DESIGN_PROFILE_SCHEMA_VERSION = 1;
export const DEFAULT_DESIGN_PROFILE_PATH = '.screenslop/design-profile.json';

export const designFindingKinds = [
  'design',
  'product-logic',
  'profile-gap'
];

export const designProofLevels = [
  'runtime-informed',
  'profile-informed',
  'agent-judgment'
];

const designFindingKindSet = new Set(designFindingKinds);
const designProofLevelSet = new Set(designProofLevels);

/**
 * Checks whether a finding kind belongs to the design intelligence layer.
 * @param {string} value Candidate finding kind.
 * @returns {boolean} True when the kind is design-specific.
 */
export function isDesignFindingKind(value) {
  return designFindingKindSet.has(value);
}

/**
 * Checks whether a proof level belongs to subjective or profile-backed review.
 * @param {string} value Candidate proof level.
 * @returns {boolean} True when the proof level is design-specific.
 */
export function isDesignProofLevel(value) {
  return designProofLevelSet.has(value);
}

/**
 * Returns the private default path used for learned project profiles.
 * @returns {string} Project-local design profile path.
 */
export function defaultDesignProfilePath() {
  return DEFAULT_DESIGN_PROFILE_PATH;
}
