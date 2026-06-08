# Screenslop Rest-to-v0 Consensus Plan

Created: 2026-06-08
Status: approved-for-execution
Scope: public Screenslop engine/CLI/agent repo only
Context snapshot: `.omx/context/screenslop-rest-to-v0-<timestamp>.md`

## Requirements Summary

Screenslop has crossed the first real-runtime proof: the sample app loop can build, see, critique, fix, recapture, critique again, and verify a selected finding. The remaining work should turn that proof into a usable public engine v0.1 without drifting into Screenslop Studio.

Define **v0.1 done** as:

1. A user can configure a real app target without editing scripts, with a versioned config that can migrate the existing `.screenslop/config.json` shape.
2. Screenslop can build/run or attach to that target, capture evidence, critique, fix one safe finding, recapture, and verify.
3. A small matrix can stress the same surface across a bounded set of devices/settings.
4. Agents have a reliable skill/contract and machine-readable outputs.
5. Docs, schemas, and smoke gates match the actual shipped behavior.
6. The private Studio app can wrap the public CLI/core later without duplicating logic.

Non-goals for v0.1:

- No Screenslop Studio implementation.
- No broad auto-fix rewrite engine.
- No full design-system learning unless the lower-level runtime loop is stable.
- No MCP server unless CLI packaging is already stable.
- No package-layout migration unless flat layout becomes a blocker.

## RALPLAN-DR Summary

### Principles

1. Runtime evidence remains the source of truth.
2. Public engine boundaries beat Studio-shaped shortcuts.
3. Configuration must be explicit, versioned, and migratable before automation expands.
4. Matrix and learn should consume the same evidence/finding contracts, not fork them.
5. Verification claims require fresh capture plus fresh critique.

### Decision Drivers

1. **Dogfoodability:** a real user app target is more valuable than more sample-only proof.
2. **Anti-drift:** docs, schemas, skills, and CLI contracts must move together.
3. **Small reliable loops:** ship narrow matrix/config/support before richer visual/design claims.

### Viable Options

#### Option A — Build `matrix` next

Pros:

- Aligns with the roadmap phase after fix/verify.
- Exercises runtime capture across sizes/settings.
- Gives Screenslop a strong stress-test story.

Cons:

- Without reusable app config, matrix would likely hard-code sample/runtime assumptions.
- It could multiply runtime failures before target configuration is solved.

Verdict: useful, but not first.

#### Option B — Build user-app target configuration + reusable runtime runner first

Pros:

- Turns sample smoke into a real user workflow.
- Gives `matrix`, `watch`, and future Studio the same target contract.
- Reduces duplicated build/run logic in scripts.

Cons:

- Less visually exciting than matrix.
- Requires careful config UX and error contracts.

Verdict: choose this as the next foundation.

#### Option C — Build `learn` / DESIGN.md next

Pros:

- Moves toward deeper product value and design-system awareness.
- Uses gathered research around token/design extraction.

Cons:

- Current evidence is still mostly screenshot/AX/logs, not enough for reliable typography/color/motion claims.
- Could overclaim before matrix/user-app captures are stable.

Verdict: defer until user-app + matrix evidence is real.

## Decision

Build the remaining public-engine v0.1 in this order:

1. **Target config + reusable runtime runner**
2. **User-app dogfood smoke**
3. **Matrix MVP**
4. **Agent/docs/schema release polish**
5. **Package/release boundary check**
6. **Optional `learn` spike after evidence breadth improves**

Config is the first seam, but it is not frozen at Phase 1. Phase 1 must introduce `schemaVersion: 1`, validation, and migration from the current config shape. The config contract stays explicitly **0.x / provisional** until Matrix MVP has exercised it in Phase 3. The v0.1 tag should not happen until Phase 5 either freezes that schema or records a deliberate pre-1.0 instability policy.

## Acceptance Criteria

### Target config and runtime runner

