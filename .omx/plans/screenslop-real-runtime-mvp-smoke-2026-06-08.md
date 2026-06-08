# Screenslop Real-Runtime MVP Smoke Plan

Created: 2026-06-08
Status: planned
Scope: public Screenslop engine/CLI only

## Requirements Summary

Build the first **real runtime** smoke for Screenslop. The fixture e2e flow already proves command composition. This slice must prove that a live simulator screen can go through the same loop:

```text
build/run sample app -> see -> critique -> fix -> rebuild/run -> see -> critique -> verify
```

This is not a `matrix` implementation and not Screenslop Studio work. The smoke should stay small, repeatable, and honest: if runtime capture fails, it reports failure instead of falling back to fixture proof.

## Evidence-Backed Repo Facts

- Screenslop is the public engine/CLI/agent repo, while Screenslop Studio is private and should consume the engine rather than duplicating critique logic (`AGENTS.md:13-21`, `docs/session-handoff.md:19-28`, `docs/repo-strategy.md:70-90`).
- Runtime priority is Baguette first, then XcodeBuildMCP, then xcodebuild/simctl, then manual evidence (`AGENTS.md:15-19`, `docs/session-handoff.md:30-46`, `docs/architecture.md:26-33`).
- The core rule is runtime-first: do not critique Apple UI from source alone when runtime evidence can be captured (`AGENTS.md:21`, `docs/architecture.md:3-6`).
- Evidence bundles are the artifact, and reports are derived from them (`docs/architecture.md:35-53`).
- The fix loop expects build/run and fresh capture before a verified claim (`docs/architecture.md:90-101`, `docs/commands.md:148-178`).
- `screenslop see` currently captures Baguette screenshot + accessibility JSON + optional logs from the current simulator screen; it does not build, install, or launch an app (`bin/screenslop.mjs:157-175`, `src/evidence/collect-see.mjs:26-58`, `src/evidence/collect-see.mjs:68-160`).
- Baguette can list, boot, screenshot, describe UI, stream, tap, type, and read logs, but the local CLI help does not show a build/install/launch command; use XcodeBuildMCP or Xcode tooling for build/run, then Baguette for evidence capture.
- XcodeBuildMCP is installed and should be preferred over raw `xcodebuild`/`simctl` for iOS build/run work when available (`xcodebuildmcp --help`, `xcodebuildmcp-cli` skill guidance).
- The repo currently has no sample Xcode app under `apps/` or `examples/`; only Swift source fixtures exist under `tests/fixtures/source/`.
- Current local runtime status from `node bin/screenslop.mjs doctor`: Baguette `0.1.74`, XcodeBuildMCP `2.5.1`, Xcode `26.5`, Swift `6.3.2`, Node `v25.9.0`.
- `matrix` is placeholder-only and must stay that way until deliberately implemented (`bin/screenslop.mjs:39-42`, `docs/commands.md:180-209`).

## Non-Goals

- Do not implement `screenslop matrix`.
- Do not create Screenslop Studio or move engine logic into `screenslop-studio`.
- Do not use an external/private app as the required smoke target.
- Do not treat fixture e2e success as runtime proof.
- Do not install global dependencies or modify simulator/device configuration without explicit confirmation.
- Do not broaden the critique engine beyond what the real smoke requires.

## RALPLAN-DR Summary

### Principles

1. Runtime proof beats source assumptions.
2. The public CLI/core stays the source of truth.
3. Baguette owns capture; XcodeBuildMCP owns build/run when available.
4. A verified claim needs a fresh runtime bundle and fresh critique.
5. Keep the smoke small enough to run often.

### Decision Drivers

1. Self-contained repeatability: the repo needs a sample app because no real app exists here today.
2. Honest proof semantics: the smoke must fail if capture, critique, fix, rebuild, recapture, or verify fails.
3. Low public API risk: avoid adding a new public command until the real runtime path is proven.

### Viable Options

#### Option A — Use the currently booted simulator screen

Pros:

- Fastest to try.
- No sample app needed.

Cons:

- Does not prove Screenslop can build/run a target app.
- The screen may be Springboard or another app, so source mapping and fix are not meaningful.
- Cannot make deterministic assertions across machines.

Verdict: reject for the required smoke. Useful only as a manual sanity check.

#### Option B — Use a private/user app as the target

Pros:

- Closer to real user value.
- Could expose real issues sooner.

Cons:

- Not self-contained for CI or contributors.
- Requires user choice and app-specific setup.
- Risks mixing public engine work with private app state.

Verdict: defer. Add as a later optional operator path.

#### Option C — Add a tiny sample SwiftUI app under `examples/`

Pros:

