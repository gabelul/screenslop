# Agent Playbook

Screenslop is for agents that need to review Apple UI from the screen the app actually renders. Not from vibes, not from a SwiftUI file that looks innocent until it launches on a tiny phone and clips the button.

The rule is simple: capture runtime evidence before critique, then recapture before claiming a fix is verified.

## Who this is for

Use this playbook for:

- Codex.
- Claude Code.
- Cursor or another IDE agent.
- A plain terminal workflow where a human or script drives the same commands.

The caller does not matter much. The contract does. Agents call the CLI, Screenslop writes evidence and findings, then the agent edits the app and verifies against fresh evidence.

## Hard rules

- Do not critique Apple UI from source alone when runtime evidence can be captured.
- Prefer Baguette, then XcodeBuildMCP, then lower-level `xcodebuild` / `simctl`, then manual evidence.
- In v0.1, `screenslop see` needs Baguette for the shipped live capture path.
- Do not pretend the sample app proves a private app.
- Do not patch every finding by default. Pick one high-confidence finding first.
- `screenslop verify` needs a fresh bundle. It does not capture new evidence itself.
- Do not commit `.screenslop/config.json`, private app paths, bundle IDs, screenshots, or raw dogfood reports.

## Agent setup

Start with the machine check:

```bash
screenslop doctor
```

If you are running from a checkout instead of a global install:

```bash
node bin/screenslop.mjs doctor
```

If the host supports agent skills, install or point it at the Screenslop skill before asking it to review UI:

```text
skills/screenslop/SKILL.md
docs/skill-installation.md
```

The skill install teaches the agent the loop. It does not create `.screenslop/config.json` and it does not connect a private app.

A healthy runtime prefers this order:

```text
Baguette -> XcodeBuildMCP -> xcodebuild/simctl -> manual evidence
```

If Baguette is missing, stop and fix runtime setup or use manual evidence. Do not quietly swap in source-only critique and call it the same thing.

## The safe loop

This is the loop every agent should follow:

```bash
screenslop see --surface <surface> --json
screenslop critique artifacts/<baseline-run> --json

screenslop fix artifacts/<baseline-run> \
  --finding <finding-id> \
  --source-root <app-source-root> \
  --apply \
  --yes \
  --label "<replacement label>" \
  --json

screenslop see --surface <surface> --json
screenslop critique artifacts/<fresh-run> --json

screenslop verify artifacts/<baseline-run> \
  --fresh-bundle artifacts/<fresh-run> \
  --finding <finding-id> \
  --fix-session artifacts/<baseline-run>/fix-session.json \
  --json
```

What the loop proves:

1. First `see`: the app rendered and Screenslop captured evidence.
2. First `critique`: findings came from that evidence.
3. `fix`: Screenslop planned or applied a narrow selected patch.
4. Second `see`: there is fresh evidence after the edit.
5. Second `critique`: the fresh bundle was reviewed independently.
6. `verify`: the selected baseline finding is fixed, still present, changed, unknown, or missing by comparison with fresh critique output.

No second capture means no verified fix. It is just an edit with optimism sprinkled on top.

## Codex

Use the Screenslop skill when available, then run the CLI loop above.

Recommended Codex behavior:

1. Read `AGENTS.md` and the Screenslop docs first.
2. Run `screenslop doctor`.
3. Capture evidence before commenting on UI quality.
4. Patch only selected findings with a clear source root.
5. Recapture and verify before saying fixed.
6. Commit only public-safe docs, tests, scripts, schemas, and engine files.

Do not add Screenslop Studio files from this repo. Studio is a separate private wrapper and stays blocked until engine dogfood passes.

## Claude Code

Claude Code can use the same CLI contract from Bash.

Suggested prompt shape:

```text
Use Screenslop for this Apple UI review. Run screenslop doctor, capture runtime evidence with screenslop see, critique the bundle, patch one selected high-confidence finding, recapture, critique the fresh bundle, then verify. Do not critique from SwiftUI source alone when runtime evidence can be captured. Do not commit private .screenslop/config.json or raw app artifacts.
```

