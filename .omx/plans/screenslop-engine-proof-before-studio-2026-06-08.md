# Screenslop Ralplan: Engine Proof Before Studio

Date: 2026-06-08
Status: revised after Critic iteration 1
Context: `.omx/context/screenslop-engine-proof-20260608T174210Z.md`
Scope: public Screenslop engine, CLI, schemas, runtime smokes, tests, docs, and agent contracts only
Out of scope: Screenslop Studio implementation, private Mac app UI, paid wrapper workflows

## Requirements Summary

The next work should keep Screenslop on the engine until the engine is boringly proven. Studio waits until the public engine can repeatedly prove this loop:

```text
runtime capture -> critique -> selected safe fix -> fresh capture -> fresh critique -> verify
```

Repo evidence behind this plan:

- `docs/session-handoff.md` defines Screenslop as the public engine/CLI/schema/runtime/agent repo and Studio as a private wrapper consumer.
- `docs/commands.md` defines the explicit MVP proof flow and says `fix-session.json` is context, not proof.
- `docs/known-limitations.md` says v0.1 has no full non-Baguette `see` capture fallback and matrix does not yet force appearance/Dynamic Type at runtime.
- `docs/agent-integrations.md` says agents must use runtime evidence and fresh recapture before verified-fix claims.
- Current `main` is green after `8f8c408 ci: update actions for Node 24 runtime`.

## RALPLAN-DR Summary

### Principles

1. Engine first. Studio cannot own or duplicate critique, runtime, schema, or fix logic.
2. Runtime proof beats source confidence. No fresh capture means no verified UI claim.
3. Contracts before features. JSON/schema/package behavior should be locked before expanding rules or wrappers.
4. Public-safe by default. Private app paths, screenshots, configs, and generated local artifacts stay out of commits/packages.
5. Small proof ladders. Each phase must end with machine-checkable evidence, not vibes.

### Decision Drivers

1. The engine already has a working v0.1 loop, but v0.1 proof is sample-app proof, not broad user-app proof.
2. Known limitations are concentrated in runtime fallback/settings enforcement and proof depth, not Studio UI.
3. A reliable Studio later needs stable CLI/schema/artifact contracts now.

### Viable Options

#### Option A: Engine proof ladder before Studio (favored)

Approach:

- Build a staged engine-hardening ladder: contract locks, package smoke, runtime smoke expansion, matrix setting enforcement, dogfood guide.
- Release a patch only after the ladder is green.

Pros:

- Keeps user trust: every claim is backed by fresh evidence.
- Reduces future Studio drift because the engine contract becomes the source of truth.
- Gives agents a reliable CLI path before any UI wrapper exists.

Cons:

- Studio starts later.
- More test and fixture work before visible product polish.

#### Option B: Start Studio shell while engine hardens

Approach:

- Build a basic Mac app wrapper in parallel and patch engine gaps as they appear.

Pros:

- Faster visible product demo.
- Helps discover human workflow needs earlier.

Cons:

- High drift risk.
- Tempting to duplicate evidence browsing, runtime orchestration, and triage logic in private code before engine contracts are stable.
- Violates the user's current direction.

#### Option C: Release v0.1.1 immediately, then harden

Approach:

- Tag a quick patch release for Node 24 workflow cleanup, then start engine proof work.

Pros:

- Makes current `main` state release-visible.
- Low effort.

Cons:

- Does not improve engine confidence.
- Adds release noise before the next meaningful proof milestone.

Favored decision: Option A, with v0.1.1 deferred until at least the contract/package/dogfood gates below are green. If a release is needed sooner, tag only after confirming the release checklist still passes.

## ADR

### Decision

Do the engine proof ladder first. Defer Screenslop Studio until the engine passes explicit contract, package, runtime, matrix, and dogfood gates.

### Drivers

- The public engine is the source of truth.
- Studio should consume, not fork, engine behavior.
- The current v0.1 loop works, but known limitations still block broad confidence.

### Alternatives considered

- Start Studio now: rejected because it invites duplicate runtime/critique logic.
- Tag v0.1.1 immediately: acceptable later, but not a substitute for engine proof.
- Implement broad non-Baguette fallback first: deferred unless Baguette blocks dogfood, because fallback capture is a new runtime surface and should not distract from hardening the primary shipped path.

