# Screenslop Agent Playbook + Real-App Dogfood Validation Plan

Date: 2026-06-08
Owner: Screenslop engine repo
Mode: planning only, no Studio work

## Requirements Summary

Build the next engine-only proof layer before Screenslop Studio starts:

1. Turn the existing agent docs and skill into a practical agent playbook for Codex, Claude Code, Cursor, and plain terminal agents.
2. Keep the CLI as the stable agent contract; MCP can stay future work for now (`docs/agent-integrations.md:7-13`).
3. Preserve the runtime-first rule: no Apple UI critique from source alone when evidence can be captured (`docs/architecture.md:3-5`, `skills/screenslop/SKILL.md:17-24`).
4. Dogfood on at least one private real app and prove one selected issue as `verified-fixed` after fresh capture and fresh critique (`docs/session-handoff.md:36-53`, `docs/release-checklist.md:25-53`).
5. Keep Studio blocked until the private dogfood and redaction gates pass (`docs/repo-strategy.md:91-109`, `README.md:184-210`).
6. Do not commit private `.screenslop/config.json`, app paths, bundle IDs, or dogfood artifacts (`docs/architecture.md:37-39`, `docs/release-checklist.md:55-67`).

## Current Evidence

- The repo already ships a Screenslop skill scaffold at `skills/screenslop/SKILL.md`, including the command list, runtime order, standard checks, private preflight command, and `verified-fixed` gate (`skills/screenslop/SKILL.md:1-72`).
- Agent integration docs already define the cross-agent model and name Codex, Claude Code, Cursor, and generic IDE agents (`docs/agent-integrations.md:1-37`).
- The README already says Screenslop works with Codex, Claude Code, Cursor, Baguette, XcodeBuildMCP, and shell fallback paths (`README.md:5-12`).
- The package whitelist already ships `skills/` and the core docs, but not a dedicated `docs/agent-playbook.md` yet (`package.json:9-49`).
- Contract tests already check CLI/help command drift, fallback wording, dogfood gate language, and release-gate semantics (`tests/contracts.test.mjs:104-149`).
- The real-runtime smoke supports configured private targets, validates config before build/run, gates verify behind fresh build, fresh `see`, fresh artifacts, and fresh critique, then redacts private paths in the final JSON report (`docs/commands.md:260-284`, `scripts/smoke-real-runtime.mjs:613-655`, `scripts/smoke-real-runtime.mjs:796-879`).
- Current docs state that the sample runtime smoke proves only the sample app, not a private user app (`docs/commands.md:230-238`, `docs/agent-integrations.md:104-114`).

## Non-Goals

- Do not start Screenslop Studio.
- Do not add `apps/mac/`, private wrapper scaffolding, or duplicate critique/runtime/fix logic (`docs/session-handoff.md:30-34`, `docs/repo-strategy.md:120-126`).
- Do not publish private app identifiers, paths, screenshots, bundle IDs, or raw dogfood reports.
- Do not add a broad auto-fix pass. Keep the MVP fix loop narrow and evidence-backed (`docs/architecture.md:139-150`, `docs/commands.md:153-161`).
- Do not claim Baguette-less `see` fallback is shipped. The current skill explicitly says non-Baguette capture fallback is future work (`skills/screenslop/SKILL.md:1-3`, `skills/screenslop/SKILL.md:48-49`).

## Acceptance Criteria

### Agent playbook

- `docs/agent-playbook.md` exists and gives copy-paste-safe workflows for:
  - Codex.
  - Claude Code.
  - Cursor / generic IDE agents.
  - Plain terminal usage.
- The playbook repeats the hard rule: capture real evidence before critique, recapture before verified-fix claims.
- The playbook uses only shipped commands from `docs/engine-contract.json` and `skills/screenslop/SKILL.md`.
- The playbook explains that `npm run smoke:runtime` proves the sample app only.
- The playbook includes private dogfood preflight and full-run commands, with placeholders instead of private app values.
- The README documentation map links to the playbook.
- `package.json` `files` includes the playbook so the npm tarball contains the agent instructions.
- `tests/contracts.test.mjs` checks that the playbook does not drift from the command contract or overclaim fallback capture.

