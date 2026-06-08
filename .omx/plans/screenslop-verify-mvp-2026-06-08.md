# Screenslop Verify MVP Plan

Date: 2026-06-08
Mode: `$oh-my-codex:plan`
Scope: planning only. No implementation in this pass.

## Requirements Summary

The next Screenslop phase is `screenslop verify`: prove whether previous findings changed after fresh runtime evidence.

The repo now has the first three legs of the loop:

1. `screenslop see` captures evidence bundles (`docs/commands.md:53-63`).
2. `screenslop critique` reads evidence and writes findings (`docs/commands.md:65-75`, `src/critique/collect-critique.mjs:18-44`).
3. `screenslop fix` plans/applies selected safe source patches and writes fix artifacts (`docs/commands.md:77-111`, `src/fix/collect-fix.mjs:28-116`).

`verify` is still a placeholder in the CLI (`bin/screenslop.mjs:35-38`, `bin/screenslop.mjs:317-320`). Current docs only state the hard rule: it checks whether previous findings were actually fixed, and no fresh evidence means no verified claim (`docs/commands.md:113-117`).

Architecture already defines the intended loop: patch SwiftUI, build/run, capture fresh evidence, and mark fixed/partial/failed (`docs/architecture.md:90-101`). The MVP should implement only the comparison/proof step. It should not expand into runtime capture, app build orchestration, or broad layout intelligence yet.

## Product Boundary

### What the MVP should do

- Support `screenslop verify <baseline-bundle> --fresh-bundle <fresh-bundle>`.
- Load baseline findings from `findings.json` in the old bundle.
- Load or generate fresh findings for the fresh bundle.
- Compare selected baseline findings against fresh findings.
- Write `verification.json` and `verification.md` into the baseline bundle.
- Print human output by default and parseable JSON with `--json`.
- Separate true verification from weak/no-evidence states.
- Preserve the existing path contract: repo-local paths stay repo-relative; external copied bundles stay absolute (`docs/commands.md:71-75`, `src/critique/load-evidence.mjs:82-86`).

### What the MVP should not do

- Do not capture new runtime evidence itself.
- Do not boot simulators.
- Do not run app builds.
- Do not patch source.
- Do not call `screenslop fix` internally.
- Do not claim `verified-fixed` unless a fresh evidence bundle exists and fresh critique has been run.
- Do not infer a fix from a passing `fix --verify-command`; `fix` records command pass/fail separately from runtime recapture (`src/fix/verify-fix.mjs:10-23`, `docs/commands.md:100-111`).

## Command Contract

### Primary MVP command

```bash
node bin/screenslop.mjs verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run>
```

Behavior:

1. Load baseline bundle through the existing evidence path semantics (`src/critique/load-evidence.mjs:11-42`).
2. Read baseline `findings.json`. Critique currently writes `{ summary, findings }` (`src/critique/report.mjs:12-20`). The loader should also accept a bare array for compatibility with `fix` loader behavior (`src/fix/load-fix-input.mjs:21-23`).
3. Load the fresh bundle.
4. If fresh `findings.json` exists and `--refresh-critique` is not passed, use it.
5. If fresh `findings.json` is missing or `--refresh-critique` is passed, run `collectCritique({ root, bundlePath: freshBundle })` (`src/critique/collect-critique.mjs:18-44`).
6. Compare selected baseline findings to fresh findings.
7. Write `verification.json` and `verification.md` into the baseline bundle.
8. Return exit code `0` for normal comparison results, even when findings remain. Return nonzero only for unreadable inputs, missing required flags, malformed JSON, or write failures.

### Useful flags

```bash
node bin/screenslop.mjs verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --json
node bin/screenslop.mjs verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id> --json
node bin/screenslop.mjs verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id1>,<id2> --refresh-critique --json
node bin/screenslop.mjs verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --fix-session artifacts/<baseline-run>/fix-session.json --json
```

Flags:

- `--fresh-bundle <path>`: required for verified claims.
- `--finding <id>`: optional selected finding IDs. Reuse the comma/repeated-value parsing style already used by `fix` (`bin/screenslop.mjs:406-416`).
- `--refresh-critique`: always rerun critique on the fresh bundle before comparing.
- `--fix-session <path>`: optional context. If omitted, try `<baseline-bundle>/fix-session.json` when present.
- `--json`: parseable JSON only. No prompts.

## Verification Matching Rules

The matcher should be deterministic and conservative.

### Strong match keys

A baseline finding is still present when a fresh finding shares the same `ruleId` plus at least one strong evidence key:

1. `evidence.node.identifier`, when present in both findings.
2. `evidence.sourceHint`, when present in both findings.
3. `evidence.line` plus `evidence.snippet`, for log findings when both are present.
4. Exact finding `id` is not used as proof in the MVP; it is too weak without a stable evidence key.

Why these keys:

- The finding schema requires stable fields such as `id`, `ruleId`, `evidence`, `verification`, `confidence`, and `effort` (`schemas/finding.schema.json:6-18`).
- Evidence may include `node`, `screenshotRegion`, `sourceHint`, `line`, and `snippet` (`schemas/finding.schema.json:51-78`).
- Source mapping guidance already treats stable accessibility identifiers as the best bridge from runtime evidence to source (`docs/architecture.md:72-88`).

### Weak or unknown cases

Mark as `unknown` instead of fixed when the baseline finding has no strong key and only weak evidence remains, unless the exact finding ID disappears and the rule has no fresh finding at all.

Examples:

- `layout.touch-target` with no identifier and only a node path should be `unknown` if other touch-target findings remain.
- `logs.error` without a stable snippet should be `unknown` unless no fresh `logs.error` finding exists.
- Evidence-quality findings should be judged by rule presence, not source mapping. If fresh evidence still has `evidence.missing-ax-tree`, it is `still-present`; if not, it is `verified-fixed`.

### Status vocabulary

Use a small status set:

- `verified-fixed`: fresh evidence exists, fresh critique ran or was loaded, and the same issue is absent by strong matching rules.
- `still-present`: a fresh finding matches the baseline finding by strong rules.
- `changed`: same rule still appears, but strong keys differ. This means the exact old issue is not matched, but related evidence remains.
- `unknown`: the baseline finding lacks enough stable evidence to prove fixed or still present.
- `not-selected`: baseline finding was not in the selected verification set.
- `missing-baseline`: selected finding ID does not exist in baseline findings.
- `unverified`: fresh bundle was not supplied or fresh critique could not be produced. This should be an input failure for the MVP rather than a normal status when the user expects proof.

## Output Artifacts

Write artifacts into the baseline bundle:

```text
verification.json
verification.md
```

Suggested `verification.json` shape:

```json
{
  "ok": true,
  "command": "verify",
  "createdAt": "2026-06-08T00:00:00.000Z",
  "baselineBundle": "artifacts/<old-run>",
  "freshBundle": "artifacts/<new-run>",
  "baselineFindingsPath": "artifacts/<old-run>/findings.json",
  "freshFindingsPath": "artifacts/<new-run>/findings.json",
  "freshCritiqueRefreshed": true,
  "fixSessionPath": "artifacts/<old-run>/fix-session.json",
  "summary": {
    "total": 3,
    "verifiedFixed": 1,
    "stillPresent": 1,
    "changed": 0,
    "unknown": 1
  },
  "items": [
    {
      "findingId": "ax-missing-name-a21707c7",
      "ruleId": "ax.missing-name",
      "status": "verified-fixed",
      "matchKey": "node.identifier=settings.saveButton",
      "freshFindingId": null,
      "confidence": "high",
      "reason": "No fresh finding with the same rule and node identifier exists.",
      "baselineEvidence": {},
      "freshEvidence": null,
      "fixSessionItem": {
        "status": "applied",
        "file": "SettingsView.swift"
      }
    }
  ],
  "artifacts": {
    "verificationPath": "artifacts/<old-run>/verification.json",
    "reportPath": "artifacts/<old-run>/verification.md"
  }
}
```

The Markdown report should group by status and explain that `verified-fixed` means “fresh deterministic critique no longer sees the same issue,” not “the whole screen is good.”

## Implementation Steps

### 1. Add verify modules

New files:

```text
src/verify/load-verify-input.mjs
src/verify/match-findings.mjs
src/verify/verification-report.mjs
src/verify/collect-verify.mjs
```

Responsibilities:

- `load-verify-input.mjs`
  - Load baseline bundle.
  - Load baseline findings.
  - Load fresh bundle from `--fresh-bundle`.
  - Load fresh findings if present, or call `collectCritique` when missing/refresh requested.
  - Load optional fix-session context.
  - Reuse `displayPath` path semantics (`src/critique/load-evidence.mjs:82-86`).

- `match-findings.mjs`
  - Build strong match keys from `ruleId` + identifier/sourceHint/log snippet/exact ID.
  - Compare selected baseline findings against fresh findings.
  - Return status, reason, confidence, and matched fresh finding when available.

