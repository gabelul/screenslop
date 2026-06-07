# Plan: wire `screenslop see` to Baguette evidence capture

## Requirements summary

- Wire `screenslop see` so it creates a real evidence bundle from runtime data, not just a scaffold.
- Use the repo's runtime priority: Baguette first, then XcodeBuildMCP, then `xcodebuild`/`simctl`, then manual evidence. The first slice should complete Baguette capture and leave fallbacks honest rather than fake.
- Capture the Phase 1 artifacts: screenshot, accessibility tree, optional logs, evidence manifest, and summary.
- Support agent-safe JSON output for `screenslop see --json --surface <name>` early, because agent integrations rely on strict CLI contracts.
- Do not install dependencies, delete sidecar files, or clean the external-drive metadata without explicit confirmation.

## Evidence-backed facts

- `AGENTS.md` says the required runtime priority is `Baguette -> XcodeBuildMCP -> xcodebuild/simctl -> manual evidence` and completion claims require `node bin/screenslop.mjs doctor` plus `npm test` (`AGENTS.md:15-28`).
- The session handoff names this exact next step: call `baguette list --json`, choose or boot a simulator, capture screenshot, capture AX tree, optionally collect logs, write complete `evidence.json`, and support `--json` (`docs/session-handoff.md:86-96`).
- The architecture contract lists the runtime-driver capabilities: `listDevices`, `boot`, `screenshot`, `accessibilityTree`, and `logs` (`docs/architecture.md:13-24`).
- Evidence bundles are supposed to contain screenshot, accessibility JSON, logs, and source hints, and reports are derived from evidence (`docs/architecture.md:35-53`).
- `screenslop see` is defined as the command that captures screenshot, accessibility tree, logs, evidence manifest, and summary (`docs/commands.md:53-63`).
- Agent integrations need `screenslop see --json --surface <name>` as a stable command contract (`docs/agent-integrations.md:72-83`).
- Phase 1 success is a real app screen producing a reviewable evidence bundle (`docs/roadmap.md:10-19`).
- Runtime dependencies must be detected and explained, not bundled or installed without confirmation (`docs/repo-strategy.md:47-68`).
- The repo contains macOS sidecar files; docs say preview cleanup first and never delete silently (`docs/maintenance.md:21-41`, `docs/session-handoff.md:112-128`).

## Current code state after the interrupted implementation attempt

The previous turn made partial source edits before planning was requested. Do not treat these as finished.

- `bin/screenslop.mjs` still routes `see` to a synchronous scaffold-only function (`bin/screenslop.mjs:24-25`, `bin/screenslop.mjs:131-152`). This is the main missing wiring.
- `src/runtime/shell.mjs` now contains `runFor(...)`, a bounded async shell helper for streaming commands such as logs (`src/runtime/shell.mjs:1-80`). Review timeout behavior before relying on it.
- `src/runtime/baguette.mjs` now has constructor/device-set support, `boot(...)`, screenshot and AX commands with device-set suffixes, and bounded `logs(...)` capture (`src/runtime/baguette.mjs:1-106`). This needs tests and CLI integration.
- `src/runtime/device-selection.mjs` exists and selects a booted simulator by default, or an explicit UDID/device by option (`src/runtime/device-selection.mjs:1-69`). This needs tests.
- `src/evidence/bundle.mjs` now has manifest persistence and richer summary rendering, including device and capture-step status (`src/evidence/bundle.mjs:13-75`). This needs schema alignment and tests.
- `schemas/evidence.schema.json` already allows runtime device name, UDID, bundle ID, scheme, screenshot, accessibility tree, logs, and summary paths (`schemas/evidence.schema.json:11-39`). It does not yet describe `capture.steps`; either add schema coverage or keep capture details outside the schema.
- `package.json` currently runs only `tests/*.test.mjs`, so any added tests must live there unless the script changes (`package.json:9-14`).

## Decision

Implement the Baguette-first `see` slice now, keep XcodeBuildMCP/simctl/manual as explicit fallback statuses for later, and add tests around device selection, bundle writing, CLI JSON shape, and shell timeout behavior.

## Alternatives considered

### Option A: complete Baguette-only `see` first

- Pros: matches the documented Phase 1 next step, keeps scope small, and proves the evidence loop with the strongest runtime.
- Cons: fallback capture remains incomplete for machines without Baguette.
- Verdict: choose this for the current slice.

### Option B: build full Baguette + XcodeBuildMCP + simctl fallback stack now

- Pros: broader machine support in one release.
- Cons: touches more systems before the evidence manifest and CLI contract are stable. Higher chance of drift.
- Verdict: defer until Baguette path and manifest are proven.

### Option C: keep scaffold output and move straight to `critique`

- Pros: quick demo path.
- Cons: violates the core rule: no UI critique from source alone when runtime evidence can be captured.
- Verdict: reject.

## Implementation steps

1. Stabilize the partial helper changes.
   - Review `runFor(...)` in `shell.mjs` for process cleanup and return shape.
   - Keep it if log capture needs bounded streaming; otherwise replace it with a smaller helper local to `BaguetteDriver.logs(...)`.
   - Add `tests/shell.test.mjs` for timeout success and normal command completion.

