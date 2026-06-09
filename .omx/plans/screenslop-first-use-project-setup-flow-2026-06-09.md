# Screenslop First-Use Project Setup Flow Like Pixeltamer

Date: 2026-06-09  
Mode: planning only, no implementation yet  
Scope: Screenslop public engine repo, CLI first-use setup, installed agent skill guidance, docs/tests

## Requirements Summary

Make Screenslop feel closer to Pixeltamer after `npx skills add`, without pretending the skill installer can safely create private app config.

The target experience:

```text
install skill in an iOS project -> ask agent to use Screenslop -> agent detects project facts -> dry-run config -> writes config only after confirmation -> captures real UI
```

This should copy Pixeltamer's *first invocation* pattern, not its exact config model. Pixeltamer's config is user-level backend preference. Screenslop's config is project-local, private app target metadata, so it needs dry-run and explicit write confirmation.

## Current Evidence

### Screenslop repo contracts

- Screenslop is the public engine, CLI, schemas, runtime drivers, docs, and AI-agent integrations; Studio is a private wrapper that must consume the engine, not duplicate it (`docs/session-handoff.md:19-28`).
- Studio remains blocked until engine proof passes, including private dogfood with a real-app `verified-fixed` result and redaction check (`docs/session-handoff.md:30-53`).
- Runtime order is Baguette, XcodeBuildMCP, xcodebuild/simctl, manual evidence (`docs/session-handoff.md:55-71`, `docs/architecture.md:75-82`).
- Project-local runtime metadata lives in `.screenslop/config.json`; it includes scheme, bundle ID, project/workspace path, source root, artifacts dir, and runtime preferences (`docs/architecture.md:9-30`).
- The config file is ignored because app paths and bundle IDs can reveal private details (`docs/architecture.md:37-39`).
- `screenslop init` currently creates or migrates `.screenslop/config.json`; JSON/non-interactive writes need `--yes`, and `--dry-run` never writes (`docs/commands.md:7-20`, `docs/commands.md:59-67`).
- `createDefaultConfig` maps CLI values into config fields, including `workspacePath`, `projectPath`, `defaultScheme`, `defaultBundleId`, `sourceRoot`, `artifactsDir`, and `defaultSurface` (`src/config/project-config.mjs:14-31`).
- `writeProjectConfig` writes `.screenslop/config.json` with mode `0600` and rejects unsafe config symlinks (`src/config/project-config.mjs:197-216`).
- `screenslop init` already has human prompts for workspace/project/scheme/bundle/device/source/artifacts, but JSON or dry-run mode skips prompts (`bin/screenslop.mjs:162-283`).
- Current `init` help does not list `--surface`, even though `createDefaultConfig` accepts `values.surface` (`bin/screenslop.mjs:214-233`, `src/config/project-config.mjs:22`).
- `screenslop see` only uses config for `artifactsDir`; it still takes runtime capture flags directly and does not build/run the app (`src/evidence/collect-see.mjs:28-76`, `src/evidence/collect-see.mjs:86-178`).
- The real runtime smoke script can run a configured app, but it requires a surface and a finding selector before full proof; preflight-only validates target config without runtime capture (`scripts/smoke-real-runtime.mjs:63-75`, `scripts/smoke-real-runtime.mjs:250-287`, `tests/real-runtime-smoke.test.mjs:213-246`).
- Contract tests already lock skill/docs behavior around install, unavailable fallback, dogfood proof, and private config path safety (`tests/contracts.test.mjs:104-207`).

### Current skill/install state

- The Screenslop skill advertises `init`, `doctor`, `see`, `critique`, `fix`, `matrix`, `verify`, and `watch` (`skills/screenslop/SKILL.md:26-36`).
- The skill currently says to use bundled references when installed alone, but it does not have a first-use project setup flow (`skills/screenslop/SKILL.md:38-48`).
- The install reference says the skill is only an instruction layer and the CLI must also be installed (`skills/screenslop/reference/install.md:1-14`).
- The install reference explicitly says not to put `.screenslop/config.json` in the skill folder and not to commit private paths/bundle IDs/screenshots/reports (`skills/screenslop/reference/install.md:35-40`).
- `package.json` ships `skills/` and all current docs needed by installed/package users (`package.json:9-52`).

### Pixeltamer comparison