### Why chosen

The fastest durable path is to make the CLI/core boring and repeatable. Once the engine proves real captures and fixes cleanly, Studio becomes a wrapper instead of a rescue project.

### Consequences

- Short-term work is tests, contracts, smokes, and runtime hardening.
- Studio work is explicitly blocked until the gates pass.
- The next implementation lane should be execution-heavy and verification-heavy, not design-heavy.

### Follow-ups

- After engine proof passes, decide whether to tag v0.1.1 or v0.2.0.
- Only then plan Studio as a consumer of the released engine.

## Boundary Guardrails

These are hard non-goals for the proof ladder:

- No Screenslop Studio implementation.
- No `apps/mac/` placeholder or public Mac app scaffold.
- No private wrapper scaffolding in this repo.
- No duplicate critique, evidence, runtime, schema, or fix logic outside the public engine.
- No repo/package split during this proof ladder unless a testability blocker proves the flat layout is preventing reliable engine validation.
- No committed private `.screenslop/config.json`, private screenshots, private app paths, or dogfood artifacts.

The public engine can preserve future Studio seams by keeping CLI JSON, schemas, artifact layout, and command status vocabulary stable. It should not build Studio-shaped code early just to guess those needs.

## Engine Readiness Gates

Studio remains blocked until all of these are true:

1. **Contract gate**
   - CLI JSON outputs for `see`, `critique`, `fix`, `verify`, and `matrix` have schema or golden-shape tests.
   - Public schemas reject malformed evidence/findings/matrix reports.
   - Package tarball excludes private/session/research artifacts.

2. **Package gate**
   - Extracted npm package smoke can run `doctor`, fixture e2e, matrix dry-run, and package-internal tests without repo-only assumptions.
   - Node 20 and Node 24 CI stay green.

3. **Runtime sample gate**
   - `npm run smoke:runtime` passes from a clean checkout state.
   - The smoke proves baseline capture, critique, safe fix, rebuild, fresh capture, fresh critique, and verify.
   - The smoke report redacts private paths and is parseable JSON.

4. **Matrix gate**
   - Matrix reports prove six cells are never silently dropped.
   - Requested appearance and Dynamic Type are either applied and proven, or explicitly reported as requested-only/unavailable.
   - If settings cannot be forced yet, docs and JSON must make that limitation impossible to miss.

5. **Configured-target preflight gate**
   - A private/uncommitted `.screenslop/config.json` can run configured target preflight without leaking paths.
   - Missing target fields, invalid source roots, and unsafe artifact roots fail with parseable redacted JSON.
   - The gate is machine-checkable without committing private app evidence.

6. **Private dogfood confidence gate**
   - One real app surface runs through capture and critique using private local config.
   - At least one selected real finding is handled through manual or automatic fix, followed by fresh capture, fresh critique, and verify.
   - This gate passes only when the redacted dogfood summary records all of these exact statuses:
     - `captureStatus: passed`
     - `critiqueStatus: passed`
     - `selectedFinding.source: real-app`
     - `fixType: manual` or `fixType: auto`
     - `freshCaptureStatus: passed`
     - `freshCritiqueStatus: passed`
     - `verifyStatus: verified-fixed` for the selected real finding
     - `redactionStatus: passed`
   - `still-present`, `changed`, `unknown`, `missing-baseline`, `unverified`, `blocked`, or no actionable real finding do not pass this gate. They keep Studio blocked.
   - The raw dogfood report and evidence stay local and untracked. Only synthesized generic lessons may be committed.

7. **Agent contract-drift gate**
   - `skills/screenslop/SKILL.md` and `docs/agent-integrations.md` match actual CLI behavior.
   - Agent docs say Baguette is the shipped capture path and do not overclaim fallback capture.
   - At least one fixture or smoke assertion checks that documented command forms still expose the output keys and status vocabulary agents rely on.

## Implementation Plan

### Phase 0: Boundary contract lock

Touchpoints:

- `docs/repo-strategy.md`
- `docs/known-limitations.md`
- `docs/session-handoff.md`
- `README.md` if public positioning needs one sentence

Work:

1. Add a short engine-readiness gate note to the public docs.
2. State the no-Studio/no-`apps/mac`/no-private-wrapper guardrails plainly.
3. Keep the flat package layout unless a validation blocker proves it must change.

Acceptance:

- Docs make it impossible for future agents to start Studio before engine gates pass.
- No Studio code or placeholders are added.

### Phase 1: Contract and package locks

Touchpoints:

- `tests/*`
- `schemas/*.schema.json`
- `examples/json/*.json`
- `package.json`
- `docs/release-checklist.md`

Work:

1. Add or strengthen golden-shape tests for each agent-facing JSON command.
2. Add schema validation tests for evidence, finding, and matrix report examples.
3. Add extracted-package smoke script or test coverage that runs from `npm pack` output.
4. Keep `package.json` `files` whitelist explicit and verify excluded local state.

Acceptance:

- `npm test` passes.
- `npm pack --dry-run` shows no `.omx`, `research`, `artifacts`, `.screenslop`, private docs, or generated source layers.
- Extracted package smoke runs without repo-only paths.

### Phase 2: Runtime smoke hardening

Touchpoints:

- `scripts/smoke-real-runtime.mjs`
- `examples/runtime-smoke-app/`
- `src/evidence/collect-see.mjs`
- `src/runtime/baguette.mjs`
- `src/fix/*`
- `src/verify/*`
- `tests/real-runtime-smoke.test.mjs`

Work:

1. Make `smoke:runtime` produce a compact, stable summary section in addition to the full report path.
2. Add tests for failure stages: missing Baguette, missing target fields, failed fresh capture, failed fresh critique, and unsupported fix.
3. Confirm source restoration always happens after smoke failures.
4. Add a documented `--skip-build` or dry-run-ish preflight only if it does not weaken proof language.

Acceptance:

- `npm run smoke:runtime` passes locally.
- Failure tests prove the smoke exits nonzero with parseable failure JSON.
- No path leaks in default JSON output.

### Phase 3: Matrix proof upgrades

Touchpoints:

- `src/matrix/collect-matrix.mjs`
- `examples/matrix/default.json`
- `schemas/matrix-report.schema.json`
- `tests/matrix.test.mjs`
- `docs/commands.md`
- `docs/known-limitations.md`

Work:

1. Preserve current six-cell bounded MVP behavior.
2. Make applied-vs-requested status explicit for appearance and Dynamic Type.
3. If runtime forcing is feasible through Baguette/XcodeBuildMCP/simctl without brittle hacks, implement it for the sample app.
4. If forcing is not feasible yet, add a hard JSON field such as `settingStatus: requested-only` and keep the limitation documented.

Acceptance:

- Matrix reports include six cells in dry-run and configured modes.
- Each cell records capture status, critique status when requested, and setting application status.
- No cell disappears because config/runtime is missing.

### Phase 4A: Configured-target preflight path

Touchpoints:

- `scripts/smoke-real-runtime.mjs`
- `src/config/project-config.mjs`
- `docs/getting-started.md`
- `docs/commands.md`
- `docs/release-checklist.md`

Work:

1. Write a private-config dogfood checklist that uses `.screenslop/config.json` without committing it.
2. Improve configured target validation errors so a real app setup is fixable without reading source.
3. Add machine-checkable tests for missing fields, unsafe roots, path redaction, and failure modes.
4. Record only public-safe lessons in docs.

Acceptance:

- The sample smoke still passes.
- Configured target preflight fails cleanly when fields are missing.
- Redacted JSON output is parseable and contains no private absolute paths by default.
- Private paths are not included in commits or package output.

### Phase 4B: Private dogfood confidence proof

Touchpoints:

- `scripts/smoke-real-runtime.mjs`
- `src/evidence/collect-see.mjs`
- `src/critique/*`
- `src/fix/*`
- `src/verify/*`
- `docs/release-checklist.md`

Work:

1. Run one real app surface locally with private `.screenslop/config.json`.
2. Capture baseline evidence, critique it, select one finding, apply a manual or automatic fix, recapture, critique fresh evidence, and verify.
3. Write a local redacted dogfood summary artifact with explicit fields:
   - `captureStatus`
   - `critiqueStatus`
   - `fixType` (`manual`, `auto`, or `none`)
   - `selectedFinding.source` (`real-app` required to pass)
   - `freshCaptureStatus`
   - `freshCritiqueStatus`
   - `verifyStatus`
   - `redactionStatus`
   - `publicSafeNotes`