### Skill/reference polish

- `skills/screenslop/SKILL.md` stays concise and points to reference docs for longer recipes.
- Add one or more reference files only if they reduce skill bloat, for example:
  - `skills/screenslop/reference/agent-contract.md`
  - `skills/screenslop/reference/dogfood.md`
- Any added skill reference is shipped through the existing `skills/` package whitelist.
- The skill still states that `verify` needs a fresh bundle and does not capture new evidence itself.

### Real-app dogfood validation

- A private `.screenslop/config.json` is created locally only, or CLI flags are used for a configured target. It must not be committed.
- Preflight passes for the selected app without launching runtime tools:

  ```bash
  node scripts/smoke-real-runtime.mjs \
    --config .screenslop/config.json \
    --identifier <stable-accessibility-identifier> \
    --preflight-only
  ```

- Full configured dogfood passes for at least one real app surface:

  ```bash
  node scripts/smoke-real-runtime.mjs \
    --config .screenslop/config.json \
    --identifier <stable-accessibility-identifier>
  ```

- The final public-safe report has:
  - `summary.status: "passed"`
  - `summary.captureStatus: "passed"`
  - `summary.critiqueStatus: "passed"`
  - `summary.fixStatus: "passed"`
  - `summary.freshCaptureStatus: "passed"`
  - `summary.freshCritiqueStatus: "passed"`
  - `summary.verifyStageStatus: "passed"`
  - `summary.verifyStatus: "verified-fixed"`
  - `pathDisplayMode: "redacted"`
- A machine leak check confirms the public-safe report contains no private source root, workspace path, home path, bundle ID, or raw app name before any lesson is committed.
- If the app lacks a stable identifier or auto-fixable finding, record `recorded-blocker` and keep Studio blocked. Do not fake success.

### Repo health

- These commands pass before the work is marked complete:

  ```bash
  npm run cleanup:macos:dry
  node bin/screenslop.mjs doctor
  npm test
  npm run --silent smoke:e2e -- --fresh-mode fixed
  node bin/screenslop.mjs matrix --dry-run --json
  npm pack --dry-run
  npm run --silent smoke:package
  ```

- Run `npm run smoke:runtime` if Apple simulator tools are available and stable.
- Commit and push the finished docs/test/contract changes.

## Implementation Steps

### 1. Add the agent playbook

Files:

- `docs/agent-playbook.md`
- `README.md`
- `package.json`

Work:

1. Create `docs/agent-playbook.md` as the single practical manual for AI coding agents.
2. Include four tracks:
   - Codex.
   - Claude Code.
   - Cursor / generic IDE agents.
   - Plain terminal.
3. For each track, show the same safe loop:

   ```bash
   screenslop doctor
   screenslop see --surface <surface> --json
   screenslop critique artifacts/<baseline-run> --json
   screenslop fix artifacts/<baseline-run> --finding <id> --source-root <app-root> --apply --yes --label "<label>" --json
   screenslop see --surface <surface> --json
   screenslop critique artifacts/<fresh-run> --json
   screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id> --fix-session artifacts/<baseline-run>/fix-session.json --json
   ```

4. Add a private dogfood section using only placeholders.
5. Link the playbook from the README documentation map.
6. Add `docs/agent-playbook.md` to the npm package whitelist.

### 2. Harden the skill without bloating it

Files:

- `skills/screenslop/SKILL.md`
- Optional: `skills/screenslop/reference/agent-contract.md`
- Optional: `skills/screenslop/reference/dogfood.md`

Work:

1. Keep the top-level skill short enough for agents to read quickly.
2. Add reference links for longer recipes if needed.
3. Keep the existing runtime priority and fallback truth intact.
4. Add an explicit “stop and ask/fix runtime” rule when Baguette capture is unavailable.
5. Add a “private dogfood is not sample proof” reminder if the playbook does not make that obvious enough.