- Pixeltamer's recommended install is `npx skills add gabelul/pixeltamer-gpt-image-skill` (`pixeltamer/README.md:17-23`).
- Pixeltamer's README says `npx skills add` is only file placement; setup happens at first invocation (`pixeltamer/README.md:46-50`).
- Pixeltamer exposes `pixeltamer doctor` and `pixeltamer config` as first-run commands (`pixeltamer/README.md:58-67`).
- Pixeltamer's dispatcher stores user-level backend preference in `${XDG_CONFIG_HOME:-$HOME/.config}/pixeltamer/config.json` (`pixeltamer/scripts/pixeltamer:20-24`).
- Pixeltamer writes config through `_save_config`, choosing API, Codex, or auto backend (`pixeltamer/scripts/pixeltamer:77-97`, `pixeltamer/scripts/pixeltamer:182-207`).
- Pixeltamer auto-nudges setup on first run only when no config and no credentials are available, and only in a real TTY (`pixeltamer/scripts/pixeltamer:301-321`).

### BoardingReady real-project evidence from this session

- The skill install worked in BoardingReady under `.agents/skills/screenslop`, with `.claude/skills/screenslop` and `.crush/skills/screenslop` symlinked to it.
- BoardingReady's Xcode project is `PetPacket.xcodeproj`, scheme `PetPacket`, bundle ID `com.booplex.petpacket`, and source root `PetPacket`.
- No stable accessibility identifiers were found in BoardingReady source, so first proof should start with setup/capture/critique before selecting a finding.

## RALPLAN-DR Summary

### Principles

1. **Skills install instructions, not private target config.** Keep `npx skills add` as file placement only.
2. **First use may guide setup, but writes need consent.** Dry-run first, write only with `--yes` or interactive confirmation.
3. **Runtime evidence stays the proof.** No source-only critique shortcut.
4. **Project-local config stays private.** Do not leak paths, bundle IDs, screenshots, or dogfood reports into package/docs/CI output.
5. **Prefer small durable CLI affordances over agent-only rituals.** The setup flow should work for agents and humans.

### Decision Drivers

1. Reduce first-use friction after skill install in a real iOS app.
2. Keep private app config safe and explicit.
3. Avoid overbuilding a full installer before the engine dogfood gate passes.

### Viable Options

#### Option A — Skill/docs-only first-use checklist

Add `reference/project-setup.md` and teach agents to run current `screenslop init --dry-run`, then write after approval.

Pros:

- Smallest change.
- No new CLI behavior.
- Fast to ship.

Cons:

- Agents still need to infer project/scheme/bundle ID from Xcode files manually.
- Feels less like Pixeltamer because there is no CLI-owned first-run command.
- More room for each agent to do a slightly different setup dance.

#### Option B — Add `screenslop setup` as a guided alias over `init`

Add a `setup` command that detects Xcode metadata, prints a plan, and calls the existing config planner/writer. It defaults to interactive wizard for humans, and supports `--json --dry-run` for agents/CI.

Pros:

- Closest match to Pixeltamer's first-invocation feel.
- Keeps config creation in the Screenslop CLI instead of scattered agent prompts.
- Can be tested against temp Xcode project fixtures.
- Uses current config validation/write safety.

Cons:

- Adds a new shipped command and docs/tests to maintain.
- Detection will be heuristic; ambiguous projects still need user choice.
- Must avoid mutating private config unless explicitly confirmed.

#### Option C — Add a skill-bundled dispatcher script like Pixeltamer

Ship `skills/screenslop/scripts/screenslop` that wraps the CLI, finds the repo/package binary, and first-runs setup if config is missing.

Pros:

- Very Pixeltamer-like for installed-skill users.
- Can hide path differences between global CLI and repo checkout.

Cons:

- Adds a second command surface and executable-permission problems.
- Risks drift between wrapper and real CLI.
- Harder to package/test than keeping behavior in `bin/screenslop.mjs`.

### Recommended Option

Choose **Option B** now, with Option A docs as part of it. Defer Option C until there is real friction that justifies a wrapper.

The exact product shape:

```bash
screenslop setup --json --dry-run
screenslop setup --json --yes
screenslop doctor
screenslop see --surface Onboarding --boot --json
```

`setup` should be an agent/human-friendly first-use wizard over the existing `init` config contract. It should never run runtime capture, apply fixes, or claim dogfood proof.

## Acceptance Criteria

1. `screenslop help` lists `setup` as a first-use project setup command.
2. `screenslop setup --json --dry-run` in a project with a single `.xcodeproj`, one app scheme, and one app bundle ID returns parseable JSON with:
   - `ok: true`
   - `command: "setup"`
   - `status: "ready"`
   - `wrote: false`
   - redacted config output
   - detected metadata summary
   - recommended next commands
