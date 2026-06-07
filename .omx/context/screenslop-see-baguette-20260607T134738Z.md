# Ralph Context Snapshot: screenslop see Baguette wiring

## Task statement
Execute the approved plan at `.omx/plans/screenslop-see-baguette-wiring-2026-06-07.md`.

## Desired outcome
`screenslop see` captures real runtime evidence through Baguette: screenshot, accessibility tree, optional logs, evidence manifest, summary, and strict JSON output for agents.

## Known facts/evidence
- `AGENTS.md` requires runtime priority Baguette -> XcodeBuildMCP -> xcodebuild/simctl -> manual evidence.
- `docs/session-handoff.md` names Baguette-backed `screenslop see` as the next engineering step.
- `docs/commands.md` defines `see` outputs: screenshot, accessibility tree, logs, evidence manifest, summary.
- `docs/agent-integrations.md` requires `screenslop see --json --surface <name>` early.
- Partial draft edits already exist in `shell.mjs`, `baguette.mjs`, `device-selection.mjs`, and `bundle.mjs`; `bin/screenslop.mjs` still needs wiring.

## Constraints
- Do not install dependencies without explicit user confirmation.
- Do not delete macOS sidecars or cleanup files without explicit user confirmation.
- Before claiming completion, run `node bin/screenslop.mjs doctor` and `npm test`.
- Treat fallback drivers honestly; do not claim XcodeBuildMCP/simctl capture until implemented.

## Unknowns/open questions
- Whether a simulator is booted at final smoke time.
- Whether live Baguette `describe-ui` succeeds on the current simulator screen.

## Likely codebase touchpoints
- `bin/screenslop.mjs`
- `src/runtime/baguette.mjs`
- `src/runtime/device-selection.mjs`
- `src/runtime/shell.mjs`
- `src/evidence/bundle.mjs`
- `schemas/evidence.schema.json`
- `tests/*.test.mjs`
