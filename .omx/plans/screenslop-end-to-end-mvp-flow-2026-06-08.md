# Screenslop End-to-End MVP Flow Plan

Created: 2026-06-08
Status: planned
Scope: public Screenslop engine/CLI only

## Requirements Summary

Build a small, scriptable end-to-end MVP flow that proves the intended Screenslop loop:

```text
see -> critique -> fix -> see -> critique -> verify
```

The goal is not to expand the critique model or build Studio UI. The goal is to make the current commands work together as one honest workflow with machine-readable artifacts, fixture-backed tests, and at least one smoke path that proves a fix claim only after fresh evidence exists.

Current repo facts:

- Screenslop is the public engine/CLI/schema/agent repo; Screenslop Studio is a private wrapper that should consume the engine, not duplicate critique logic (`docs/session-handoff.md:19-28`, `docs/repo-strategy.md:70-90`).
- Runtime priority is Baguette, then XcodeBuildMCP, then xcodebuild/simctl, then manual evidence (`docs/session-handoff.md:30-46`, `docs/architecture.md:26-33`).
- The architecture rule is runtime-first: do not critique source alone when runtime evidence is available (`docs/architecture.md:3-6`).
- The fix loop already expects fresh evidence after edits before a verified claim (`docs/architecture.md:90-101`, `docs/commands.md:111-146`).
- `screenslop see` is wired to `collectSee`, supports dry-run/runtime options, and returns JSON when requested (`bin/screenslop.mjs:157-175`).
- `collectSee` can create dry-run bundles, or capture Baguette screenshot + accessibility tree + optional logs when Baguette is available (`src/evidence/collect-see.mjs:26-58`, `src/evidence/collect-see.mjs:68-160`).
- Evidence bundles already write `evidence.json` plus `summary.md` under `artifacts/<run-id>` (`src/evidence/bundle.mjs:13-44`, `src/evidence/bundle.mjs:55-105`).
- `screenslop critique` reads one bundle and writes findings from deterministic evidence/accessibility/layout/log detectors (`src/critique/collect-critique.mjs:18-45`).
- `screenslop fix` plans and can apply only selected safe SwiftUI fixes, with `fix-plan.json`, `fix.md`, and optional `fix-session.json` (`docs/commands.md:77-112`, `src/fix/collect-fix.mjs:28-117`).
- `screenslop verify` now compares baseline findings with a fresh bundle and writes `verification.json` / `verification.md`; it does not capture fresh evidence itself (`docs/commands.md:113-146`, `src/verify/collect-verify.mjs:17-43`).
- Agent integrations should rely on strict `--json` forms and always recapture or verify after edits (`docs/agent-integrations.md:61-83`).
- Every finished implementation slice must be committed and pushed after verification, per user instruction.

## Non-Goals

- Do not build Screenslop Studio.
- Do not implement `screenslop matrix` beyond preserving its placeholder behavior.
- Do not broaden auto-fixes beyond the current safe MVP rules unless the e2e harness proves a missing contract blocks the loop.
- Do not add a second workflow engine or hidden source of truth. The CLI/core artifacts remain canonical.
- Do not install or update global dependencies without explicit confirmation.

## Acceptance Criteria

1. A single command or script exercises the MVP loop on fixture-backed evidence without needing a real simulator:
   - baseline `see` or fixture bundle creation
   - baseline `critique`
   - selected `fix` dry-run/apply path against a controlled fixture source root
   - fresh evidence bundle creation
   - fresh `critique`
   - `verify` with `--fresh-bundle`
2. The e2e result is machine-readable JSON and includes paths for all created artifacts.
3. The flow refuses to call a finding verified without a fresh bundle and fresh critique evidence.
4. The flow records fix-session context when a fix step ran, but does not treat `fix-session.json` as proof by itself.
5. Fixture-backed tests cover at least one `verified-fixed`, one `still-present`, and one `unknown` or `changed` path through the whole orchestration layer.
6. Existing command tests still pass: `npm test` remains green.
7. Required project gates pass before completion:
   - `node bin/screenslop.mjs doctor`
   - `npm test`
   - `npm run cleanup:macos:dry`
