import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const repoRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(repoRoot, 'bin/screenslop.mjs');

test('screenslop learn --dry-run plans a private design profile without writing', () => {
  const root = createSwiftUiProject();
  const result = runLearn(root, ['--json', '--dry-run', '--surface', 'Settings']);

  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.command, 'learn');
  assert.equal(payload.action, 'plan');
  assert.equal(payload.wrote, false);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.profile, undefined);
  assert.equal(payload.profileSummary.schemaVersion, 1);
  assert.equal(payload.profileSummary.freshnessStatus, 'current');
  assert.equal(payload.profileSummary.sourceCount >= 2, true);
  assert.equal(payload.pathDisplayMode, 'redacted');
  assert.match(payload.profilePath, /^<repo>\/\.screenslop\/design-profile\.json$/);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'design-profile.json')), false);
});

test('screenslop learn refuses JSON writes without explicit confirmation', () => {
  const root = createSwiftUiProject();
  const result = runLearn(root, ['--json', '--write']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.ok, false);
  assert.equal(payload.status, 'requires-write-confirmation');
  assert.equal(payload.wrote, false);
  assert.equal(fs.existsSync(path.join(root, '.screenslop', 'design-profile.json')), false);
});

test('screenslop learn writes and checks the current profile', () => {
  const root = createSwiftUiProject();
  const write = runLearn(root, ['--json', '--write', '--yes']);

  assert.equal(write.status, 0, write.stderr || write.stdout);
  const written = JSON.parse(write.stdout);
  assert.equal(written.ok, true);
  assert.equal(written.status, 'written');
  assert.equal(written.wrote, true);
  assert.equal(written.freshness.status, 'current');
  assert.equal(written.freshness.stale, false);
  assert.equal(written.previousFreshness.status, 'missing-profile');

  const file = path.join(root, '.screenslop', 'design-profile.json');
  assert.equal(fs.existsSync(file), true);
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(profile.schemaVersion, 1);
  assert.ok(profile.sources.some((source) => source.path === 'Sources/SettingsView.swift'));
  assert.ok(profile.components.some((component) => component.name === 'SettingsView'));

  const check = runLearn(root, ['--json', '--check']);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  const checked = JSON.parse(check.stdout);
  assert.equal(checked.ok, true);
  assert.equal(checked.status, 'current');
  assert.equal(checked.profileSummary.schemaVersion, 1);
  assert.ok(checked.profileSummary.trustedTokenCounts);
  assert.ok(Array.isArray(checked.profileSummary.profileGapIds));
  assert.deepEqual(checked.next, []);
});