- Self-contained and public.
- Can intentionally include one safe, fixable runtime issue.
- Lets the smoke prove build/run + Baguette capture + source patch + recapture + verify.

Cons:

- Adds a small Xcode project or SwiftPM app fixture to the repo.
- Requires careful docs so users do not confuse sample-app proof with their own app proof.

Verdict: choose this option.

## Decision

Add a minimal sample SwiftUI app under `examples/runtime-smoke-app/` and a script-level smoke under `scripts/` that runs the real runtime loop against that app.

The sample app should contain one deterministic, safe issue:

```swift
Button(action: save) {
    Image(systemName: "tray.and.arrow.down")
}
.accessibilityIdentifier("runtimeSmoke.saveButton")
```

The issue should be fixable with:

```bash
screenslop fix <baseline-bundle> --finding <id> --source-root examples/runtime-smoke-app --apply --yes --label "Save changes" --json
```

After the fix, the app must rebuild/relaunch, `screenslop see` must recapture the real simulator screen, and `screenslop verify` must compare baseline findings with fresh critique output.

## Acceptance Criteria

1. The repo contains a self-contained sample iOS SwiftUI app under `examples/runtime-smoke-app/`.
2. The sample app builds and launches on a simulator through XcodeBuildMCP when available.
3. The smoke captures baseline runtime evidence with `screenslop see` using Baguette, not fixtures.
4. Baseline evidence contains real `screenshot.jpg`, `accessibility.json`, `evidence.json`, and `summary.md` artifacts.
5. Baseline `critique` produces at least one selected auto-fixable finding tied to a stable runtime identifier.
6. `screenslop fix --apply --yes --label ...` patches only the sample app source.
7. The sample app rebuilds and relaunches after the patch.
8. Fresh runtime evidence is captured with a second `screenslop see` run.
9. Fresh `critique` runs against the fresh runtime bundle.
10. `screenslop verify <baseline> --fresh-bundle <fresh> --finding <id> --fix-session <baseline>/fix-session.json --json` returns `verified-fixed` for the selected finding.
11. The smoke writes a machine-readable report with the build/run, baseline bundle, fresh bundle, finding ID, fix-session, and verification artifact paths.
12. If Baguette, XcodeBuildMCP, a simulator, or the sample app build is unavailable, the smoke exits nonzero with a clear stage-specific error.
13. The existing fixture smoke still passes: `npm run --silent smoke:e2e -- --fresh-mode fixed`.
14. `screenslop matrix` remains placeholder-only and writes no artifacts.
15. `node bin/screenslop.mjs doctor`, `npm test`, and `npm run cleanup:macos:dry` pass before completion.
16. Finished implementation is committed and pushed; local `HEAD` must match `origin/main`.

## Implementation Steps

### 1. Add the sample SwiftUI app

Preferred path:

```text
examples/runtime-smoke-app/
```

Work:

- Create the smallest viable iOS SwiftUI app.
- Keep bundle ID stable, for example `dev.screenslop.RuntimeSmoke`.
- Add a single screen with:
  - a title that proves the right app is visible
  - a save button with `accessibilityIdentifier("runtimeSmoke.saveButton")`
  - no explicit accessibility label in the baseline source
- Include enough project metadata for XcodeBuildMCP to build/run it. Prefer a generated Xcode project if that is the most reliable path for XcodeBuildMCP; use SwiftPM only if simulator app build/run is proven through XcodeBuildMCP.

Acceptance:

- The sample app path is public repo content.
- The baseline source has one deliberate, documented fixable issue.
- Source file names and identifiers are stable enough for `screenslop fix` to locate.

### 2. Add a real-runtime smoke script

Preferred path:

```text
scripts/smoke-real-runtime.mjs
```

Work:

- Orchestrate stages with explicit JSON output:
  1. preflight runtime checks
  2. build/run sample app through XcodeBuildMCP
  3. baseline `screenslop see --surface RuntimeSmoke --json --logs --bundle-id dev.screenslop.RuntimeSmoke`
  4. baseline `screenslop critique <baseline> --json`
  5. select the `runtimeSmoke.saveButton` finding
  6. `screenslop fix <baseline> --finding <id> --source-root examples/runtime-smoke-app --apply --yes --label "Save changes" --json`
  7. rebuild/relaunch the sample app
  8. fresh `screenslop see --surface RuntimeSmoke --json --logs --bundle-id dev.screenslop.RuntimeSmoke`
  9. fresh `screenslop critique <fresh> --json`
  10. `screenslop verify <baseline> --fresh-bundle <fresh> --finding <id> --fix-session <baseline>/fix-session.json --json`