8. `screenslop matrix` remains placeholder-only after any CLI wiring change.
9. Docs explain the operator flow and distinguish fixture/dry-run proof from real runtime proof.
10. The implementation commit is pushed to `origin/main` after verification.

## Proposed Design

### Option A — Add `screenslop run` as the workflow orchestrator

Approach: introduce a new CLI command that owns the full loop.

Pros:

- Clean user-facing command.
- Easy to document as the final happy path.

Cons:

- Adds another public command before command semantics are stable.
- Risks hiding the key evidence boundaries behind a big wrapper.
- More surface area than needed for MVP verification.

### Option B — Add an internal e2e harness plus docs first

Approach: keep public commands as-is, add a test/helper harness that runs the loop using the current CLI/core functions and fixture bundles.

Pros:

- Proves the real contracts without inventing a new command too early.
- Keeps `see`, `critique`, `fix`, and `verify` individually inspectable.
- Lower regression risk after the recent `matrix` routing issue.

Cons:

- Less polished as a human-facing feature.
- Users still need docs or a script to follow the sequence manually.

### Option C — Add `screenslop verify-flow` as a hidden/dev command

Approach: expose a dev-only orchestration command for agents and CI.

Pros:

- Easier smoke testing from one CLI entrypoint.
- Avoids committing to a final public `run` command.

Cons:

- Hidden commands become undocumented contracts quickly.
- Adds CLI branching without strong product value yet.

## Decision

Choose **Option B: internal e2e harness plus docs first**.

Why: the project just stabilized command boundaries after a CLI routing regression. The safest next move is to prove the existing commands as composable units before adding another public command. If the harness shows repeated operator friction, promote it later into a real command with evidence from the harness.

## Implementation Steps

### 1. Map the current artifact contract and fixture needs

Files to inspect/update:

- `tests/fixtures/evidence/problem/`
- `tests/fixtures/source/` or a new focused SwiftUI fixture source directory
- `src/evidence/bundle.mjs`
- `src/critique/load-evidence.mjs`
- `src/fix/load-fix-input.mjs`
- `src/verify/load-verify-input.mjs`

Work:

- Confirm which fixture bundle already contains a finding that can be safely fixed.
- If needed, add a tiny SwiftUI fixture file with a unique `.accessibilityIdentifier(...)` that triggers `ax.missing-name` or `layout.touch-target`.
- Keep fixture files small and explicit so failed e2e diffs are easy to read.

Acceptance:

- There is a known baseline finding ID that can move through critique -> fix -> verify.
- Fixture source can be copied to a temp directory and patched without touching repo source.

### 2. Add a reusable e2e orchestration helper for tests

Preferred file:

- `tests/helpers/e2e-flow.mjs`

Work:

- Build a helper that creates a temp workspace.
- Copy baseline fixture evidence and source fixture into the temp workspace.
- Run the same core functions the CLI uses:
  - `collectCritique`
  - `collectFix`
  - copy or mutate the fresh fixture bundle to represent post-fix runtime evidence
  - `collectCritique` again on fresh evidence
  - `collectVerify`
- Return a compact JSON summary with bundle paths, selected finding IDs, fix-session path, verification summary, and artifact paths.

Acceptance:

- Helper has no dependency on global simulator state.
- Helper returns enough data for tests to assert exact statuses and artifact existence.
- Helper does not skip fresh critique.

### 3. Add end-to-end tests

Preferred file:

- `tests/e2e-flow.test.mjs`

Work:

- Test `verified-fixed` after a fixture source/fresh evidence change removes the same stable finding.
- Test `still-present` when fresh evidence keeps the same stable key.
- Test one uncertain path, either:
  - `changed` when the same rule remains on a different stable key, or
  - `unknown` when the baseline lacks stable evidence.
- Test that missing `--fresh-bundle` remains a hard error through the CLI or core path.
- Smoke `screenslop matrix` placeholder again after any command wiring changes.