- `screenslop init` can create or migrate `.screenslop/config.json` with `schemaVersion: 1`, workspace/project path, scheme, bundle ID, default device, source root, and artifact root.
- Existing config keys are mapped instead of duplicated: `artifactsDir` becomes the canonical artifact-root field unless Phase 1 explicitly chooses another name and updates docs in the same slice; `sourceHints` stays evidence/source-hint metadata and does not masquerade as `sourceRoot`; `runtimePreference`, `preferredRuntime`, `defaultSurface`, `defaultScheme`, and `defaultBundleId` are migrated or preserved with documented semantics.
- Config updates are real: existing files are read, validated, migrated, and rewritten only after confirmation in interactive mode or with an explicit non-interactive flag. If migration cannot be safe, the command emits JSON/human guidance and exits nonzero instead of silently keeping two shapes.
- Config can be supplied non-interactively with flags for CI/agents.
- Phase 1 marks config schema as `0.x / provisional until matrix`; Phase 5 decides whether to freeze it for v0.1 or document pre-1.0 instability.
- Existing sample smoke can use the shared runtime runner instead of private build/run logic.
- Runtime failures emit JSON with stage, command, status, stdout/stderr snippets, and no fixture fallback.
- `npm test` covers config parsing, target resolution, migration from the current config shape, and failure JSON without requiring a simulator.

### User-app dogfood smoke

- A new script or command can run the e2e loop against a configured target app, not just `examples/runtime-smoke-app`.
- It requires explicit `--source-root` / config source root before applying fixes.
- It refuses to verify unless fresh `see` and fresh `critique` succeed.
- Negative tests prove verify does not run and the smoke exits nonzero when fresh capture is stale, missing, or failed, or when fresh critique is absent.
- It prints one JSON report and exits nonzero on any missing runtime dependency, build failure, capture failure, missing finding, fix failure, fresh capture failure, or verification failure.

### Matrix MVP

- `screenslop matrix` stops being a placeholder only when it can write a real matrix report.
- MVP matrix covers this fixed initial profile set: default configured iPhone profile, one large iPhone profile, light appearance, dark appearance, normal Dynamic Type, and one accessibility Dynamic Type size. If no config exists, the default configured iPhone cell is reported as unavailable with explicit no-config evidence; if a local simulator cannot provide any other cell, the report marks that cell unavailable with evidence instead of shrinking the contract silently.
- Each matrix cell writes its own evidence bundle and the matrix report links to each bundle.
- If a cell fails, the matrix report records the failure without pretending the whole surface is clean.
- Existing placeholder no-artifact test is updated only when matrix writes real artifacts.

### Agent/docs/schema release polish

- `skills/screenslop/SKILL.md` matches current commands and runtime-first rules.
- `docs/session-handoff.md` no longer says the next step is wiring `see` or first `critique`.
- `docs/commands.md`, `docs/architecture.md`, `docs/agent-integrations.md`, and schemas describe the actual JSON contracts.
- `doctor`, fixture smoke, real-runtime sample smoke, user-app smoke when configured, `npm test`, cleanup dry-run, and matrix smoke are documented.

### Release boundary

- The public repo keeps engine/CLI/agent/schema/runtime logic only.
- Studio remains a consumer wrapper in docs.
- Package-layout migration is explicitly accepted or deferred with rationale before v0.1 tag.
- Commit and push are required for each execution slice.

## Implementation Phases

### Phase 1 — Config and target model

Files likely touched:

- `bin/screenslop.mjs`
- `src/runtime/*`
- `src/evidence/collect-see.mjs`
- new `src/config/*`
- `tests/*config*.test.mjs`
- `docs/commands.md`

Work:

1. Define a small `schemaVersion: 1` config schema for target app metadata.
2. Add a field-mapping table for the current shipped config keys: `runtimePreference`, `preferredRuntime`, `defaultSurface`, `defaultScheme`, `defaultBundleId`, `artifactsDir`, and `sourceHints`.
3. Extend `screenslop init` so it can run as an interactive wizard and via flags.
4. Add safe migration behavior for existing `.screenslop/config.json`: read, validate, preview/confirm, then rewrite; in JSON/non-interactive mode require an explicit migration flag.
5. Add target resolution helpers that return workspace/project, scheme, bundle ID, source root, device preference, and artifact root without inventing missing write scopes.
6. Keep config reads explicit; do not silently guess source roots for apply flows.
7. Add tests for missing config, current-shape migration, partial config, flag overrides, explicit migration refusal, `artifactsDir` naming/docs alignment, and JSON output.