### 3. Add contract coverage for the playbook

Files:

- `tests/contracts.test.mjs`
- `docs/engine-contract.json` only if the contract itself changes.

Work:

1. Extend the existing command-drift test so the playbook only advertises commands listed in `docs/engine-contract.json`.
2. Add assertions that the playbook says:
   - source-only critique is not acceptable when runtime evidence can be captured.
   - sample runtime smoke is not private dogfood proof.
   - `verify` needs a fresh bundle.
   - private dogfood must finish with `verified-fixed` and `pathDisplayMode: "redacted"`.
3. Do not add a new command unless the engine contract changes first.

### 4. Add or confirm a machine dogfood leak check

Files:

- Preferred: `scripts/check-dogfood-redaction.mjs`
- Tests: `tests/real-runtime-smoke.test.mjs` or a new focused test file.
- Docs: `docs/release-checklist.md`, `docs/agent-playbook.md`

Work:

1. If existing redaction tests are enough for unit behavior, add a small report-check script for real dogfood outputs.
2. Script input:

   ```bash
   node scripts/check-dogfood-redaction.mjs artifacts/<dogfood-report>.json \
     --forbid "$HOME" \
     --forbid "<private-source-root>" \
     --forbid "<private-bundle-id>"
   ```

3. Script should fail on raw absolute paths, known private strings, or missing `pathDisplayMode: "redacted"`.
4. Add tests for clean and leaking reports.
5. Document the command in the playbook and release checklist.

### 5. Run first real-app preflight

Files:

- Local-only: `.screenslop/config.json`
- No tracked file changes unless a public docs/test gap is found.

Work:

1. Pick one private app with a screen that has or can quickly get a stable identifier.
2. Prefer an identifier that can trigger an MVP auto-fixable finding:
   - `ax.missing-name`
   - `ax.generic-name`
   - `layout.touch-target`
3. Create local config with `workspacePath` or `projectPath`, `defaultScheme`, `defaultBundleId`, `sourceRoot`, `defaultSurface`, and `defaultDevice`.
4. Run preflight only.
5. If preflight fails, fix config or record `recorded-blocker`. Do not continue to runtime capture.

### 6. Run first real-app full dogfood

Files:

- Local-only dogfood artifacts under ignored `artifacts/`.
- Public docs may receive a sanitized lesson only after redaction passes.

Work:

1. Run the full configured smoke.
2. Confirm it reaches baseline build/run, baseline `see`, baseline critique, selected finding, fix apply, fresh build/run, fresh `see`, fresh critique, verify.
3. Confirm `summary.verifyStatus` is `verified-fixed`.
4. Run the leak check against the final report.
5. Manually inspect screenshots and findings enough to catch false confidence. The JSON can pass while the screen is still ugly in a different way. Annoying, but very possible.
6. If successful, update `docs/session-handoff.md`, `docs/known-limitations.md`, and `docs/release-checklist.md` from `recorded-blocker` to real dogfood evidence, using only redacted public-safe details.

### 7. Expand to a small real-app matrix if the first app passes

Files:

- Local-only config/artifacts first.
- Public docs only get sanitized findings.

Work:

1. Run at least one matrix command for the configured app:

   ```bash
   node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
   ```

2. Check all six cells are present.
3. Treat unavailable setting application honestly; do not say Dynamic Type or appearance was applied unless the report proves it.
4. Decide if the engine needs a fix before Studio based on the matrix output.

### 8. Final review, commit, and push

Work:

1. Run the repo health commands from the acceptance criteria.
2. Review changed docs for overclaims and AI-slop wording.
3. Confirm `git status --short` contains only intended tracked changes and ignored private artifacts stay ignored.
4. Commit with a conventional commit message, for example:

   ```bash
   git commit -m "docs: add Screenslop agent playbook"
   ```