4. Do not commit the private summary unless it contains no private app identity, paths, screenshots, or bundle IDs. Prefer committing only generic lessons.

Acceptance:

- A local redacted dogfood summary artifact exists and contains the exact pass/fail fields above.
- The summary passes a machine leak check against the private target values from local config and runtime output, at minimum:
  - workspace path
  - project path
  - source root
  - bundle ID
  - artifacts root
  - any absolute paths matching private home, external-drive, DerivedData, simulator, or temp locations
- The dogfood gate passes only with `verifyStatus: verified-fixed` for at least one selected real-app finding.
- If the result is `failed`, `blocked`, no target, no actionable finding, or any non-`verified-fixed` verification status, Studio remains blocked.
- The raw dogfood report stays local and untracked. Only synthesized generic lessons may be committed.
- Any blocker is converted into a public engine issue/plan item without leaking private details.

### Phase 5: Agent contract polish

Touchpoints:

- `skills/screenslop/SKILL.md`
- `skills/screenslop/reference/runtime.md`
- `docs/agent-integrations.md`
- `README.md`

Work:

1. Align agent instructions with actual gates.
2. Make Baguette/XcodeBuildMCP boundary precise: Baguette captures; XcodeBuildMCP builds/runs; non-Baguette capture fallback is not shipped.
3. Add the engine readiness gate to docs so future agents do not jump to Studio too early.
4. Add a contract-drift smoke that checks documented command examples still expose expected JSON keys and status words.

Acceptance:

- Docs do not overclaim fallback capture.
- Docs tell agents exactly which commands prove contract, runtime sample, and real app work.
- A drift check fails if agent docs promise command keys/statuses that the CLI no longer emits.

### Phase 6: Release decision

Touchpoints:

- `CHANGELOG.md`
- `docs/release-checklist.md`
- GitHub tag/release only when requested or approved

Work:

1. Decide whether the completed proof ladder is v0.1.1 or v0.2.0.
2. Run release checklist.
3. Tag only after green local + CI evidence.

Acceptance:

- Release tag points to the final proof commit.
- Release notes distinguish sample-app proof from user-app proof.


## Studio Stop Rule

Studio work remains blocked until every Engine Readiness Gate passes. The inverse is also binding:

- If Phase 4B is `failed`, `blocked`, skipped, or unavailable, Studio stays blocked.
- If no private target exists, Studio stays blocked.
- If the private dogfood summary does not show `verifyStatus: verified-fixed` for at least one selected real-app finding, Studio stays blocked.
- If redaction proof fails or is not machine-checked against the private target values, Studio stays blocked.
- The dogfood gate cannot be downgraded to a nice-to-have, skipped because sample smoke passes, or replaced with fixture proof.

## Verification Plan

Required after each implementation phase:

```bash
npm run cleanup:macos:dry
node --check bin/screenslop.mjs
find src tests scripts -name '*.mjs' -print0 | xargs -0 -n1 node --check
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
npm pack --dry-run
```

Required before claiming engine proof complete:

```bash
npm run smoke:runtime
```

Remote:

```bash
git push origin main
gh run list --workflow CI --limit 5
gh run watch <run-id> --exit-status
```

Configured-target preflight and private dogfood, only with private local config:

```bash
node scripts/smoke-real-runtime.mjs --config .screenslop/config.json --identifier <stable.identifier>
```

Private dogfood pass rule:

```json
{
  "captureStatus": "passed",
  "critiqueStatus": "passed",
  "selectedFinding": { "source": "real-app" },
  "fixType": "manual|auto",
  "freshCaptureStatus": "passed",
  "freshCritiqueStatus": "passed",
  "verifyStatus": "verified-fixed",
  "redactionStatus": "passed"
}
```

Leak check rule:

```bash
# Pseudocode: implementation should use exact local config/runtime values, not these placeholders.
node scripts/check-dogfood-redaction.mjs <redacted-summary.json>   --deny-value "$WORKSPACE_PATH"   --deny-value "$PROJECT_PATH"   --deny-value "$SOURCE_ROOT"   --deny-value "$BUNDLE_ID"   --deny-value "$ARTIFACTS_ROOT"   --deny-private-absolute-paths
```