- Print one JSON report to stdout in success and failure cases.
- Track stage timing, exit code, command, stdout/stderr snippets, and artifact paths.
- Do not hide command failures. A failed build, failed capture, or missing finding should fail the smoke.
- Support optional flags:
  - `--device <name>`
  - `--udid <id>`
  - `--skip-apply` for diagnosis only, not the main acceptance path
  - `--keep-derived-data` if a later implementation adds derived-data cleanup

Acceptance:

- `node scripts/smoke-real-runtime.mjs` is the single real-runtime entrypoint.
- It prints parseable JSON only.
- It does not call fixture helpers.
- It can be added to `package.json` as `smoke:runtime` once stable.

### 3. Add tests around orchestration without needing a live simulator

Preferred file:

```text
tests/real-runtime-smoke.test.mjs
```

Work:

- Unit-test the smoke script planner/runner with fake command results.
- Test stage ordering.
- Test parseable failure JSON when preflight/build/capture fails.
- Test finding selection prefers the runtime identifier and auto-fixable rule.
- Test the script refuses to call `verify` if fresh `see` or fresh `critique` failed.
- Test matrix placeholder behavior remains unchanged if any command routing changes.

Acceptance:

- `npm test` does not require a live simulator.
- Live simulator work is gated behind the smoke script, not the test suite.

### 4. Run a live manual smoke and inspect artifacts

Work:

- Use XcodeBuildMCP help-first discovery before build/run:

```bash
xcodebuildmcp --help
xcodebuildmcp tools
xcodebuildmcp project-discovery --help
xcodebuildmcp simulator --help
```

- Before the first build/run in an MCP-backed implementation, check session defaults if using MCP tools.
- Prefer a combined build-and-run command rather than a manual build + install + launch chain.
- After launch, confirm the sample app is visible before capture. Use Baguette screenshot/AX via `screenslop see` as the evidence source.
- Run:

```bash
node scripts/smoke-real-runtime.mjs
```

Acceptance:

- The smoke exits 0 and returns `verified-fixed` for the selected finding.
- The baseline and fresh bundles are different runtime captures.
- `verification.json` points to the fresh findings path.
- The report includes enough command evidence to debug failures.

### 5. Update docs

Files:

- `docs/commands.md`
- `docs/agent-integrations.md`
- `docs/session-handoff.md`
- optionally `docs/roadmap.md`

Work:

- Add a short section for the real-runtime smoke:

```bash
npm run smoke:runtime
```

- State the difference between:
  - fixture contract smoke: `npm run --silent smoke:e2e -- --fresh-mode fixed`
  - real runtime smoke: builds/runs sample app and captures actual simulator evidence
- Keep `matrix` documented as placeholder-only.
- Keep Screenslop Studio out of scope.

Acceptance:

- Docs do not imply the sample app proves user apps are fixed.
- Docs say user-app verification still needs real `see` against the user app surface.

### 6. Run final gates, commit, and push

Required gates:

```bash
node --check bin/screenslop.mjs
for f in src/**/*.mjs tests/**/*.mjs scripts/**/*.mjs; do node --check "$f"; done
npm run --silent smoke:e2e -- --fresh-mode fixed
node scripts/smoke-real-runtime.mjs
node bin/screenslop.mjs doctor
npm test
npm run cleanup:macos:dry
```

Matrix placeholder gate:

```bash
before="$(find artifacts -type f 2>/dev/null | sort || true)"
node bin/screenslop.mjs matrix > /tmp/screenslop-matrix-runtime-smoke.out
after="$(find artifacts -type f 2>/dev/null | sort || true)"
grep -q 'screenslop matrix is planned but not wired yet' /tmp/screenslop-matrix-runtime-smoke.out
test "$before" = "$after"
```

Commit/push:

```bash
git add <changed-files>
git commit -m "test: add screenslop real-runtime MVP smoke"
git push origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short
```

## Risks and Mitigations

- Risk: sample app generation becomes too large for the engine repo.
  - Mitigation: keep it under `examples/runtime-smoke-app/` and only include the minimum project files needed for a simulator app.

- Risk: real simulator state makes CI flaky.
  - Mitigation: keep `npm test` simulator-free; make `smoke:runtime` an explicit live gate.

- Risk: Baguette AX output shape differs from fixture AX shape.
  - Mitigation: inspect the first real `accessibility.json`; if needed, adapt `flattenAxTree` or detectors with tests based on captured shape. Do not patch findings by hand.

- Risk: `screenslop fix` patches the wrong source.
  - Mitigation: limit `--source-root` to `examples/runtime-smoke-app`; assert the applied patch path is inside that root.

- Risk: build/run is implemented with raw `xcodebuild` even though XcodeBuildMCP is available.
  - Mitigation: use XcodeBuildMCP help-first discovery and combined build/run commands where possible. Fall back to raw Xcode tooling only with an explicit report reason.

