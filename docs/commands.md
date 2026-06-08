# Command Model

Screenslop should not copy Impeccable's command names. The workflow is different because Screenslop can see the app.

## Core commands

### `screenslop init`

Sets up the project connection.

Use it for:

- runtime checks
- scheme / workspace / bundle ID configuration
- Baguette / XcodeBuildMCP / simctl preferences
- artifact folder config
- default device configuration
- safe migration from the current config shape

This is setup, not design learning.

Current MVP behavior:

```bash
screenslop init
screenslop init --json --dry-run
screenslop init --json --migrate --dry-run
screenslop init --json --migrate --yes
screenslop init --scheme RuntimeSmoke --bundle-id dev.example.RuntimeSmoke --source-root Sources
```

`init` creates or migrates `.screenslop/config.json` with `schemaVersion: 1`.
That file is ignored because it can contain private app paths. Commit docs or
templates instead of committing local target config.

The config keeps `artifactsDir` as the canonical artifact-root field. Phase 1
stores, validates, and resolves it; current `see` capture still writes to the
default `artifacts/` directory until the shared runtime runner consumes target
config in the next slice. `sourceHints` stays evidence/source-location metadata;
it is not a write scope and must not be treated as `sourceRoot`.

Existing fields are preserved or mapped:

- `runtimePreference`
- `preferredRuntime`
- `defaultSurface`
- `defaultScheme`
- `defaultBundleId`
- `artifactsDir`
- `sourceHints`

New target fields:

- `schemaVersion: 1`
- `workspacePath`
- `projectPath`
- `defaultDevice`
- `sourceRoot`

Safety rules:

- Existing config migration needs `--migrate`; JSON/non-interactive writes also need `--yes`.
- `--dry-run` never writes.
- `.screenslop` and `.screenslop/config.json` symlinks are rejected.
- `sourceRoot` and `artifactsDir` must resolve inside the repo for v0.1.
- `sourceRoot` must not point at `.git`, `.omx`, `node_modules`, `DerivedData`, `build`, or `artifacts`.
- `artifactsDir` must not point at `.git`, `.omx`, `node_modules`, `DerivedData`, `build`, or the repo root.
- `sourceRoot` and `artifactsDir` must not overlap.

The config schema is still provisional until the matrix runner exercises the
target/profile needs. Freeze or document pre-1.0 instability before a v0.1 tag.

### `screenslop learn`

Learns the app's design system from evidence and code.

This is the closest Screenslop equivalent to Impeccable's `init` + `document`, but stronger because it can use real screens.

Use it for:

- capturing representative screens
- reading accessibility trees
- scanning SwiftUI code
- extracting colors, typography, spacing, symbols, materials, motion patterns
- building or refreshing `DESIGN.md`
- writing app-specific review rules

Possible future flow:

```bash
screenslop learn --surface Settings
screenslop learn --from-artifacts artifacts/<run-id>
screenslop learn --tokens path/to/tokens.json
```

`tokextract` may fit here as a token-source adapter:

```text
token/design artifacts -> normalized tokens -> DESIGN.md seed
```

Do not wire it until its input/output contract is inspected.

### `screenslop see`

Captures evidence for the current screen.

Outputs:

- screenshot
- accessibility tree
- logs
- evidence manifest
- summary

### `screenslop critique`

Reviews evidence and produces findings.

Every finding needs a screenshot region, AX node, log line, source hint, or an explicit note that evidence is missing.

Agent JSON contract:

- `bundle`, `evidence`, and generated artifact paths are repo-relative when the bundle lives inside the current project root.
- Those paths are absolute when the bundle lives outside the current project root, such as a copied bundle in `/tmp`.
- Artifact reads prefer files next to the bundle before falling back to repo-root paths from the manifest. This keeps shared or copied bundles self-contained.

### `screenslop fix`

Plans and optionally applies selected safe fixes from a critique bundle.

Default behavior is conservative: it writes `fix-plan.json` and `fix.md` into the bundle, then edits nothing unless `--apply` is passed and confirmed. In non-interactive runs, `--apply` also needs `--yes`.

Common forms:

```bash
screenslop fix artifacts/<run> --dry-run
screenslop fix artifacts/<run> --finding <id> --source-root <app-root> --dry-run --json
screenslop fix artifacts/<run> --finding <id> --source-root <app-root> --apply --yes --label "Save settings" --json
screenslop fix artifacts/<run> --finding <id> --source-root <app-root> --apply --yes --verify-command "npm test"
```

Options:

- `--finding <id>` selects one finding. Repeat it or pass comma-separated IDs for more than one.
- `--source-root <path>` limits source search and patching to that app source tree.
- `--dry-run` writes the plan/report and does not edit source.
- `--apply` enables source edits for auto-fixable findings. It requires at least one `--finding`; dry-run is the only mode that can plan all findings at once.
- `--yes` confirms non-interactive apply runs.
- `--label <text>` supplies the replacement label for accessibility-label fixes.
- `--verify-command <command>` runs a bounded verification command and records pass/fail in `fix-session.json`.
- `--json` prints parseable JSON only and never prompts. Use `--yes` with `--json --apply`.

MVP auto-fixes are deliberately narrow:

- `ax.missing-name` with a unique `.accessibilityIdentifier(...)`, `.reviewID(...)`, or `sourceHint` line.
- `ax.generic-name` with the same source certainty and a supplied label.
- `layout.touch-target` with a unique source match and no existing nearby frame modifier.

Unsupported or ambiguous findings still appear in the fix plan, but Screenslop does not edit source for them. `layout.offscreen-frame`, `logs.*`, evidence-quality findings, visible-label-only matches, and duplicate source matches are manual in this MVP.