Acceptance:

- Tests assert artifact files exist, not only returned statuses.
- Tests read `verification.json` and confirm it matches returned summaries.
- Tests fail if the flow claims proof without fresh evidence.

### 4. Add a developer-facing smoke script only if tests show repeated boilerplate

Preferred file, only if justified:

- `scripts/smoke-e2e-flow.mjs`

Work:

- Wrap the same helper used by tests.
- Print concise JSON by default or with `--json`.
- Keep it under `scripts/`, not as a public command yet.

Acceptance:

- The script is optional. If the test helper is enough, skip this step.
- If added, it exits nonzero on any failed stage and reports the exact stage.

### 5. Update docs for the operator flow

Files:

- `docs/commands.md`
- `docs/agent-integrations.md`
- optionally `docs/session-handoff.md`

Work:

- Add the canonical MVP sequence:

```bash
screenslop see --surface Settings --json
screenslop critique artifacts/<baseline-run> --json
screenslop fix artifacts/<baseline-run> --finding <id> --source-root <app-root> --apply --yes --label "Save settings" --json
screenslop see --surface Settings --json
screenslop critique artifacts/<fresh-run> --json
screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id> --fix-session artifacts/<baseline-run>/fix-session.json --json
```

- Spell out what each command proves.
- State that fixture/dry-run tests prove the command contract, while real UI quality claims still require runtime capture.

Acceptance:

- Docs do not imply `fix-session.json` proves a fix.
- Docs preserve runtime-first language.
- Agent integration docs keep the CLI as the stable contract.

### 6. Run quality gates, commit, and push

Commands:

```bash
node --check bin/screenslop.mjs
for f in src/**/*.mjs tests/**/*.mjs scripts/**/*.mjs; do node --check "$f"; done
node bin/screenslop.mjs doctor
npm test
npm run cleanup:macos:dry
node bin/screenslop.mjs matrix
```

Commit/push:

```bash
git add <changed-files>
git commit -m "test: add screenslop e2e MVP flow"
git push origin main
```

Acceptance:

- Commit includes test evidence trailers.
- Push succeeds to `origin/main`.
- If sidecars appear, preview with `npm run cleanup:macos:dry`, clean through the cleanup script only, then rerun affected gates.

## Risks and Mitigations

- Risk: fixture-backed e2e tests get mistaken for real runtime proof.
  - Mitigation: docs and test names must say fixture-backed contract proof. Runtime quality still needs `screenslop see` against a live app.

- Risk: adding a public orchestration command too early creates command drift.
  - Mitigation: keep orchestration inside tests/helpers or scripts for this slice.

- Risk: `fix` can patch source, so e2e tests may edit repo files by accident.
  - Mitigation: copy fixture source to a temp directory and pass that temp path as `--source-root`.

- Risk: fresh evidence is faked too loosely and verify becomes a tautology.
  - Mitigation: fresh bundle must be a separate bundle with its own critique artifacts; tests must inspect `freshFindingsPath` and `verification.json`.

- Risk: another adjacent CLI command regresses.
  - Mitigation: keep explicit `screenslop matrix` smoke in the verification checklist.

## Verification Steps

Minimum before claiming done:

```bash
node --check bin/screenslop.mjs
for f in src/**/*.mjs tests/**/*.mjs scripts/**/*.mjs; do node --check "$f"; done
node bin/screenslop.mjs doctor
npm test
npm run cleanup:macos:dry
node bin/screenslop.mjs matrix
```

If a smoke script is added:

```bash
node scripts/smoke-e2e-flow.mjs --json
```

If real simulator evidence is available during execution:

```bash
node bin/screenslop.mjs see --surface <surface> --json
node bin/screenslop.mjs critique artifacts/<baseline-run> --json
node bin/screenslop.mjs see --surface <surface> --json
node bin/screenslop.mjs critique artifacts/<fresh-run> --json
node bin/screenslop.mjs verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --json
```