test('screenslop learn extracts tokens from design docs and explicit design sources', () => {
  const root = createSwiftUiProject();
  const externalDesign = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-external-design-'));
  fs.mkdirSync(path.join(root, '.screenslop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    schemaVersion: 1,
    runtimePreference: ['baguette', 'xcodebuildmcp', 'simctl', 'manual'],
    preferredRuntime: 'baguette',
    defaultSurface: 'Home',
    defaultScheme: 'PetPacket',
    defaultBundleId: 'com.example.petpacket',
    defaultDevice: null,
    workspacePath: null,
    projectPath: null,
    sourceRoot: 'Sources',
    designSources: [externalDesign],
    artifactsDir: 'artifacts',
    sourceHints: []
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'DESIGN.md'), `# Design

Category: pet care
Audience: busy dog parents, families
Tone: warm, calm, practical

## Colors
| Token | Value |
| --- | --- |
| brand.teal | #1CA6A6 |

## Spacing
- spacing.md: 16
- radius.card: 18
`);
  fs.mkdirSync(path.join(externalDesign, '.build', 'checkouts', 'Noise'), { recursive: true });
  for (let index = 0; index < 180; index += 1) {
    fs.writeFileSync(path.join(externalDesign, '.build', 'checkouts', 'Noise', `Generated${index}.swift`), 'enum L10n { static let typeMethod = \"gap copy\" }\n');
  }
  fs.mkdirSync(path.join(externalDesign, 'Sources'), { recursive: true });
  fs.writeFileSync(path.join(externalDesign, 'Sources', 'DesignSystem.swift'), `
import SwiftUI

enum BrandColor {
  static let primaryTeal: Color = Color("PrimaryTeal")
}

enum BrandTypography {
  static let title: Font = Font.custom("PetSerif", size: 28)
}

enum BrandSpacing {
  static let spacingLarge: CGFloat = 24
  static let cornerRadiusCard: CGFloat = 18
}

enum BrandChrome {
  static let backgroundMaterial = Material.thin
  static let addPetIcon = Image(systemName: "pawprint")
}

struct DynamicTheme {
  let brandColor: Color
}

enum ThemeFactory {
  static let warmTheme = DynamicTheme(brandColor: Color(hue: 0.48, saturation: 0.62, brightness: 0.68))
}

protocol SpacingScale {
  var sm: CGFloat { get }
  var lg: CGFloat { get }
}

struct PetSpacing: SpacingScale {
  let sm: CGFloat = 8
  let lg: CGFloat = 24
}
`);

  const result = runLearn(root, ['--json', '--write', '--yes']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const profile = JSON.parse(fs.readFileSync(path.join(root, '.screenslop', 'design-profile.json'), 'utf8'));
  assert.equal(profile.project.appCategory, 'pet care');
  assert.deepEqual(profile.project.audience, ['busy dog parents', 'families']);
  assert.deepEqual(profile.project.tone, ['warm', 'calm', 'practical']);
  assert.equal(profile.designSources.length, 1);
  assert.ok(profile.sources.some((source) => source.path === path.join(fs.realpathSync.native(externalDesign), 'Sources', 'DesignSystem.swift')));
  assert.equal(profile.sources.some((source) => source.path.includes('/.build/')), false);
  assert.ok(profile.tokens.colors.some((token) => token.name.includes('primaryTeal') || token.name.includes('brand.teal')));
  assert.ok(profile.tokens.colors.some((token) => token.extraction === 'swift-dynamic-theme' || token.extraction === 'swift-color-hsb'));
  assert.ok(profile.tokens.typography.some((token) => token.value.includes('PetSerif')));
  assert.ok(profile.tokens.spacing.some((token) => token.name.includes('spacingLarge') || token.name.includes('spacing.md')));
  assert.ok(profile.tokens.spacing.some((token) => token.name.includes('PetSpacing.sm')));
  assert.ok(profile.tokens.cornerRadii.some((token) => token.name.includes('cornerRadiusCard') || token.name.includes('radius.card')));
  assert.ok(profile.tokens.materials.some((token) => token.value.includes('Material.thin')));
  assert.ok(profile.tokens.icons.some((token) => token.value.includes('pawprint')));

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.profileSummary.designSourceCount, 1);
  assert.equal(payload.profileSummary.profileGapCount, 0);
  assert.equal(payload.profileSummary.tokenCounts.colors > 0, true);
  assert.equal(payload.profileSummary.trustedTokenCounts.colors > 0, true);
  assert.deepEqual(payload.profileSummary.profileGapIds, []);
});