No fresh evidence means no verified fix claim. A passed `--verify-command` is recorded as `verify-passed`; only a future recapture/critique loop should use `recapture-passed`.

### `screenslop verify`

Compares previous findings against fresh evidence and writes proof artifacts.

MVP usage:

```bash
screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run>
screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id> --json
screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --refresh-critique --json
```

Options:

- `--fresh-bundle <path>` is required. Verification needs a fresh evidence bundle.
- `--finding <id>` selects one or more baseline findings. Repeat it or pass comma-separated IDs.
- `--refresh-critique` reruns critique on the fresh bundle before comparison.
- `--fix-session <path>` attaches optional context from a fix session. It does not prove the fix by itself.
- `--json` prints parseable JSON only and never prompts.

Outputs are written into the baseline bundle:

- `verification.json`
- `verification.md`

Statuses:

- `verified-fixed`: fresh critique no longer reports the same issue by stable evidence keys.
- `still-present`: fresh critique still reports the same rule and stable evidence key.
- `changed`: the same rule remains, but the stable evidence key changed.
- `unknown`: the baseline finding lacks enough stable evidence to prove fixed or still present.
- `missing-baseline`: a requested finding ID was not in the baseline findings.

The MVP does not capture fresh evidence itself. Run `screenslop see`, then `screenslop critique`, then `screenslop verify`. No fresh evidence, no verified claim.

## MVP end-to-end flow

The contract flow is deliberately explicit:

```bash
screenslop see --surface Settings --json
screenslop critique artifacts/<baseline-run> --json
screenslop fix artifacts/<baseline-run> --finding <id> --source-root <app-root> --apply --yes --label "Save settings" --json
screenslop see --surface Settings --json
screenslop critique artifacts/<fresh-run> --json
screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id> --fix-session artifacts/<baseline-run>/fix-session.json --json
```

What each step proves:

- `see` proves Screenslop captured a bundle for the current runtime surface.
- `critique` proves deterministic findings were derived from that bundle.
- `fix` proves Screenslop planned or applied a selected safe source patch.
- The second `see` proves there is fresh evidence after the patch.
- The second `critique` proves the fresh bundle was reviewed independently.
- `verify` proves the selected baseline finding is gone, still present, changed, or unknown by comparing baseline findings with fresh critique output.

`fix-session.json` is context, not proof. It can show what Screenslop patched, but only fresh capture plus fresh critique can support a `verified-fixed` claim.

For CI and agent contract checks, run the fixture-backed smoke flow:

```bash
npm run --silent smoke:e2e -- --fresh-mode fixed
```

That smoke uses copied fixtures and temporary source files. It proves command composition and artifact contracts; it does not prove a real app screen is visually fixed. Real UI claims still require runtime evidence from `screenslop see`.

For the first self-contained live simulator proof, run the real-runtime smoke:

```bash
npm run smoke:runtime
```

That smoke builds and launches `examples/runtime-smoke-app` through XcodeBuildMCP, captures Baguette-backed baseline evidence, applies one narrow source fix, rebuilds, recaptures, critiques the fresh bundle, and runs `screenslop verify`. It is still sample-app proof only. A user app needs its own real `screenslop see` capture on the user surface before any verified UI claim.

The runtime smoke prints JSON only. If Baguette, XcodeBuildMCP, the simulator, capture, fix, rebuild, or verification fails, it exits nonzero with the failing stage in the report.

The default smoke stays pinned to `examples/runtime-smoke-app`. A configured
target can be supplied for local dogfood without committing private paths:

```bash
node scripts/smoke-real-runtime.mjs --config .screenslop/config.json --identifier settings.saveButton
node scripts/smoke-real-runtime.mjs --workspace App.xcworkspace --scheme App --bundle-id dev.example.App --source-root App --identifier settings.saveButton
```

Configured target requirements:

- `workspacePath` or `projectPath`
- `defaultScheme`
- `defaultBundleId`
- `sourceRoot`
- `defaultSurface` or `--surface`
- a stable finding selector via `--identifier` or `--finding`

The smoke validates target config before build/run, keeps `verify` behind fresh
build, fresh `see`, fresh artifacts, and fresh `critique`, and redacts private
absolute paths in its final JSON report by default.

### `screenslop matrix`

Writes a bounded matrix report and one evidence bundle per matrix cell.

MVP usage:

```bash
screenslop matrix --dry-run --json
screenslop matrix --profile examples/matrix/default.json --json
screenslop matrix --critique --json
```

The built-in profile has six fixed cells:

- default configured iPhone
- large iPhone
- light appearance
- dark appearance
- normal Dynamic Type
- accessibility Dynamic Type

When `.screenslop/config.json` is missing, the report still keeps all cells and
marks them unavailable with no-config evidence bundles. With config present,
`--dry-run` writes the same cell bundles without runtime capture. Live capture
builds and launches the configured target through XcodeBuildMCP, then captures
with the configured `defaultSurface`, `defaultBundleId`, and default/device cell
preference. `--critique` runs critique after a successful cell capture.

The matrix profile is JSON with `schemaVersion: 1`, `name`, and `cells[]`. Each
cell can set `id`, `label`, `device`, `appearance`, `dynamicType`, and optional
`surface`. Appearance and Dynamic Type are recorded as requested profile
metadata in this MVP; the report must not pretend a cell was captured if the
runtime cannot supply it.

### `screenslop watch`

Future live loop for iterative design work.

This is where Baguette's stream view can become extremely useful.

## Short version

```text
init      connect the project
learn     understand the design system
see       capture evidence
critique  find issues
fix       patch selected issues
verify    prove the fix
matrix    bounded device/settings stress report
watch     live iteration loop
```