2. Finish `BaguetteDriver` as the first concrete runtime driver.
   - Keep `listDevices()`, `boot(udid)`, `screenshot(udid, outputPath)`, `accessibilityTree(udid, outputPath)`, and optional `logs(udid, outputPath, options)`.
   - Preserve `--device-set` support because Baguette list/screenshot/describe-ui/logs all accept it.
   - Add command construction tests without requiring a live simulator. If command injection is hard to test with the current shell helper, refactor to injectable command runners first.

3. Finish and test simulator selection.
   - Use `running[]` first when no device is requested.
   - Support exact `--udid`, exact `--device`, and partial `--device` matching.
   - If no running simulator exists, only boot when the user passes `--boot` or approves an interactive prompt.
   - Add `tests/device-selection.test.mjs`.

4. Wire `bin/screenslop.mjs see`.
   - Parse options: `--json`, `--dry-run`, `--surface/-s`, `--udid`, `--device`, `--device-set`, `--boot`, `--logs`, `--bundle-id`, and `--log-duration`.
   - Make the `see` route async.
   - On Baguette available: list devices, select device, boot if approved, capture screenshot and AX tree, collect logs only when requested, update `evidence.json`, update `summary.md`, then print human or JSON output.
   - On Baguette missing: return a clear non-zero fallback status saying Baguette capture is unavailable and fallback capture is not wired yet. Do not pretend simctl or XcodeBuildMCP captured evidence until those drivers exist.

5. Align evidence output with schema.
   - Either add a `capture` property to `schemas/evidence.schema.json` or omit capture-step details from `evidence.json` and keep them in `summary.md`/CLI JSON.
   - Preferred: add `capture.status` and `capture.steps[]` to the schema because agents benefit from machine-readable capture status.
   - Keep artifact paths relative to repo root.

6. Add CLI tests without needing a live simulator.
   - Extract the core `see` flow into a testable function under `src/evidence/collect-see.mjs` or similar.
   - Inject a fake runtime driver for tests.
   - Test `--json` output shape, dry-run output, missing-device status, and complete capture status.
   - Avoid tests that depend on this machine's currently booted simulator.

7. Run the required verification.
   - `node bin/screenslop.mjs doctor`
   - `npm test`
   - One live manual smoke only if Baguette is present and a simulator is booted: `node bin/screenslop.mjs see --json --surface "Current Screen"`
   - Confirm the generated bundle has `screenshot.jpg`, `accessibility.json`, `evidence.json`, and `summary.md`.
   - If sidecar files appear, run only `npm run cleanup:macos:dry` and ask before cleanup.

## Acceptance criteria

- `node bin/screenslop.mjs see --dry-run --json --surface Settings` prints valid JSON and writes a dry-run evidence bundle.
- With Baguette available and at least one booted simulator, `node bin/screenslop.mjs see --json --surface Settings` exits 0 and writes:
  - `artifacts/<run-id>/screenshot.jpg`
  - `artifacts/<run-id>/accessibility.json`
  - `artifacts/<run-id>/evidence.json`
  - `artifacts/<run-id>/summary.md`
- `evidence.json` includes relative artifact paths, runtime driver `baguette`, selected device name, selected UDID, capture status, and per-step statuses.
- `--logs` writes `logs.ndjson`; without `--logs`, the logs artifact remains `null`.
- If no simulator is booted and `--boot` is not passed in a non-interactive run, the command exits non-zero with a clear machine-readable reason.
- If `--udid` or `--device` does not match, the command exits non-zero with a clear machine-readable reason.
- Tests do not require a live simulator.
- `node bin/screenslop.mjs doctor` and `npm test` pass before any completion claim.

## Risks and mitigations

- Risk: `baguette logs` streams indefinitely. Mitigation: keep bounded log capture with a timeout and test timeout behavior.
- Risk: evidence schema drifts from manifest output. Mitigation: update schema in the same slice and add tests for manifest shape.
- Risk: live simulator state makes tests flaky. Mitigation: unit-test selection and collector logic with fake drivers; reserve live Baguette for manual smoke.
- Risk: CLI prints friendly text in `--json` mode. Mitigation: ensure JSON mode prints only JSON to stdout; send human diagnostics to stderr only if needed.
- Risk: partial source edits from the interrupted turn hide defects. Mitigation: treat them as draft changes; review every touched helper before wiring.
- Risk: sidecar cleanup becomes destructive. Mitigation: only run dry cleanup preview unless explicitly approved.

## Verification steps

1. `npm test`
2. `node bin/screenslop.mjs doctor`
3. `node bin/screenslop.mjs see --dry-run --json --surface Settings | node -e 'let s=""; process.stdin.on("data", c => s += c); process.stdin.on("end", () => JSON.parse(s));'`
4. If a simulator is booted: `node bin/screenslop.mjs see --json --surface "Current Screen"`
5. Inspect the produced `evidence.json` and `summary.md` for relative paths and capture status.
6. If sidecars are newly visible: `npm run cleanup:macos:dry` only.

## Follow-up after this slice

- Implement XcodeBuildMCP fallback only after Baguette `see` is stable.
- Implement the first `critique` pass against evidence, not source-only views.
- Consider moving from flat files to the package layout only after `see` and `critique` both work, matching the repo strategy.
