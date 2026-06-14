# Command Model

Screenslop uses its own command model because the workflow starts from runtime evidence.

## Core commands

### `screenslop setup`

Detects first-use Apple project metadata, prepares `.screenslop/config.json`, and writes only after explicit confirmation. This is the Pixeltamer-style first invocation step for Screenslop, but it stays project-local because app config can contain private paths and bundle IDs.

Use it for:

- first-run project detection
- safe config dry-runs
- ambiguous target reporting
- explicit config writes after approval

Current behavior:

```bash
screenslop setup --json --dry-run
screenslop setup --json --yes
screenslop setup --project MyApp.xcodeproj --scheme MyApp --bundle-id com.example.MyApp --source-root MyApp --surface Settings --json --dry-run
```

`setup` refuses to write when project, scheme, bundle ID, or source root detection is ambiguous. Setup is configuration only; proof starts with runtime capture at `screenslop see`.

### `screenslop instructions`

Prints the compact coding-agent contract from the shipped CLI. Use this when an
agent host does not auto-load the installed Screenslop skill, or when you want
to check whether the local skill install matches the current CLI checkout.

Current behavior:

```bash
screenslop instructions
screenslop instructions --agent codex
screenslop instructions --agent claude --json
```

The output includes the dry-run-first setup rule, the runtime-evidence loop,
the fresh-bundle verify rule, private artifact stop rules, CLI package version,
and local skill status. This command does not inspect, capture, write config, or
change the app.

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

The config keeps `artifactsDir` as the canonical artifact-root field. `see` and
`matrix` use it when a valid config exists. `sourceHints` stays
evidence/source-location metadata; it is not a write scope and must not be
treated as `sourceRoot`.

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

`schemaVersion: 1` is the v0.1 config generation. It is a 0.x contract, so
future 0.x releases may change it with an explicit migration path.

### `screenslop learn`

Learns, checks, and refreshes the private project design profile.

This is the Screenslop design-learning path. The MVP scans project files and common design docs, writes `.screenslop/design-profile.json`, checks freshness, and refreshes while preserving user-authored rules. Runtime evidence and token adapters can feed this later, but they are not part of the shipped `learn` command yet.

Use it for:

- scanning SwiftUI code and common design docs
- creating the private profile from a dry-run preview
- checking whether the profile is current or stale
- refreshing source hashes and generated component hints
- preserving app-specific review rules across refreshes

Current flow:

```bash
screenslop learn --json --dry-run
screenslop learn --write --yes --json
screenslop learn --check --json
screenslop learn --refresh --json --dry-run
screenslop learn --refresh --write --yes --json
screenslop learn --surface Settings --json --dry-run
```

The private default output is `.screenslop/design-profile.json`. It stays ignored unless a project exports a redacted public profile. JSON writes need `--write --yes`; dry runs never write.

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

Every report includes a compact `summary` block so agents do not have to guess
from raw stage logs:

```json
{
  "status": "passed",
  "captureStatus": "passed",
  "critiqueStatus": "passed",
  "fixStatus": "passed",
  "freshCaptureStatus": "passed",
  "freshCritiqueStatus": "passed",
  "verifyStageStatus": "passed",
  "verifyStatus": "verified-fixed"
}
```

Failure reports use the same keys with `failed` or `not-run`, plus `reason` and
`failedStage`. This is the part automation should read first. The full `stages`
array is still there when something goes sideways and you need the messy details.

The default smoke stays pinned to `examples/runtime-smoke-app`. A configured
target can be supplied for local dogfood without committing private paths. The
smoke runner resolves `--config` from the Screenslop checkout, so pass an
absolute private-app config path or a path relative to this checkout:

```bash
node scripts/smoke-real-runtime.mjs --config /path/to/private-app/.screenslop/config.json --identifier settings.saveButton
node scripts/smoke-real-runtime.mjs --workspace App.xcworkspace --scheme App --bundle-id dev.example.App --source-root App --identifier settings.saveButton
node scripts/smoke-real-runtime.mjs --config /path/to/private-app/.screenslop/config.json --identifier settings.saveButton --preflight-only
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

Use `--preflight-only` for private config checks. It validates the target and
prints redacted JSON without calling Baguette, XcodeBuildMCP, build/run,
capture, fix, or verify.

### `screenslop matrix`

Writes a bounded matrix report and one evidence bundle per matrix cell.

MVP usage:

```bash
screenslop matrix --dry-run --json
screenslop matrix --profile examples/matrix/default.json --json
screenslop matrix --profile examples/matrix/phone-sizes.json --critique --json
screenslop matrix --profile examples/matrix/phone-sizes.json --critique --design --agent-packet --json
screenslop matrix --critique --json
```

The built-in profile has six fixed cells:

- default configured iPhone
- large iPhone
- light appearance
- dark appearance
- normal Dynamic Type
- accessibility Dynamic Type

The packaged `examples/matrix/phone-sizes.json` profile is for non-interactive mobile-size checks:

- small iPhone: `iPhone 17e`
- normal iPhone: `iPhone 17`
- large iPhone: `iPhone 17 Pro`

Agents should use that profile when the task is “check this screen on small, normal, and large phones.” They should also run it before calling layout-sensitive UI work done: SwiftUI spacing, onboarding, paywalls, checkout, settings, full-screen flows, compact sheets, tab bars, scroll views, Dynamic Type-sensitive layouts, and any screen where a small or large phone could change the result. If those simulator names are not installed, run `baguette list --json`, copy the profile, and replace only the `device` values before capturing.

When `.screenslop/config.json` is missing, the report still keeps all cells and
marks them unavailable with no-config evidence bundles. With config present,
`--dry-run` writes the same cell bundles without runtime capture. Live capture
builds and launches the configured target through XcodeBuildMCP, then captures
with the configured `defaultSurface`, `defaultBundleId`, and default/device cell
preference. `--critique` runs deterministic critique after a successful cell capture. `--design` also runs the design-review layer after each successful cell critique, records per-cell design summaries, and writes matrix-level design consistency notes. Use `--agent-packet` with `--design` when each cell should emit a packet for agent judgment.

Baguette's farm page can sit beside matrix work as a live multi-simulator dashboard. Start it with `baguette serve` and open `http://localhost:8421/farm`; see `docs/baguette-farm.md`. Screenslop does not ship a `--open-farm` command, and the farm does not replace the matrix report or evidence bundles. Agents do not need the farm for headless checks; `screenslop matrix --profile examples/matrix/phone-sizes.json --critique --json
screenslop matrix --profile examples/matrix/phone-sizes.json --critique --design --agent-packet --json` is the non-interactive path.

The matrix profile is JSON with `schemaVersion: 1`, `name`, and `cells[]`. Each
cell can set `id`, `label`, `device`, `appearance`, `dynamicType`, and optional
`surface`. Appearance and Dynamic Type now have explicit per-cell
`settingStatus` entries. The status is `not-requested`, `unavailable`,
`requested-only`, or `applied`.

In this MVP, runtime forcing is not shipped yet, so captured cells with requested
appearance or Dynamic Type report `requested-only`. No-config and dry-run cells
report requested settings as `unavailable`. The report must not pretend a cell
actually applied a setting just because the profile asked for it.

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

## JSON examples and schemas

Agent-facing examples live in `examples/json/`:

- `see.json`
- `critique.json`
- `fix.json`
- `verify.json`
- `matrix.json`

Schemas live in `schemas/`. The matrix report contract is
`schemas/matrix-report.schema.json`.

## Design Intelligence command boundary

Design Intelligence is split between shipped profile learning and shipped design-review plumbing. These critique flags are opt-in:

- `critique --design --json`: opt-in design pass after deterministic critique.
- `critique --design-profile <path> --json`: profile override for a design pass.
- `critique --design --agent-packet --json`: packet writer for a coding agent or local reviewer.
- `critique --import-design-findings <path> --json`: import path for agent-produced design findings.

The deterministic `critique` command remains the default. A design-aware pass must preserve the measured finding schema and add optional fields only: `kind`, `proofLevel`, `requiresHumanReview`, `profileRuleId`, `judgment`, and `alternatives`.

`learn` profile refresh is not proof. If a profile is stale, run a dry-run refresh, review the delta, then write only with explicit confirmation. Design findings should use `design`, `product-logic`, or `profile-gap`; measured findings use `measured` and keep the existing fresh-bundle `verified-fixed` semantics.
