# Screenslop Fix MVP Plan

Date: 2026-06-07
Mode: `$oh-my-codex:plan`
Scope: planning only. No implementation in this pass.

## Requirements Summary

Interpretation: “screen slope is fix” means the next Screenslop phase is `screenslop fix`.

The goal is to plan the first safe fix loop after the committed `see` and `critique` MVPs:

1. Read a critique bundle and its `findings.json`.
2. Pick one or more high-value findings.
3. Locate likely SwiftUI source.
4. Apply only low-risk deterministic fixes when the source mapping is strong.
5. Run verification commands.
6. Recapture fresh evidence when requested.
7. Mark selected findings as fixed, partial, failed, unsupported, or unverified.

Current baseline:

- `see` is wired and captures screenshot, AX tree, logs, manifest, and summary (`docs/commands.md:53-63`).
- `critique` is wired, evidence-first, and every finding needs screenshot/AX/log/source/missing-evidence support (`docs/commands.md:65-75`).
- `fix` is still documented as planned: it patches selected findings and should not fix everything by default (`docs/commands.md:77-81`).
- Architecture says the fix loop should be deliberately small: pick top findings, locate source, patch SwiftUI, build/run, capture fresh evidence, then mark fixed/partial/failed (`docs/architecture.md:90-101`).
- Roadmap Phase 3 says success means the loop catches at least one real issue and proves the fix (`docs/roadmap.md:30-36`).
- Source mapper guidance already points to stable accessibility identifiers, visible labels, file grep, SwiftSyntax, and project naming conventions (`docs/architecture.md:72-88`).
- The committed critique engine returns strict JSON with `bundle`, `evidence`, `artifacts`, `summary`, and `findings` (`src/critique/collect-critique.mjs:18-44`).
- Findings now carry `ruleId`, `severity`, `pillar`, `detail`, `suggestedFix`, `verification`, `confidence`, `effort`, and evidence (`schemas/finding.schema.json:6-103`).
- Finding IDs are deterministic from rule + fingerprint (`src/critique/findings.mjs:23-42`).

## Product Boundary

### What the MVP should do

- Support `screenslop fix <bundle>` as a CLI command.
- Default to an interactive, safe flow when run in a terminal.
- Support non-interactive flags for agents and tests.
- Generate a fix plan even when no safe auto-patch exists.
- Apply only narrow SwiftUI patches where the finding has strong source evidence.
- Never claim a finding is verified without fresh evidence or an explicit verification command result.

### What the MVP should not do

- No LLM-driven code rewriting.
- No broad SwiftUI refactors.
- No source-only “fixed” claims.
- No auto-fixing all findings by default.
- No patching ambiguous source candidates.
- No recapture unless the user asks for it or passes the required capture options.

## Command Contract

### Interactive default

```bash
node bin/screenslop.mjs fix artifacts/<bundle>
```

Expected interactive flow:

1. Load `findings.json` from the bundle.
2. Show grouped findings by severity.
3. Recommend top fixable findings.
4. Ask which finding(s) to prepare.
5. Show source candidates and patch preview.
6. Ask before applying file edits.
7. Run verification only after explicit command/config exists.

### Agent / CI flags

```bash
node bin/screenslop.mjs fix artifacts/<bundle> --finding <id> --source-root <path> --dry-run --json
node bin/screenslop.mjs fix artifacts/<bundle> --finding <id> --source-root <path> --apply --yes --json
node bin/screenslop.mjs fix artifacts/<bundle> --finding <id> --source-root <path> --apply --verify-command "npm test" --json
```

Optional later flag, if implementation time allows:

```bash
node bin/screenslop.mjs fix artifacts/<bundle> --finding <id> --recapture --surface "Settings" --logs --log-duration 500 --json
```

## Fixability Rules

### Auto-fixable in MVP

1. `ax.missing-name`
   - Only when source locator finds a unique SwiftUI modifier chain by `accessibilityIdentifier` or a unique source hint.
   - Patch by adding `.accessibilityLabel("...")` near the matched control.
   - Suggested label comes from finding context only when safe; otherwise require `--label "..."` or interactive input.