test('screenslop learn does not let L10n noise clear token profile gaps', () => {
  const root = createSwiftUiProject();
  const externalDesign = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-noisy-design-'));
  fs.mkdirSync(path.join(root, '.screenslop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    schemaVersion: 1,
    runtimePreference: ['baguette', 'xcodebuildmcp', 'simctl', 'manual'],
    preferredRuntime: 'baguette',
    defaultSurface: 'Home',
    defaultScheme: 'PetPacket',
    defaultBundleId: 'com.example.petpacket',
    defaultDevice: null,
    workspacePath: null,
    projectPath: null,
    sourceRoot: 'Sources',
    designSources: [externalDesign],
    artifactsDir: 'artifacts',
    sourceHints: []
  }, null, 2)}\n`);
  fs.writeFileSync(path.join(externalDesign, 'L10n.swift'), `
enum L10n {
  static let addLaterNote = "Leave a gap before you add another pet"
  static let typeMethod = "Choose the type method"
}
`);
  fs.writeFileSync(path.join(externalDesign, 'KindIdentifier.swift'), `
enum KindIdentifier {
  static let typeMethod = "kind.type.method"
}
`);
  fs.writeFileSync(path.join(externalDesign, 'Reference.md'), `# Material Design notes

- SearchField: struct BadgeView
- Reference guide: var body
- component.material: prose only
`);

  const result = runLearn(root, ['--json', '--write', '--yes']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const profile = JSON.parse(fs.readFileSync(path.join(root, '.screenslop', 'design-profile.json'), 'utf8'));
  assert.deepEqual(profile.tokens.typography, []);
  assert.deepEqual(profile.tokens.spacing, []);
  assert.deepEqual(profile.tokens.materials, []);
  assert.ok(profile.profileGaps.some((gap) => gap.id === 'design.tokens.incomplete-core'));

  const payload = JSON.parse(result.stdout);
  assert.equal(payload.profileSummary.profileGapCount > 0, true);
  assert.ok(payload.profileSummary.profileGapIds.includes('design.tokens.incomplete-core'));
});

test('screenslop learn classifies token layers from paths and names', () => {
  const root = createSwiftUiProject();
  // Layered design system: a /Primitive/ directory, a semantic palette named
  // by role, and a token whose name and path say nothing about its layer.
  fs.mkdirSync(path.join(root, 'Sources', 'Tokens', 'Primitive'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Sources', 'Tokens', 'Primitive', 'PrimitiveColors.swift'), `
import SwiftUI

enum PrimitiveColors {
  static let blue500: Color = Color(hex: "#3B82F6")
}
`);
  fs.writeFileSync(path.join(root, 'Sources', 'Tokens', 'ColorPalette.swift'), `
import SwiftUI

enum ColorPalette {
  static let primary: Color = Color(hex: "#0A84FF")
}
`);
  fs.writeFileSync(path.join(root, 'Sources', 'Glow.swift'), `
import SwiftUI

enum Glow {
  static let fizz: Color = Color(hex: "#123123")
}
`);

  const result = runLearn(root, ['--json', '--write', '--yes']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const profile = JSON.parse(fs.readFileSync(path.join(root, '.screenslop', 'design-profile.json'), 'utf8'));
  const layerOf = (fragment) => profile.tokens.colors.find((token) => token.name.includes(fragment))?.layer;
  assert.equal(layerOf('blue500'), 'primitive', 'a /Primitive/ path segment must classify as primitive');
  assert.equal(layerOf('ColorPalette.primary'), 'semantic', 'role names like primary must classify as semantic');
  assert.equal(layerOf('Glow.fizz'), 'unknown', 'tokens with no layer signal must classify as unknown');
});

test('screenslop learn extracts semantic alias colors and resolves them to their primitive hex', () => {
  const root = createSwiftUiProject();
  // The real layered shape: primitives hold the hex, semantic roles are
  // computed alias vars that just point at a primitive.
  fs.mkdirSync(path.join(root, 'Sources', 'Tokens', 'Primitive'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Sources', 'Tokens', 'Primitive', 'PrimitiveColors.swift'), `
import SwiftUI

enum PrimitiveColors {
  static let blue500: Color = Color(hex: "#3B82F6")
}
`);
  fs.mkdirSync(path.join(root, 'Sources', 'Themes', 'Light'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Sources', 'Themes', 'Light', 'LightTheme.swift'), `
import SwiftUI

public struct LightTheme {
  public var primary: Color { PrimitiveColors.blue500 }
  public var mystery: Color { MissingColors.ghost700 }
}
`);

  const result = runLearn(root, ['--json', '--write', '--yes']);
  assert.equal(result.status, 0, result.stderr || result.stdout);

  const profile = JSON.parse(fs.readFileSync(path.join(root, '.screenslop', 'design-profile.json'), 'utf8'));
  const primary = profile.tokens.colors.find((token) => token.name === 'LightTheme.primary');
  assert.ok(primary, 'the alias var must be extracted as a color token');
  assert.equal(primary.extraction, 'swift-color-alias');
  assert.equal(primary.layer, 'semantic');
  assert.equal(primary.value, 'PrimitiveColors.blue500');
  assert.equal(primary.aliasOf, 'PrimitiveColors.blue500');
  assert.match(primary.resolvedValue, /#3B82F6/);

  // An alias pointing at a scope the scan never saw stays honest: raw value, no resolution.
  const mystery = profile.tokens.colors.find((token) => token.name === 'LightTheme.mystery');
  assert.ok(mystery, 'unresolvable aliases are still recorded');
  assert.equal(mystery.resolvedValue, undefined);
  assert.equal(mystery.aliasOf, undefined);
});

test('screenslop learn detects stale profiles and refreshes while preserving user rules', () => {
  const root = createSwiftUiProject();
  assert.equal(runLearn(root, ['--json', '--write', '--yes']).status, 0);

  const file = path.join(root, '.screenslop', 'design-profile.json');
  const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
  profile.reviewRules.unshift({
    id: 'custom.brand.voice',
    pillar: 'slop',
    severity: 'P3',
    description: 'Keep the project voice direct and calm.'
  });
  profile.tokens.materials.push({
    name: 'SearchField',
    value: 'struct BadgeView',
    source: 'docs/reference.md',
    sourceKind: 'design-doc',
    extraction: 'markdown-pair',
    confidence: 'medium'
  });
  profile.tokens.colors.push({
    name: 'manual.brand',
    value: '#123456',
    source: 'manual',
    extraction: 'manual',
    confidence: 'high'
  });
  fs.writeFileSync(file, `${JSON.stringify(profile, null, 2)}\n`);

  fs.appendFileSync(path.join(root, 'Sources', 'SettingsView.swift'), '\nstruct HelpView: View { var body: some View { Text("Help") } }\n');

  const stale = runLearn(root, ['--json', '--check']);
  assert.equal(stale.status, 1);
  const stalePayload = JSON.parse(stale.stdout);
  assert.equal(stalePayload.status, 'stale');
  assert.deepEqual(stalePayload.next, ['screenslop learn --refresh --json --dry-run']);

  const dryRefresh = runLearn(root, ['--json', '--refresh', '--dry-run']);
  assert.equal(dryRefresh.status, 0, dryRefresh.stderr || dryRefresh.stdout);
  const dryPayload = JSON.parse(dryRefresh.stdout);
  assert.equal(dryPayload.action, 'refresh');
  assert.equal(dryPayload.wrote, false);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).freshness.sourceHash, profile.freshness.sourceHash);

  const refresh = runLearn(root, ['--json', '--refresh', '--write', '--yes']);
  assert.equal(refresh.status, 0, refresh.stderr || refresh.stdout);
  const refreshed = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.notEqual(refreshed.freshness.sourceHash, profile.freshness.sourceHash);
  assert.ok(refreshed.reviewRules.some((rule) => rule.id === 'custom.brand.voice'));
  assert.ok(refreshed.tokens.colors.some((token) => token.name === 'manual.brand'));
  assert.equal(refreshed.tokens.materials.some((token) => token.name === 'SearchField'), false);
  assert.ok(refreshed.components.some((component) => component.name === 'HelpView'));
});

test('screenslop learn rejects profile paths through symlink ancestors', () => {
  const root = createSwiftUiProject();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-profile-outside-'));
  fs.symlinkSync(outside, path.join(root, 'linked-outside'), 'dir');

  const result = runLearn(root, ['--json', '--dry-run', '--profile', 'linked-outside/design-profile.json']);

  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.match(payload.error, /symlinks|project root/);
});

test('screenslop learn refuses invalid existing config instead of falling back', () => {
  const root = createSwiftUiProject();
  fs.mkdirSync(path.join(root, '.screenslop'), { recursive: true });
  fs.writeFileSync(path.join(root, '.screenslop', 'config.json'), `${JSON.stringify({
    schemaVersion: 1,
    runtimePreference: ['baguette'],
    preferredRuntime: 'baguette',
    defaultSurface: 'Settings',
    defaultScheme: 'App',
    defaultBundleId: 'dev.example.App',
    sourceRoot: '../outside'
  }, null, 2)}\n`);

  const result = runLearn(root, ['--json', '--dry-run']);
  assert.equal(result.status, 1);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.status, 'config-invalid');
  assert.equal(payload.profile, undefined);
});

/**
 * Runs the learn command inside a temp project.
 * @param {string} cwd Working directory.
 * @param {string[]} args CLI args after `learn`.
 * @returns {import('node:child_process').SpawnSyncReturns<string>} CLI result.
 */
function runLearn(cwd, args) {
  return spawnSync(process.execPath, [cliPath, 'learn', ...args], { cwd, encoding: 'utf8' });
}

/**
 * Creates a tiny SwiftUI-like project fixture.
 * @returns {string} Temp project root.
 */
function createSwiftUiProject() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'screenslop-learn-'));
  fs.mkdirSync(path.join(root, 'Sources'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Sources', 'SettingsView.swift'), `
import SwiftUI

struct SettingsView: View {
  var body: some View {
    VStack { Text("Settings") }
  }
}
`);
  fs.writeFileSync(path.join(root, 'DESIGN.md'), '# Design\n\nClear, calm, practical.\n');
  return root;
}