If Claude Code has a local skill/spec system, point it at the same contract in `skills/screenslop/SKILL.md` and this playbook. The engine does not need a special Claude-only command path.

## Cursor and IDE agents

Cursor or another IDE agent only needs shell access and edit access.

Recommended IDE-agent instruction:

```text
Use Screenslop as the Apple UI evidence source. Run the CLI commands with --json, use findings from the captured evidence bundle, edit only the selected source file or narrow source root, then recapture and verify with screenslop verify. If runtime capture is blocked, report the blocker instead of making source-only UI claims.
```

Keep IDE convenience features out of the engine contract. Screenslop should not care which editor launched it.

## Plain terminal

A human can run the same thing:

```bash
screenslop doctor
screenslop see --surface Settings --json
screenslop critique artifacts/<baseline-run> --json
```

After reviewing the finding ID:

```bash
screenslop fix artifacts/<baseline-run> \
  --finding <finding-id> \
  --source-root <app-source-root> \
  --apply \
  --yes \
  --label "Save settings" \
  --json
```

Then verify with fresh evidence:

```bash
screenslop see --surface Settings --json
screenslop critique artifacts/<fresh-run> --json
screenslop verify artifacts/<baseline-run> \
  --fresh-bundle artifacts/<fresh-run> \
  --finding <finding-id> \
  --fix-session artifacts/<baseline-run>/fix-session.json \
  --json
```

## Contract checks without a simulator

Agents can check the command/artifact contract without Apple runtime tools:

```bash
npm run --silent smoke:e2e -- --fresh-mode fixed
```

That is fixture proof only. It proves the commands compose and artifacts are readable. It does not prove a real app screen is fixed.

## Sample runtime smoke

When Apple runtime tools are available:

```bash
npm run smoke:runtime
```

This builds and launches `examples/runtime-smoke-app`, captures baseline evidence, applies one safe sample fix, captures fresh evidence, critiques it, and verifies the selected finding.

It proves the public sample app loop. It does not prove a private app. The distinction is boring and slightly irritating, which is usually how you know it matters.

## Private real-app dogfood

Private dogfood needs a local target config or equivalent CLI flags. The config is ignored by git because it can expose paths and bundle IDs.

Preflight first:

```bash
node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --identifier <stable-accessibility-identifier> \
  --preflight-only
```

Full configured run:

```bash
node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --identifier <stable-accessibility-identifier>
```

A passing private dogfood report must include:

```text
summary.status: "passed"
summary.captureStatus: "passed"
summary.critiqueStatus: "passed"
summary.fixStatus: "passed"
summary.freshCaptureStatus: "passed"
summary.freshCritiqueStatus: "passed"
summary.verifyStageStatus: "passed"
summary.verifyStatus: "verified-fixed"
pathDisplayMode: "redacted"
```

Run the public-safe report check before committing any lesson from dogfood:

```bash
node scripts/check-dogfood-redaction.mjs artifacts/<dogfood-report>.json \
  --forbid "$HOME" \
  --forbid "<private-source-root>" \
  --forbid "<private-bundle-id>"
```

If the private config is missing, the selected screen has no stable identifier, or the finding is not auto-fixable, record `recorded-blocker` and keep Studio blocked. That is not failure; that is the tool refusing to lie.

## What agents should read first

Use this order in a fresh repo session:

```text
AGENTS.md
README.md
docs/getting-started.md
docs/commands.md
docs/agent-integrations.md
docs/skill-installation.md
skills/screenslop/SKILL.md
```

For release or dogfood decisions, also read:

```text
docs/engine-contract.json
docs/release-checklist.md
docs/session-handoff.md
```

## Stop conditions

Stop and report the blocker when:

- `screenslop doctor` fails on required runtime tools.
- Baguette capture is unavailable and no manual evidence was supplied.
- `.screenslop/config.json` is missing or unsafe for private dogfood.
- No stable identifier or selected finding exists for the target screen.
- `fix` wants to patch outside `sourceRoot`.
- Fresh capture or fresh critique fails.
- `verifyStatus` is not `verified-fixed` for the selected finding.
- The redaction check finds private strings or raw absolute paths.

Do not smooth over these. The whole product is built around evidence, so the blocker is evidence too.
