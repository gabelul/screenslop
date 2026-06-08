# Roadmap

## Phase 0: working scaffold

- CLI command routing.
- Doctor checks for Baguette, Xcode, simctl, Node.
- Evidence schema.
- Skill stub for agent use.

## Phase 1: `see`

- Pick runtime driver.
- List devices.
- Capture screenshot.
- Capture accessibility tree when available.
- Capture logs when available.
- Write `summary.md`.

Success means a real app screen produces a reviewable evidence bundle.

## Phase 2: `critique`

- Read evidence bundle.
- Run Apple UI rubric.
- Detect empty AX labels, missing identifiers, clipping hints, low contrast candidates, unsafe touch targets.
- Produce priority-grouped findings.

Success means every finding includes evidence and a plausible source hint.

## Phase 3: `fix`

- Patch the top accessibility and SwiftUI layout findings.
- Rebuild and recapture.
- Mark findings fixed, partial, or failed.

Success means the loop catches at least one real issue and proves the fix. The first live proof is `npm run smoke:runtime`, which targets only the public `examples/runtime-smoke-app` sample and keeps user-app verification separate.

## Phase 4: `matrix`

- Write a six-cell report for the same configured surface.
- Preserve no-config, dry-run, unavailable, captured, and failed cell evidence.
- Start with default iPhone, large iPhone, dark/light, Dynamic Type normal/AX.
- Add iPad split width and Reduce Motion/Transparency later.

## Phase 5: Mac app

- Evidence browser.
- Live stream panel.
- Finding triage.
- Before/after diffs.

The Mac app comes after the CLI can see and critique reliably.