This is not optional for engine-proof completion. If no private target is available, if no actionable real finding exists, if verification is anything other than `verified-fixed`, or if redaction fails, the proof ladder is blocked at Phase 4B and Studio stays blocked. The blocker should be reported without fabricating proof or leaking private details.

## Risks and Mitigations

- Risk: Studio pressure pulls logic into private wrapper.
  - Mitigation: Keep Studio blocked until readiness gates pass; public docs own the gate.

- Risk: Runtime setting enforcement becomes brittle.
  - Mitigation: Prefer explicit `requested-only` evidence over fake claims. Implement forcing only when runtime proof is reliable.

- Risk: Dogfood leaks private paths/screenshots.
  - Mitigation: Keep `.screenslop/config.json`, artifacts, and private screenshots ignored; commit only generic docs/tests.

- Risk: Test expansion slows shipping.
  - Mitigation: Use phase gates. Commit each green phase instead of one giant rewrite.

- Risk: Non-Baguette fallback remains missing.
  - Mitigation: Keep limitation explicit. Prioritize primary Baguette path until dogfood shows fallback is the blocker.

## Available-Agent-Types Roster

Known practical roles for follow-up:

- `planner` / `architect` / `critic` for plan and gate review
- `worker` or `executor` for implementation
- `tester` for regression and fixture expansion
- `verifier` for acceptance checks and remote CI evidence
- `reviewer` for code quality review
- `security` for package/path/privacy leak review
- `docs` for documentation alignment
- `debugger` for failed smokes or runtime issues

## Follow-up Staffing Guidance

Default execution recommendation: **Team + Ultragoal**.

Why:

- Ultragoal owns durable progress, ledger, and stop conditions.
- Team can run parallel lanes for tests/contracts/docs/review while Ultragoal checkpoints evidence.

Suggested lanes:

1. **Contract/test lane** — `tester`, high reasoning
   - Golden JSON tests, schema tests, extracted package smoke.
2. **Runtime lane** — `worker` + `debugger`, high reasoning
   - Runtime smoke failures, source restoration, configured target validation.
3. **Matrix lane** — `worker`, medium/high reasoning
   - Applied/requested setting status and matrix schema/report tests.
4. **Docs/agent lane** — `docs`, medium reasoning
   - Agent contract and readiness gate docs.
5. **Review lane** — `reviewer` + `security` + `verifier`, high reasoning
   - Code review, leak scan, acceptance evidence.

Launch hint:

```bash
$oh-my-codex:ultragoal Execute .omx/plans/screenslop-engine-proof-before-studio-2026-06-08.md
```

Parallel team hint if we want speed:

```bash
$oh-my-codex:team Execute .omx/plans/screenslop-engine-proof-before-studio-2026-06-08.md with tester, worker, docs, reviewer, security, verifier lanes
```

Ralph fallback:

```bash
$oh-my-codex:ralph Execute .omx/plans/screenslop-engine-proof-before-studio-2026-06-08.md
```

Use Ralph only if we intentionally want one persistent owner to grind through the whole sequence. For this scope, Team + Ultragoal is better.

## Goal-Mode Follow-up Suggestions

- `$ultragoal`: default. Use it for the whole engine proof ladder.
- `$team`: pair with Ultragoal when we want parallel test/runtime/docs lanes.
- `$performance-goal`: not a fit yet; no speed target is the main objective.
- `$autoresearch-goal`: not a fit; this is implementation/proof, not research.
- `$ralph`: valid explicit fallback for single-owner persistence, but not the default.

## Changelog

- Drafted engine-only proof ladder.
- Explicitly blocked Studio until readiness gates pass.
- Deferred v0.1.1 until proof work creates a meaningful release boundary.
- Architect iteration 1 requested a harder dogfood gate; split configured-target preflight from private dogfood proof, added boundary guardrails, and added agent docs contract-drift testing.
- Critic iteration 1 requested a hard private dogfood success condition, machine-checkable redaction proof, and explicit Studio stop rule; added `verified-fixed` pass criteria and leak-check requirements.