3. `screenslop setup --json --dry-run` does not create `.screenslop/config.json`.
4. `screenslop setup --json --yes` writes `.screenslop/config.json` only when the generated config validates.
5. Interactive `screenslop setup` asks before writing and defaults to no destructive action.
6. If multiple projects/workspaces/schemes/bundle IDs are detected, JSON dry-run returns `status: "needs-selection"` with candidate lists and exits nonzero; interactive mode lets the user pick or skip.
7. `screenslop init --help` includes `--surface`, because the config supports `defaultSurface` already.
8. The installed skill tells agents: if `.screenslop/config.json` is missing, run `screenslop setup --json --dry-run`, inspect, then ask before writing.
9. New `skills/screenslop/reference/project-setup.md` is bundled in the npm package and works when the skill is installed by itself.
10. Contract tests fail if the skill tells agents to write config without dry-run/confirmation.
11. Tests pass:
    - `node --test tests/config.test.mjs tests/contracts.test.mjs`
    - `node bin/screenslop.mjs doctor`
    - `npm test`
    - `npm pack --dry-run`
    - `npm run --silent smoke:package`
12. No private app path, bundle ID, `.screenslop/config.json`, BoardingReady artifact, or dogfood report is committed.

## Implementation Plan

### 1. Add project metadata detection helpers

Create `src/config/project-detection.mjs`.

Responsibilities:

- Find candidate `.xcworkspace` and `.xcodeproj` entries in the project root.
- Prefer non-derived, non-package project/workspace paths.
- Parse `.xcodeproj/project.pbxproj` for app-like `PRODUCT_BUNDLE_IDENTIFIER` values.
- Detect schemes from `*.xcscheme` files under project/workspace shared data when present.
- Return structured candidates, not a magical final answer when ambiguous.

Suggested exported functions:

```js
export function detectAppleProject(root = process.cwd()) {}
export function chooseSetupDefaults(detection, overrides = {}) {}
```

Notes:

- Do not shell out to `xcodebuild -list` in the pure helper. Keep unit tests fast and deterministic.
- CLI can optionally call `xcodebuild -list` later, but MVP should parse local files.
- Ignore blocked folders already used by config validation: `.git`, `.omx`, `node_modules`, `build`, `DerivedData`, and `artifacts`.

Tests:

- Single project/scheme/bundle ID chooses defaults.
- Multiple app bundle IDs returns ambiguity.
- No Xcode project returns `needs-selection` with a clear error.
- Existing CLI overrides win over detection.

### 2. Add `setup` command in `bin/screenslop.mjs`

Wire a new top-level command:

```js
case 'setup':
  await setupProject();
  break;
```

Behavior:

1. Parse flags with existing `parseOptions`.
2. Run detection from `src/config/project-detection.mjs`.
3. Merge detection defaults with CLI overrides.
4. Call existing `planInitConfig`.
5. Print setup-specific JSON/human output.
6. Write only when:
   - `--dry-run` is absent, and
   - `--yes` is present for JSON/non-interactive mode, or
   - the user confirms interactively.

Do not duplicate config write code. Reuse `writeProjectConfig` and the existing redaction helpers, or move reusable redaction functions out of `bin/screenslop.mjs` if needed.

Suggested command examples:

```bash
screenslop setup --json --dry-run
screenslop setup --surface Onboarding --json --dry-run
screenslop setup --project PetPacket.xcodeproj --scheme PetPacket --bundle-id com.booplex.petpacket --source-root PetPacket --json --dry-run
screenslop setup --json --yes
```

Human output should include:

- detected project/workspace
- detected scheme
- detected bundle ID
- source root guess
- config path
- exact next command

JSON output should include:

```json
{
  "ok": true,
  "command": "setup",
  "status": "ready",
  "action": "create",
  "wrote": false,
  "dryRun": true,
  "pathDisplayMode": "redacted",
  "detection": {
    "status": "single-match",
    "projects": ["PetPacket.xcodeproj"],
    "workspaces": [],
    "schemes": ["PetPacket"],
    "bundleIds": ["<bundle-id>"]
  },
  "config": {},
  "next": [
    "screenslop doctor",
    "screenslop see --surface <surface> --boot --json",
    "screenslop critique artifacts/<run-id> --json"
  ]
}
```

Stop rules:

- If there are multiple plausible app targets and no flags narrow it down, do not write.
- If no project/workspace is found, do not write.
- If config exists, report existing status and recommend `screenslop init --migrate --dry-run` only when migration is needed.
- Do not run `see`, `critique`, `fix`, or real runtime smoke inside `setup`.

### 3. Tighten `init` help and docs

Update `printInitHelp` in `bin/screenslop.mjs` to include:

```text
--surface <name>      Default surface name for capture/report context
```

Update docs:

- `docs/commands.md`: add `screenslop setup` before `init`, and clarify that `setup` detects and plans while `init` remains lower-level/manual.
- `docs/getting-started.md`: use `setup --json --dry-run` as the first project-local step.
- `docs/skill-installation.md`: after skill install, first use is `screenslop setup --json --dry-run` from the app repo.
- `docs/agent-playbook.md`: agent first-use flow should be `doctor -> setup dry-run -> ask/write -> see -> critique`, not manual guessing.
- `README.md`: keep it short; mention setup as first project step.

### 4. Add installed-skill project setup reference

Create `skills/screenslop/reference/project-setup.md`.

Content:

- `npx skills add` only installs the skill.
- First invocation inside an iOS project should run:

```bash
screenslop setup --json --dry-run
```

- If `status` is `ready`, show the planned config and ask before writing:

```bash
screenslop setup --json --yes
```

- If `status` is `needs-selection`, pass explicit flags:

```bash
screenslop setup \
  --project PetPacket.xcodeproj \
  --scheme PetPacket \
  --bundle-id com.booplex.petpacket \
  --source-root PetPacket \
  --surface Onboarding \
  --json \
  --dry-run
```

- Never commit `.screenslop/config.json`.
- Never claim setup proves UI quality; proof starts at `see` and goes through fresh verification.

Update `skills/screenslop/SKILL.md`:

- Add `setup` to command list and `argument-hint` if command contract changes.
- Add a "First use in a project" section.
- Link `reference/project-setup.md` in the installed references list.
- Keep the Baguette-first and sample/private proof warnings.

### 5. Update engine contract and tests

Update `docs/engine-contract.json` to include `setup` in the command list.

Update tests:

- `tests/contracts.test.mjs`
  - `CLI help and Screenslop skill advertise the same command set` should include `setup` through the existing engine contract path.
  - Assert skill/docs mention `setup --json --dry-run` before `setup --json --yes`.
  - Assert `project-setup.md` exists and is referenced from `SKILL.md`.
  - Assert docs do not say skill install writes `.screenslop/config.json`.
- `tests/config.test.mjs`
  - Add CLI tests for `screenslop setup --json --dry-run` and `--json --yes` using a temp fixture project.
  - Assert dry-run does not write.
  - Assert `--yes` writes with `0600` config mode where supported.
  - Assert ambiguous project detection refuses to write.
- Add a small helper fixture builder in the test file or `tests/helpers/` that creates a minimal `.xcodeproj/project.pbxproj` with app bundle IDs and scheme files.

### 6. Keep private dogfood separate

Do not wire private dogfood into `setup`.

After setup, the documented proof sequence should remain:

```bash
screenslop see --surface <surface> --boot --json
screenslop critique artifacts/<run-id> --json
screenslop fix artifacts/<run-id> --finding <finding-id> --source-root <app-root> --dry-run --json
# apply only after review
screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <finding-id> --json
```

The real-runtime smoke helper can still be used for configured dogfood once a finding selector exists:

```bash
node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --surface <surface> \
  --finding <finding-id> \
  --preflight-only
```

## Risks and Mitigations

### Risk: Detection guesses the wrong app target

Mitigation:

- Refuse writes on ambiguity.
- Show candidate lists in JSON and human output.
- Let CLI flags override detection.
- Keep setup dry-run as the default agent path.

### Risk: Agents treat setup as proof

Mitigation:

- Docs and skill must say setup is configuration only.
- Contract tests should require wording that proof starts at runtime capture.

### Risk: More command surface creates drift

Mitigation:

- `setup` should call `planInitConfig`/`writeProjectConfig`, not create a second config pipeline.
- `docs/engine-contract.json` and `tests/contracts.test.mjs` should lock the command list.

### Risk: Private values leak in JSON output

Mitigation:

- Reuse or centralize redaction helpers.
- Add tests for bundle IDs and absolute paths in setup JSON output.
- Do not commit real BoardingReady/JollyTrack config or artifacts.

### Risk: Installed skill cannot find global `screenslop`

Mitigation:

- Skill docs should instruct agents to run `screenslop doctor` first.
- If missing, use `npx screenslop` or a repo-local `node /path/to/screenslop/bin/screenslop.mjs` only when the user points to a checkout.
- Do not add a Pixeltamer-style wrapper yet.

## Verification Steps

Run during implementation:

```bash
node --test tests/config.test.mjs tests/contracts.test.mjs
node bin/screenslop.mjs help
node bin/screenslop.mjs setup --json --dry-run
node bin/screenslop.mjs init --help
npm run cleanup:macos:dry
node bin/screenslop.mjs doctor
npm test
npm pack --dry-run
npm run --silent smoke:package
git diff --check
```

Manual dogfood check after implementation, in BoardingReady or another real iOS project:

```bash
screenslop setup --json --dry-run
screenslop setup --json --yes
screenslop see --surface Onboarding --boot --json
screenslop critique artifacts/<run-id> --json
```

Do not commit the real app `.screenslop/config.json` or generated artifacts.

## ADR

### Decision

Add a first-use `screenslop setup` command plus installed-skill project setup instructions. It will detect project metadata, produce a dry-run config plan, and write only with explicit confirmation.

### Drivers

- Installed skills should be useful immediately inside a real iOS project.
- Project-local Screenslop config is private and must not be silently created by a generic skill installer.
- CLI-owned setup is less drift-prone than agent-only instructions.

### Alternatives considered

- Docs-only checklist: too much agent-by-agent variance.
- Skill-bundled dispatcher wrapper: too much command-surface drift and executable-permission risk for v0.1.
- Auto-writing config during skill install: rejected because `npx skills add` is file placement and cannot safely know private app targets.

### Why chosen

`setup` gives Pixeltamer-like first-use ergonomics while preserving Screenslop's stricter privacy and runtime-proof model.

### Consequences

- One new command must be maintained and included in docs/engine contract.
- Project detection needs conservative heuristics and clear ambiguity output.
- First-use docs become simpler: install skill, run setup dry-run, approve write, capture.

### Follow-ups

- If global CLI discovery remains painful, consider a later skill-bundled dispatcher wrapper.
- After private app dogfood passes, decide whether `setup` should offer `see` as an optional next command in interactive mode.
- Consider adding stable accessibility identifier guidance to setup output when the app has none.

## Available-Agent-Types Roster

Use the installed OMX roles already available in this repo:

- `planner`: architecture/implementation planning and plan revision.
- `architect`: contract review for command/config boundaries.
- `critic`: adversarial review of setup assumptions and stop rules.
- `explorer`: read-only repo lookup, Xcode fixture mapping, docs/code references.
- `executor` / `worker`: implementation across CLI/config/docs/tests.
- `tester`: config/setup test fixtures and regression tests.
- `code-reviewer`: final read-only diff review.
- `verifier`: acceptance checklist, local commands, CI status.
- `docs`: docs and installed-skill prose cleanup.

## Follow-up Staffing Guidance

Recommended execution path: **Team + Ultragoal**.

- Ultragoal owner: one leader keeps `.omx/ultragoal` state and checkpoints evidence.
- Worker lane: implement `project-detection.mjs`, `setup` command, and CLI output.
- Tester lane: add setup/detection tests and contract tests.
- Docs lane: update README/docs/skill references.
- Reviewer/Architect lane: final independent review before commit.
- Verifier lane: run local gates, package smoke, sidecar dry-run, and CI after push.

Suggested role effort:

- `architect`: high reasoning, read-only, before implementation and final review.
- `worker`: high reasoning, edit CLI/config files.
- `tester`: high reasoning, edit tests and fixtures.
- `docs`: medium/high reasoning, edit docs/skill prose.
- `verifier`: high reasoning, final proof.

## Goal-Mode Follow-up Suggestions

Default next command:

```text
$oh-my-codex:ultragoal Execute .omx/plans/screenslop-first-use-project-setup-flow-2026-06-09.md
```

If you want parallel execution from the start, use Team + Ultragoal:

```text
$oh-my-codex:team Execute .omx/plans/screenslop-first-use-project-setup-flow-2026-06-09.md with lanes: worker CLI/setup, tester contracts, docs skill references, verifier gates
```

Use `$ralph` only if you want a single persistent owner to execute and verify sequentially.

## Team Verification Path

Team must prove before shutdown:

1. `setup --json --dry-run` works on a temp fixture and writes nothing.
2. `setup --json --yes` writes a valid ignored config.
3. Ambiguous detection refuses writes.
4. Skill/docs mention dry-run before write.
5. Package smoke includes new skill reference docs.
6. Full repo gates pass.

Ultragoal checkpoints should include:

- changed file list
- test command outputs
- reviewer verdict
- architect verdict
- CI run URL after push

## Plan Changelog

- Created direct plan from Screenslop docs/code inspection and Pixeltamer first-run evidence.
- Chose CLI-owned `setup` over skill-wrapper or installer-time config.
- Added BoardingReady-specific manual dogfood path as a non-committed validation step.