Verification:

```bash
node --check bin/screenslop.mjs
for f in src/**/*.mjs tests/**/*.mjs scripts/**/*.mjs; do node --check "$f"; done
npm test
node bin/screenslop.mjs init --help
node bin/screenslop.mjs init --json --dry-run
node bin/screenslop.mjs init --json --migrate --dry-run
node bin/screenslop.mjs doctor
npm run cleanup:macos:dry
```

### Phase 2 — Shared runtime smoke runner and user-app dogfood path

Files likely touched:

- `scripts/smoke-real-runtime.mjs`
- new `src/runtime/run-target.mjs` or `src/runtime/xcodebuildmcp-runner.mjs`
- `src/runtime/device-selection.mjs`
- `tests/real-runtime-smoke.test.mjs`
- `docs/commands.md`

Work:

1. Extract the RuntimeSmoke script’s build/run stage into a reusable helper.
2. Keep `examples/runtime-smoke-app` as the fixture target for `npm run smoke:runtime`.
3. Add a configured-target smoke path that reads `.screenslop/config.json` or accepts flags.
4. Keep JSON-only reports and stage-specific failures.
5. Add a dogfood checklist for one real app target, but do not commit private app paths.

Verification:

```bash
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
npm run smoke:runtime
node scripts/smoke-real-runtime.mjs --config .screenslop/config.json  # only when local config exists
node bin/screenslop.mjs doctor
npm run cleanup:macos:dry
```

### Phase 3 — Matrix MVP

Files likely touched:

- `bin/screenslop.mjs`
- new `src/matrix/*`
- `src/evidence/collect-see.mjs`
- `tests/e2e-flow.test.mjs` or new `tests/matrix.test.mjs`
- `docs/commands.md`
- `docs/roadmap.md`

Work:

1. Define a matrix profile JSON shape.
2. Start with the six-cell default profile defined in Acceptance Criteria: default configured iPhone, one large iPhone, light appearance, dark appearance, normal Dynamic Type, and one accessibility Dynamic Type size.
3. For each cell, build/run if target config is present, then `see`, optionally `critique`, and write a matrix report; when config is absent, keep the default configured iPhone cell in the report as unavailable instead of dropping it.
4. Preserve partial failure evidence per cell.
5. Update placeholder tests into real artifact tests only when matrix is wired.
6. Feed matrix findings back into the config schema decision: if matrix needs new target/profile fields, revise the provisional schema before Phase 5 freezes or documents it.

Verification:

```bash
npm test
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
npm run cleanup:macos:dry
```

### Phase 4 — Agent contract and docs cleanup

Files likely touched:

- `skills/screenslop/SKILL.md`
- `docs/session-handoff.md`
- `docs/commands.md`
- `docs/architecture.md`
- `docs/agent-integrations.md`
- `schemas/*.json`
- `README.md`

Work:

1. Update the skill to current command sequence and v0.1 stop rules.
2. Remove stale handoff text that describes already-completed `see`/`critique` work as next.
3. Document sample smoke vs user-app smoke vs fixture smoke.
4. Add JSON contract examples for `see`, `critique`, `fix`, `verify`, and matrix.
5. Add release checklist and known limitations.

Verification:

```bash
npm test
node bin/screenslop.mjs doctor
npm run cleanup:macos:dry
```

### Phase 5 — Release boundary and packaging check

Files likely touched:

- `package.json`
- `README.md`
- `docs/repo-strategy.md`
- possibly `packages/*` only if migration is chosen

Work:

1. Decide whether flat layout is acceptable for v0.1.
2. Reconcile `docs/repo-strategy.md`: its current “once see and critique are real” migration trigger is already met, so either update the trigger to “after matrix/user-app smoke stabilizes” or execute the migration as its own no-feature slice.
3. If flat layout stays, document the new migration trigger and why deferral reduces drift.
4. If package layout migrates, do it as a dedicated slice with no feature changes.
5. Resolve any public `apps/mac` or Studio-shaped placeholder: remove it, rename/document it as a non-shipping placeholder, or record a rationale that does not blur the public/private boundary.
6. Freeze or explicitly mark the config schema as pre-1.0 unstable based on matrix feedback.
7. Add npm package smoke: `npm pack --dry-run`, bin execution from pack output, and no ignored generated artifacts in package.
8. Tag only after all gates pass.

Verification:

```bash
npm test
npm pack --dry-run
node bin/screenslop.mjs doctor
npm run smoke:runtime
npm run cleanup:macos:dry
git status --short
```

### Phase 6 — Deferred `learn` spike

Trigger this only after Phases 1-4 are stable.

Files likely touched:

- `bin/screenslop.mjs`
- new `src/learn/*`
- `docs/commands.md`
- `docs/research-adoptions.md`

Work:

1. Inspect tokextract or token-source candidates before wiring.
2. Define what evidence can support DESIGN.md claims.
3. Produce a read-only `learn --from-artifacts` MVP before live capture automation.
4. Avoid typography/color/motion overclaims unless evidence supports them.

## Risks and Mitigations

- Risk: config-first locks a schema before matrix stress proves the shape.
  - Mitigation: add `schemaVersion`, migration, and an explicit provisional-until-matrix policy; Phase 5 freezes or documents instability only after matrix feedback.

- Risk: matrix work starts before target config and duplicates build/run logic.
  - Mitigation: Phase 1 and 2 are prerequisites for Phase 3.

- Risk: user-app dogfood leaks private project paths or Studio assumptions.
  - Mitigation: keep local `.screenslop/config.json` ignored; docs use placeholders; Studio stays out of public repo.

- Risk: matrix creates flaky runtime gates.
  - Mitigation: keep unit tests simulator-free; matrix live gate is explicit; failures are cell-level artifacts.

- Risk: `learn` creates design claims without sufficient evidence.
  - Mitigation: defer until matrix/user-app evidence is broader; start with read-only artifact learning.

- Risk: package migration churn hides behavior changes.
  - Mitigation: either defer migration or run it as a separate no-feature slice with before/after gate evidence.

## Verification Plan

Every execution slice must finish with:

```bash
node --check bin/screenslop.mjs
for f in src/**/*.mjs tests/**/*.mjs scripts/**/*.mjs; do node --check "$f"; done
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
node bin/screenslop.mjs doctor
npm run cleanup:macos:dry
```

Runtime slices also require:

```bash
npm run smoke:runtime
```

User-app slices require a local, uncommitted config smoke when the operator supplies one:

```bash
node scripts/smoke-real-runtime.mjs --config .screenslop/config.json
```

Matrix slices require matrix dry-run and live report checks.

## Available-Agent-Types Roster

Use these installed OMX role names for execution follow-up:

- `planner` — refine plan if product scope changes.
- `architect` — review config/runtime boundaries and matrix shape.
- `critic` — challenge proof semantics and anti-drift claims.
- `worker` — implement config, runtime helpers, and CLI slices.
- `tester` — add simulator-free tests and live-gate scripts.
- `debugger` — diagnose XcodeBuildMCP/Baguette simulator failures.
- `verifier` — run gates, inspect reports, confirm HEAD/origin state.
- `docs` — update docs, skill, README, and release notes.
- `security` — review config path handling and source-root write constraints.

## Follow-up Staffing Guidance

### Recommended default: `$ultragoal` + `$team`

Use Ultragoal as the durable leader/ledger and Team for parallel work when a phase has separable lanes.

Suggested launch:

```text
$oh-my-codex:ultragoal Execute .omx/plans/screenslop-rest-to-v0-2026-06-08.md
```

For parallel implementation phases:

```text
$oh-my-codex:team Execute .omx/plans/screenslop-rest-to-v0-2026-06-08.md
```

Suggested Team lanes:

- `worker` high reasoning: config/runtime implementation.
- `tester` high reasoning: unit tests, fake runtime tests, smoke harness tests.
- `docs` medium reasoning: docs/skill/README updates after implementation stabilizes.
- `security` medium reasoning: path/source-root/config write-scope review.
- `verifier` high reasoning: full gate and live smoke evidence.

Team verification path:

1. Worker returns changed files and local command evidence.
2. Tester returns simulator-free test coverage and failures fixed.
3. Security confirms no unsafe source-root/config behavior.
4. Verifier runs static checks, npm test, fixture smoke, real-runtime smoke, doctor, cleanup dry-run, matrix checks, commit/push SHA match.
5. Ultragoal checkpoints the phase as complete only after pushed commit evidence.

### Ralph fallback

Use `$ralph` only when one phase needs persistent single-owner live-runtime retry pressure, such as Baguette/XcodeBuildMCP simulator failures. Ralph is not the default durable follow-up now; Ultragoal is.

## Goal-Mode Follow-up Suggestions

- `$ultragoal` — default for the remaining v0.1 work because it needs durable phased completion tracking.
- `$team` — best paired with Ultragoal for Phase 1-4 parallel lanes.
- `$ralph` — explicit fallback for a single runtime-heavy phase that needs repeated live verification.
- `$autoresearch-goal` — not recommended; this is implementation planning, not a research deliverable.
- `$performance-goal` — not recommended unless matrix/runtime speed becomes the primary objective.

## ADR

Decision: Finish Screenslop v0.1 by building target config and reusable runtime orchestration first, then user-app dogfood, then matrix MVP, then agent/docs/schema release polish, with `learn` deferred until the evidence base is broader.

Drivers:

- The sample smoke proved the loop, but v0.1 needs user-app repeatability.
- Matrix needs target config to avoid hard-coded sample assumptions.
- Docs/skills/schemas must match CLI behavior before release.

Alternatives considered:

- Build matrix immediately: rejected as first step because target config would be missing.
- Build learn/DESIGN.md immediately: deferred because current evidence cannot support broad design-system claims yet.
- Start Studio now: rejected because the public engine must remain the source of truth first.

Why chosen:

Target config creates the stable seam every later feature needs: user-app smoke, matrix, watch, Studio wrapper, and agent integrations. It is the smallest next step that reduces future drift.

Consequences:

- The next work may feel less flashy than matrix, but it makes matrix durable.
- Real app proof will require a local private config that should not be committed.
- Package migration remains a separate decision, not hidden inside feature work.
- Config becomes a published contract as soon as `init` writes it, so it must carry `schemaVersion` and migration behavior before broader automation depends on it.

Follow-ups:

- Pick the first private app target for dogfood when execution starts.
- Decide package-layout migration before tagging v0.1 and update `docs/repo-strategy.md` so docs do not disagree on the trigger.
- Resolve any public Studio-shaped placeholder such as `apps/mac` before v0.1 boundary claims.
- Revisit `learn` only after matrix/user-app evidence exists.

## Plan Changelog

- Drafted after commit `260ed7a` real-runtime smoke MVP.
- Chose config/user-app foundation before matrix and learn.
- Kept Studio implementation out of scope.

- Architect ITERATE feedback applied: added config schemaVersion/migration/provisional policy, existing-field mapping, repo-strategy trigger reconciliation, `apps/mac` boundary resolution, exact matrix cells, and stale/missing fresh-capture negative tests.
- Architect APPROVE follow-up applied: Phase 3 work step now matches the six-cell matrix acceptance criterion.
- Critic APPROVE follow-up applied: pinned the initial config literal to `schemaVersion: 1`, required docs alignment for `artifactsDir` naming in the same slice, and clarified matrix no-config behavior.