Real simulator evidence is a bonus for this plan unless the implementation changes runtime capture behavior.

## Available-Agent-Types Roster

Use the installed OMX role names from the current prompt catalog:

- `planner` — refine scope if implementation uncovers command-contract drift.
- `architect` — review orchestration boundaries and prevent a premature public command.
- `critic` — challenge proof language and fixture-vs-runtime claims.
- `worker` — implement helpers, tests, docs, and small scripts.
- `tester` — strengthen fixture coverage and regression assertions.
- `reviewer` — inspect maintainability and command boundary safety.
- `verifier` — run gates and check acceptance criteria.
- `docs` — tighten operator-facing command docs.
- `security` — optional; only needed if scripts start executing arbitrary user-provided shell commands.

## Follow-up Staffing Guidance

Recommended execution path: **Team + Ultragoal** for parallel evidence, or `$ralph` only if the user explicitly wants the legacy persistent single-owner loop.

Suggested lanes:

- Worker lane, reasoning high: implement `tests/helpers/e2e-flow.mjs` and any fixture source.
- Tester lane, reasoning high: write `tests/e2e-flow.test.mjs` and enforce artifact/status assertions.
- Docs lane, reasoning medium: update `docs/commands.md` and `docs/agent-integrations.md` after tests settle.
- Reviewer lane, reasoning high: check command-boundary regressions, especially `matrix`.
- Verifier lane, reasoning high: run final gates, inspect outputs, confirm commit/push.

Launch hints:

```bash
$oh-my-codex:team Execute .omx/plans/screenslop-end-to-end-mvp-flow-2026-06-08.md
```

Durable goal option:

```bash
$oh-my-codex:ultragoal Execute .omx/plans/screenslop-end-to-end-mvp-flow-2026-06-08.md
```

Legacy single-owner option:

```bash
$oh-my-codex:ralph Execute .omx/plans/screenslop-end-to-end-mvp-flow-2026-06-08.md
```

Team verification path:

1. Team returns changed files plus per-lane evidence.
2. Verifier reruns syntax checks, doctor, tests, cleanup dry-run, and CLI smoke.
3. Leader commits with trailers and pushes to `origin/main`.
4. Ultragoal, if used, checkpoints the pushed commit hash and verification evidence.

## Goal-Mode Follow-up Suggestions

- Use `$ultragoal` by default if you want durable tracked execution across turns.
- Use `$team` with Ultragoal if you want faster parallel implementation and a durable completion ledger.
- Use `$ralph` only when you explicitly want one persistent execution owner to keep retrying until architect-approved.
- Do not use `$autoresearch-goal`; this is an implementation/test-integration task, not a research deliverable.
- Do not use `$performance-goal`; no measurable performance target is part of this slice.

## ADR

Decision: prove the end-to-end MVP loop with an internal fixture-backed e2e harness and docs before adding a new public orchestration command.

Drivers:

- Keep runtime evidence boundaries honest.
- Avoid command drift after recently wiring `verify`.
- Make agent-facing proof machine-readable and testable.

Alternatives considered:

- Add `screenslop run`: rejected for now because it adds public API surface before the smaller contracts are fully proven.
- Add hidden `screenslop verify-flow`: rejected because hidden commands often become undocumented public behavior.
- Use only manual docs: rejected because the MVP needs regression tests that fail when proof semantics drift.

Why chosen:

The internal harness locks behavior without widening the CLI. Once the flow is stable, a public command can be designed from real friction instead of guessing.

Consequences:

- The next commit likely adds tests and docs more than production code.
- Humans will still run separate commands for now.
- The harness becomes the safety net for future public orchestration.

Follow-ups:

- Promote the helper into a public command only after at least one real-app runtime path proves the sequence.
- Add a real simulator smoke once a stable sample app/surface exists.
- Keep `matrix` placeholder smoke in future CLI command work.

## Plan Changelog

- Created direct plan from current docs and code contracts.
- Chose internal e2e harness over a new public command.
- Added commit/push as an explicit completion requirement.