- Risk: the smoke claims runtime proof after a failed fresh capture.
  - Mitigation: refuse to run `verify` unless fresh `see` exits 0 and fresh `critique` writes findings from the fresh bundle.

- Risk: sidecar files appear on the external drive.
  - Mitigation: run `npm run cleanup:macos:dry`; use the cleanup script only after the dry-run reports sidecars.

## Verification Plan

Unit/static:

```bash
node --check bin/screenslop.mjs
for f in src/**/*.mjs tests/**/*.mjs scripts/**/*.mjs; do node --check "$f"; done
npm test
```

Fixture contract:

```bash
npm run --silent smoke:e2e -- --fresh-mode fixed
```

Real runtime:

```bash
node scripts/smoke-real-runtime.mjs
```

Required repo gates:

```bash
node bin/screenslop.mjs doctor
npm run cleanup:macos:dry
```

Commit/push proof:

```bash
git push origin main
test "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)"
git status --short
```

## Available-Agent-Types Roster

Use the installed OMX role names from the current prompt catalog:

- `planner` — refine scope if runtime build/run facts differ from this plan.
- `architect` — review sample-app boundary, smoke-script architecture, and public API risk.
- `critic` — challenge proof semantics and stop any fixture/runtime conflation.
- `worker` — add sample app, smoke script, npm script, docs.
- `tester` — add unit tests and regression gates for smoke orchestration.
- `debugger` — diagnose XcodeBuildMCP/Baguette runtime failures.
- `verifier` — run full static, fixture, runtime, doctor, cleanup, matrix, commit/push gates.
- `docs` — update operator and agent docs after implementation stabilizes.
- `security` — optional; only needed if the smoke starts accepting arbitrary shell commands or untrusted paths.

## Follow-up Staffing Guidance

Recommended execution path: **Ralph** if you want a single persistent owner for the live runtime smoke, because simulator/build failures often need serial retry and fresh evidence. Use Team + Ultragoal only if splitting sample-app creation, smoke runner, tests, and docs into parallel lanes is preferred.

Suggested Ralph lane:

```bash
$oh-my-codex:ralph Execute .omx/plans/screenslop-real-runtime-mvp-smoke-2026-06-08.md
```

Suggested Team launch:

```bash
$oh-my-codex:team Execute .omx/plans/screenslop-real-runtime-mvp-smoke-2026-06-08.md
```

Team verification path:

1. Worker returns sample app and smoke-script files.
2. Tester returns simulator-free orchestration tests.
3. Debugger handles real build/run/capture issues.
4. Verifier runs `smoke:e2e`, `smoke-real-runtime`, `doctor`, `npm test`, cleanup dry-run, matrix placeholder assertion, commit/push SHA match.
5. Ultragoal, if used, checkpoints the pushed commit hash and runtime artifact evidence.

## Goal-Mode Follow-up Suggestions

- Use `$ralph` next for the live runtime smoke because it is likely to need one persistent owner and repeated fresh evidence.
- Use `$team` if you want parallel implementation lanes.
- Use `$ultragoal` if you want durable ledger tracking across several runtime-smoke iterations.
- Do not use `$autoresearch-goal`; this is implementation and validation, not research.
- Do not use `$performance-goal`; no measurable performance target is part of this slice.

## ADR

Decision: add a self-contained sample SwiftUI app and a real-runtime smoke script that builds/runs it, captures with Baguette-backed `screenslop see`, applies one safe fix, recaptures, critiques, and verifies.

Drivers:

- Need actual simulator evidence beyond fixture contract proof.
- Need repeatability without relying on private user apps.
- Need to preserve the public engine boundary and avoid widening the CLI too early.

Alternatives considered:

- Current booted simulator screen: rejected because it cannot prove source mapping or fix/verify.
- Private/user app target: deferred because it is not repeatable in the public repo.
- Public sample app: chosen because it is deterministic and keeps runtime proof self-contained.

Why chosen:

A tiny sample app gives the repo a stable real-runtime target. It proves the engine can see a live screen, derive a finding, patch source, rebuild, recapture, and verify against fresh evidence without depending on a user’s private app.

Consequences:

- Adds an example iOS app to the public repo.
- Live smoke depends on installed Apple tooling and at least one usable simulator.
- `npm test` remains simulator-free; the live smoke is an explicit gate.

Follow-ups:

- Add an optional user-app runtime smoke once project discovery/config exists.
- Promote runtime smoke findings into docs/session handoff after execution.
- Consider a public orchestration command only after the script proves stable.

## Plan Changelog

- Created direct plan from current docs, runtime code, installed tool checks, and repo structure.
- Chose self-contained sample app over current simulator screen or private app target.
- Kept `matrix` out of scope and retained hard placeholder verification.