2. `ax.generic-name`
   - Same source requirements as `ax.missing-name`.
   - Patch by replacing or adding a more specific `.accessibilityLabel("...")`.
   - Non-interactive mode requires `--label` unless the finding title/detail gives an unambiguous replacement.

3. `layout.touch-target`
   - Only when source locator finds a unique SwiftUI view chain by identifier/source hint.
   - Patch by adding `.frame(minWidth: 44, minHeight: 44)` when no equivalent frame already exists nearby.
   - If a frame exists, do not edit it in MVP; mark `unsupported` with a specific note.

### Not auto-fixable in MVP

- `layout.offscreen-frame`
- `logs.*`
- evidence-quality findings
- contrast/color/typography/motion future findings
- findings without unique source candidates

These should still produce a fix plan with source candidates, suggested action, and verification instructions.

## Source Mapping MVP

Source mapping should be conservative.

Priority order:

1. `finding.evidence.sourceHint` when it points to an existing Swift file.
2. `finding.evidence.node.identifier` matched against `.accessibilityIdentifier("...")` or `.reviewID("...")`.
3. Exact visible label grep only as a candidate, not an auto-patch authority.
4. File-name hints from surface/finding titles only as candidates.

Rules:

- One strong candidate is required for auto-patch.
- Multiple strong candidates means `ambiguous`; show them and stop.
- No candidates means `unsupported`; emit a source-mapping recommendation.
- Never patch files outside `--source-root`.
- Exclude `artifacts/`, `.omx/`, `.git/`, `DerivedData/`, `build/`, and `node_modules/`.

## Output Artifacts

Each fix run should write into the original critique bundle:

```text
fix-plan.json
fix.md
```

If a patch is applied, also write:

```text
fix-session.json
```

Proposed `fix-plan.json` shape:

```json
{
  "bundle": "artifacts/<run>",
  "createdAt": "2026-06-07T00:00:00.000Z",
  "sourceRoot": "/path/to/app",
  "selectedFindings": ["ax-missing-name-abc123"],
  "items": [
    {
      "findingId": "ax-missing-name-abc123",
      "ruleId": "ax.missing-name",
      "status": "planned",
      "fixability": "auto-fixable|manual|unsupported|ambiguous",
      "sourceCandidates": [
        { "file": "SettingsView.swift", "line": 42, "confidence": "high", "reason": "matched accessibilityIdentifier" }
      ],
      "patchPreview": "...",
      "verification": "Recapture and confirm the AX node has a meaningful label."
    }
  ]
}
```

Proposed statuses:

- `planned`
- `applied`
- `skipped`
- `unsupported`
- `ambiguous`
- `verify-passed`
- `verify-failed`
- `recapture-passed`
- `recapture-failed`
- `unverified`

## Implementation Steps

### 1. Add fix modules

New files:

```text
src/fix/load-fix-input.mjs
src/fix/select-findings.mjs
src/fix/source-locator.mjs
src/fix/swiftui-patcher.mjs
src/fix/fix-plan.mjs
src/fix/fix-report.mjs
src/fix/verify-fix.mjs
src/fix/collect-fix.mjs
```

Responsibilities:

- `load-fix-input.mjs`: load bundle + `findings.json`; reuse critique path semantics where possible.
- `select-findings.mjs`: handle `--finding`, top severity defaults, and interactive selection.
- `source-locator.mjs`: search Swift files and return ranked candidates.
- `swiftui-patcher.mjs`: generate patch previews and apply only known safe modifier insertions.
- `fix-plan.mjs`: build machine-readable plan/session artifacts.
- `fix-report.mjs`: render `fix.md`.
- `verify-fix.mjs`: run bounded verification commands and parse pass/fail.
- `collect-fix.mjs`: orchestration entry point for CLI and tests.

### 2. Wire CLI

Update `bin/screenslop.mjs`:

- Route `fix` to `await fix()` instead of placeholder (`bin/screenslop.mjs:31-35`).
- Add options:
  - `--finding <id>` repeatable if possible, or comma-separated for MVP.
  - `--source-root <path>` default `process.cwd()`.
  - `--dry-run`.
  - `--apply`.
  - `--yes` for non-interactive apply confirmation.
  - `--label <text>` for accessibility-label patches.
  - `--verify-command <command>`.
  - `--json`.

CLI behavior:

- `--dry-run` writes plan/report but edits nothing.
- `--apply` without `--yes` should prompt in TTY.
- Non-TTY `--apply` without `--yes` should fail safely.
- Findings are normal work, not process failure; unreadable inputs and failed patch writes are process failures.

### 3. Add source fixtures

New test fixtures:

```text
tests/fixtures/source/simple-swiftui/SettingsView.swift
tests/fixtures/source/ambiguous-swiftui/SettingsView.swift
tests/fixtures/source/ambiguous-swiftui/SettingsFooter.swift
```

Fixture cases:

- Unique `.accessibilityIdentifier("settings.saveButton")` with missing label.
- Unique identifier with generic label.
- Unique identifier needing min 44pt frame.
- Ambiguous identifier across two files.
- No identifier match.
- Existing `.frame(minWidth: 44, minHeight: 44)` should not double-add frame.

### 4. Add fix tests

New test file:

```text
tests/fix.test.mjs
```

Test cases:

- Dry-run creates `fix-plan.json` and `fix.md` without editing source.
- Missing `findings.json` exits nonzero with JSON error.
- Unique missing-label finding generates a patch preview.
- `--apply --yes --label "Save settings"` inserts `.accessibilityLabel("Save settings")` once.
- Unique touch-target finding inserts `.frame(minWidth: 44, minHeight: 44)` once.
- Ambiguous source candidates produce `ambiguous`, no edits.
- Unsupported findings produce manual instructions, no edits.
- `--verify-command` pass/fail updates session status.
- Generated fix artifacts are ignored when they appear inside test fixture copied bundles, like critique output artifacts.

### 5. Add docs

Update `docs/commands.md` under `screenslop fix`:

- Document safe default behavior.
- Document `--dry-run`, `--apply`, `--yes`, `--source-root`, `--finding`, `--label`, and `--verify-command`.
- State that no fresh evidence means no verified claim (`docs/commands.md:83-87`).

Add `docs/fix-contract.md` if the command docs become too crowded.

### 6. Optional recapture support

Only include this in MVP if it remains small:

- Reuse `collectSee()` after apply when `--recapture` is passed.
- Run `collectCritique()` against the new bundle.
- Mark selected finding `recapture-passed` only if the same `ruleId` and source identifier no longer appears.

If this grows, defer it to `screenslop verify` and keep `fix` at `applied` / `verify-passed` status only.

## Acceptance Criteria

- `node bin/screenslop.mjs fix tests/fixtures/evidence/problem --finding <id> --source-root tests/fixtures/source/simple-swiftui --dry-run --json` returns parseable JSON.
- Dry-run writes `fix-plan.json` and `fix.md` and edits no source files.
- `--apply --yes` only edits a uniquely matched Swift source candidate.
- Accessibility label patch is inserted once and tests prove rerunning does not duplicate it.
- Touch target patch is inserted once and tests prove rerunning does not duplicate it.
- Ambiguous/no-source/unsupported findings do not edit files.
- `--verify-command` records pass/fail without hiding command output.
- Human output groups selected findings by status.
- `npm test` passes.
- `node bin/screenslop.mjs doctor` passes.
- `node --check bin/screenslop.mjs src/fix/*.mjs tests/fix.test.mjs` passes.
- Sidecar cleanup is previewed and run through the repo cleanup script if sidecars appear.

## Verification Plan

Implementation verification should run:

```bash
npm test
node bin/screenslop.mjs doctor
node --check bin/screenslop.mjs
for f in src/fix/*.mjs tests/fix.test.mjs; do node --check "$f"; done
```

CLI smoke tests:

```bash
node bin/screenslop.mjs fix tests/fixtures/evidence/problem --finding <id> --source-root tests/fixtures/source/simple-swiftui --dry-run --json
node bin/screenslop.mjs fix tests/fixtures/evidence/problem --finding <id> --source-root /tmp/simple-swiftui-copy --apply --yes --label "Save settings" --json
```

Live smoke should wait until recapture support exists. If `--recapture` ships in MVP, run:

```bash
node bin/screenslop.mjs see --json --surface "Fix MVP Smoke" --logs --log-duration 500
node bin/screenslop.mjs critique artifacts/<new-bundle> --json
node bin/screenslop.mjs fix artifacts/<new-bundle> --finding <id> --source-root <app-root> --dry-run --json
```

Do not claim a live fix was verified unless a real app source patch, rebuild/run, fresh `see`, and fresh `critique` all happened.

## Risks and Mitigations

### Risk: auto-patching SwiftUI creates wrong edits

Mitigation:

- Only patch unique high-confidence source matches.
- Default to dry-run/preview.
- Require `--yes` or TTY confirmation for edits.
- Refuse ambiguous candidates.

### Risk: labels are guessed badly

Mitigation:

- Require `--label` in non-interactive mode for missing/generic label fixes unless a safe replacement is explicit.
- In interactive mode, ask for the label.
- Keep suggested labels out of auto-apply when uncertain.

### Risk: verification gets faked

Mitigation:

- Separate `applied`, `verify-passed`, and `recapture-passed` statuses.
- No fresh evidence, no verified claim.
- Store verification command output status in `fix-session.json`.

### Risk: source mapping becomes a second critique engine

Mitigation:

- Source mapping only supports locating likely files and patch points.
- It does not create new UI findings.
- Findings remain critique-owned and evidence-backed.

## Follow-up Staffing Guidance

Recommended execution path:

- Use `$ralph` if you want the same persistent single-owner implementation/verification loop as the `see` and `critique` phases.
- Use `$team` if parallelizing:
  - `worker`: CLI wiring, fix orchestration, source locator, patcher.
  - `tester`: source fixtures, fix tests, idempotency tests, CLI smoke.
  - `docs`: command contract docs after behavior settles.
  - `reviewer`: code quality and false-positive review.
  - `verifier`: final `npm test`, doctor, syntax checks, fixture smoke.

Suggested Ralph launch:

```text
$oh-my-codex:ralph Execute .omx/plans/screenslop-fix-mvp-2026-06-07.md
```

Suggested Team launch:

```text
$oh-my-codex:team Execute .omx/plans/screenslop-fix-mvp-2026-06-07.md with worker+tester first, docs after behavior stabilizes, then reviewer+verifier.
```

## ADR

### Decision

Build `screenslop fix` as a conservative deterministic patch loop: plan first, auto-patch only unique simple SwiftUI modifier fixes, then verify separately.

### Drivers

- The architecture says the fix loop should be small and evidence-bound, not heroic (`docs/architecture.md:90-101`).
- Current findings already include rule IDs, suggested fixes, verification text, and evidence (`schemas/finding.schema.json:6-103`).
- Source mapping is useful only when stable identifiers or strong hints exist (`docs/architecture.md:72-88`).

### Alternatives considered

1. Full automatic SwiftUI refactor.
   - Rejected. Too risky and not evidence-bounded enough for MVP.

2. Fix-plan-only command.
   - Rejected as too weak for Phase 3. The MVP should prove at least one safe patch path.

3. LLM patch generation.
   - Rejected for MVP. It would be harder to make deterministic and harder to test.

4. Deterministic narrow patches with dry-run by default.
   - Chosen. It proves the loop while keeping bad edits unlikely.

### Consequences

- MVP fixes fewer findings, but the fixes it applies are safer.
- Many findings will be `unsupported` or `manual` at first.
- Stable identifiers become more valuable, which matches the existing source-mapper guidance.

### Follow-ups

- Add `screenslop verify` once fix sessions exist.
- Add recapture comparison if not included in the MVP.
- Add richer source mapping with SwiftSyntax or tree-sitter later.
- Add `learn` / design-token context before broader layout or typography fixes.