- `verification-report.mjs`
  - Write `verification.json` and `verification.md` into the baseline bundle.
  - Keep paths repo-relative for in-repo bundles and absolute for external bundles.

- `collect-verify.mjs`
  - Orchestrate the command.
  - Return the machine-readable result for CLI/tests.
  - Keep normal comparison statuses as exit code `0`.

### 2. Wire CLI

Update `bin/screenslop.mjs`:

- Import `collectVerify`.
- Route `case 'verify'` to `await verify()` instead of placeholder (`bin/screenslop.mjs:35-38`).
- Add `verify()` with the same JSON error contract used by `critique` and `fix` (`bin/screenslop.mjs:228-251`, `bin/screenslop.mjs:176-218`).
- Update help text from “coming next” to “Compare previous findings with fresh evidence” (`bin/screenslop.mjs:53-63`).
- Extend `parseOptions` boolean flags with `refresh-critique` if needed (`bin/screenslop.mjs:359-384`).

### 3. Add tests and fixtures

New test file:

```text
tests/verify.test.mjs
```

Test cases:

- Missing baseline bundle fails with JSON error.
- Missing `--fresh-bundle` fails with JSON error.
- Baseline findings load from `{ summary, findings }` and bare-array formats.
- Fresh bundle without `findings.json` triggers `collectCritique` and writes fresh critique artifacts.
- Matching by `ruleId + evidence.node.identifier` returns `still-present`.
- Missing fresh match by `ruleId + evidence.node.identifier` returns `verified-fixed`.
- Same rule still present with different identifier returns `changed`.
- Weak baseline evidence returns `unknown` when similar fresh rule remains.
- Evidence-quality rule disappears returns `verified-fixed`.
- Optional `--finding` filters selected findings and reports missing IDs as `missing-baseline` or input error. MVP recommendation: treat unknown requested IDs as input error, matching `fix` behavior (`src/fix/collect-fix.mjs:37-40`).
- `--json` output is parseable and contains no human prompt text.
- External copied bundles preserve absolute artifact paths, following the critique contract (`docs/commands.md:71-75`).

Fixture strategy:

- Reuse `tests/fixtures/evidence/problem` for baseline evidence and generated baseline findings.
- Copy fixtures to temp dirs before writing verification artifacts, as `fix` tests already do to avoid dirtying tracked fixtures (`tests/fix.test.mjs:335-360`).
- Create fresh temp variants by editing copied `accessibility.json` and rerunning `collectCritique`.
- Avoid writing `verification.json` into tracked fixtures.

### 4. Update docs

Update `docs/commands.md` under `screenslop verify`:

- Document required `--fresh-bundle`.
- Document `--finding`, `--refresh-critique`, `--fix-session`, and `--json`.
- State that `verify` compares findings against fresh evidence; it does not capture fresh evidence itself in the MVP.
- Repeat the rule: no fresh evidence, no verified claim (`docs/commands.md:113-117`).

Optional separate doc if command docs get crowded:

```text
docs/verify-contract.md
```

Only add it if the matching rules make `docs/commands.md` too dense.

## Acceptance Criteria

- `node bin/screenslop.mjs verify <baseline> --fresh-bundle <fresh> --json` prints parseable JSON.
- Missing `--fresh-bundle` exits nonzero and prints JSON error in `--json` mode.
- Fresh bundle without `findings.json` is critiqued before comparison.
- `verification.json` and `verification.md` are written into the baseline bundle.
- A baseline finding with the same `ruleId + evidence.node.identifier` in fresh findings returns `still-present`.
- A baseline finding with strong key absent from fresh findings returns `verified-fixed`.
- Same rule with different strong key returns `changed`, not `verified-fixed`.
- Weak evidence returns `unknown` when similar fresh rule evidence remains.
- Path outputs match the existing in-repo vs external-bundle contract.
- `--json` output never prompts or mixes human text.
- `node --check bin/screenslop.mjs src/verify/*.mjs tests/verify.test.mjs` passes.
- `node bin/screenslop.mjs doctor` passes before claiming completion.
- `npm test` passes.
- `npm run cleanup:macos:dry` is run; if sidecars appear, use the cleanup script after preview.

## Verification Plan

Implementation verification should run:

```bash
node --check bin/screenslop.mjs
for f in src/verify/*.mjs tests/verify.test.mjs; do node --check "$f"; done
node bin/screenslop.mjs doctor
npm test
npm run cleanup:macos:dry
```

CLI smoke:

```bash
tmp="$(mktemp -d)"
cp -R tests/fixtures/evidence/problem "$tmp/baseline"
cp -R tests/fixtures/evidence/problem "$tmp/fresh"
node -e '/* generate/adjust findings in temp bundles through collectCritique */'
node bin/screenslop.mjs verify "$tmp/baseline" --fresh-bundle "$tmp/fresh" --json
```

Runtime smoke after MVP implementation:

```bash
node bin/screenslop.mjs see --surface "Verify MVP Smoke" --logs --log-duration 500 --json
node bin/screenslop.mjs critique artifacts/<baseline-or-fresh> --json
node bin/screenslop.mjs verify artifacts/<baseline> --fresh-bundle artifacts/<fresh> --json
```

Do not claim a real app issue was fixed unless a real app source patch, rebuild/run, fresh `see`, fresh `critique`, and `verify` comparison all happened.

## Risks and Mitigations

### Risk: false “verified-fixed” claims

Mitigation:

- Require `--fresh-bundle`.
- Run/load fresh critique before comparing.
- Use `unknown` for weak evidence instead of pretending certainty.
- Keep `changed` separate from `verified-fixed` when related rule evidence remains.

### Risk: exact finding IDs are over-trusted

Mitigation:

- Use `ruleId + stable evidence key` for proof.
- Do not use ID-only matching for `verified-fixed` or `still-present` in the MVP.
- Return `unknown` when weak evidence and related fresh rules remain.

### Risk: verify becomes a runtime orchestration command too soon

Mitigation:

- MVP consumes fresh bundles; it does not capture.
- Future `--recapture` can be added after `verify` comparison is stable.
- Keep Baguette/XcodeBuildMCP runtime capture inside `see` for now (`docs/architecture.md:26-33`, `src/evidence/collect-see.mjs:26-58`).

### Risk: generated artifacts dirty test fixtures

Mitigation:

- Tests copy evidence fixtures to temp directories before running critique/verify.
- Add `.gitignore` rules only if generated fixture outputs start appearing in tracked paths.

## Follow-up Staffing Guidance

Recommended execution path:

- Use `$oh-my-codex:ralph Execute .omx/plans/screenslop-verify-mvp-2026-06-08.md` if you want the same single-owner implementation and architect-verification loop used for `fix`.
- Use `$oh-my-codex:team Execute .omx/plans/screenslop-verify-mvp-2026-06-08.md` if you want parallel lanes:
  - `worker`: verify modules and CLI wiring.
  - `tester`: temp-bundle fixtures, matcher edge cases, JSON/error contract tests.
  - `docs`: command docs after behavior settles.
  - `reviewer`: release-blocking contract review.
  - `verifier`: final doctor, tests, syntax checks, smoke commands.

Given this is a medium, contract-heavy CLI feature, Ralph is acceptable and probably simpler. Team is useful only if you want faster parallel implementation and review.

## ADR

### Decision

Build `screenslop verify` as a deterministic comparison command that consumes a baseline critique bundle and a fresh evidence/critique bundle, then writes verification artifacts into the baseline bundle.

### Drivers

- The repo rule says no fresh evidence means no verified claim (`docs/commands.md:113-117`).
- The architecture says the fix loop only marks fixed/partial/failed after fresh evidence is captured (`docs/architecture.md:90-101`).
- `critique` already owns finding generation (`src/critique/collect-critique.mjs:18-44`).
- `fix` already separates source patching and command verification from runtime proof (`src/fix/collect-fix.mjs:93-104`, `src/fix/verify-fix.mjs:10-23`).

### Alternatives considered

1. `verify` performs capture itself.
   - Rejected for MVP. It would mix runtime control, critique, and comparison in one command.

2. `verify` only reads `fix-session.json` and command output.
   - Rejected. That would violate the no-fresh-evidence rule.

3. `verify` compares baseline findings against a supplied fresh bundle.
   - Chosen. It proves the loop while keeping responsibilities clean.

4. `verify` uses exact finding IDs as proof.
   - Rejected as too brittle. Stable evidence keys are safer, and weak evidence should stay `unknown`.

### Consequences

- Users need to run `see` and `critique` before `verify` can prove anything.
- Many weak-evidence findings will be `unknown` in MVP.
- The command creates a clear foundation for future `--recapture` and `screenslop watch` flows.

### Follow-ups

- Add optional `--recapture` once runtime orchestration is ready.
- Add `screenslop verify --from-fix-session` shorthand if fix sessions become common.
- Add richer matching for screenshot regions once image/region evidence is stronger.
- Add `verify` summaries into future Mac app evidence-bundle browser.