5. Push to `origin/main`.
6. Do not cut a release tag until the private dogfood gate is genuinely passed and the user explicitly wants the release/tag step.

## Risks and Mitigations

- Risk: The playbook promises a fallback capture path the engine does not ship.
  - Mitigation: Contract tests assert the fallback wording remains honest.
- Risk: Private app paths or bundle IDs leak into committed docs.
  - Mitigation: Keep `.screenslop/config.json` ignored, run the redaction checker, and commit only sanitized lessons.
- Risk: The selected real-app screen has no stable identifier or no auto-fixable issue.
  - Mitigation: Pick another screen, add a stable accessibility identifier manually, or record `recorded-blocker` instead of forcing the smoke to pass.
- Risk: The full dogfood passes technically but fixes something trivial while missing the visual problem we care about.
  - Mitigation: Do one manual screenshot/artifact inspection before marking the gate passed.
- Risk: Docs and skill drift again after edits.
  - Mitigation: Extend `tests/contracts.test.mjs` to cover the new playbook and keep `docs/engine-contract.json` as the source of truth.
- Risk: Studio work sneaks in through “just a small shell”.
  - Mitigation: Keep this plan scoped to engine, CLI, docs, skill, scripts, tests, and private dogfood proof only.

## Verification Steps

Run after implementation:

```bash
npm run cleanup:macos:dry
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
node bin/screenslop.mjs matrix --dry-run --json
npm pack --dry-run
npm run --silent smoke:package
```

Run when Apple runtime tools are available:

```bash
npm run smoke:runtime
```

Run for private dogfood:

```bash
node scripts/smoke-real-runtime.mjs \
  --config .screenslop/config.json \
  --identifier <stable-accessibility-identifier> \
  --preflight-only

node scripts/smoke-real-runtime.mjs \
  --config .screenslop/config.json \
  --identifier <stable-accessibility-identifier>

node scripts/check-dogfood-redaction.mjs artifacts/<dogfood-report>.json \
  --forbid "$HOME" \
  --forbid "<private-source-root>" \
  --forbid "<private-bundle-id>"
```

If the redaction checker script is not added, use the existing runtime report redaction tests plus a manual grep as a temporary gate, but do not call that the long-term solution.

## Execution Staffing Guidance

Recommended follow-up: `$oh-my-codex:ultragoal Execute .omx/plans/screenslop-agent-playbook-real-app-dogfood-2026-06-08.md`

Use parallel agents where it helps:

- `docs`: write `docs/agent-playbook.md` and README updates.
- `worker`: add redaction checker script and contract tests.
- `tester`: run/extend tests and package smoke.
- `verifier`: check acceptance criteria and private dogfood report shape.
- `security`: inspect leak/redaction risk before any public dogfood lesson is committed.
- `reviewer`: review docs and contract changes for overclaims.

Keep real-app dogfood under a durable goal owner because it may need multiple attempts against private apps. Ralph is a fallback only if the user explicitly asks for a persistent single-owner run.

## Stop Rules

Stop and report `recorded-blocker` if:

- `.screenslop/config.json` is missing, incomplete, unsafe, or points outside the allowed target shape.
- Baguette or XcodeBuildMCP cannot support the configured run and no honest runtime evidence is captured.
- No stable identifier or selected finding exists for the target screen.
- The fix applies outside `sourceRoot`.
- Fresh capture or fresh critique does not run.
- `verifyStatus` is anything other than `verified-fixed` for the selected finding.
- The redaction check finds private paths, bundle IDs, or app identifiers.

## Studio Gate Decision

Studio remains blocked until this plan produces:

1. A shipped, contract-tested agent playbook.
2. A passing private real-app dogfood run with `verified-fixed`.
3. A passing redaction/leak check.
4. Updated release/handoff docs with public-safe evidence.

Until then, the engine is promising but not proven on a real app. That is exactly the annoying line we should keep.
