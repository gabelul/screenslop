# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Screenslop is an evidence-first design-review engine for Apple (SwiftUI/iOS/macOS) apps. It runs or connects to a real app, captures runtime evidence (screenshot, accessibility tree, logs), critiques it, patches narrow SwiftUI issues, and verifies the fix against a fresh capture. It ships as a public npm CLI + agent skill. There is no build step and no framework — plain ESM Node targeting Node >= 20.

**Core rule that shapes everything:** never critique Apple UI from source alone when runtime evidence can be captured. Every finding points at an artifact bundle, not a guess about the code.

## Commands

```bash
npm test                              # run all tests (node --test tests/*.test.mjs)
node --test tests/critique.test.mjs   # run a single test file
node --check bin/screenslop.mjs       # syntax-check a file (CI checks every .mjs this way)

npm run smoke:e2e                     # end-to-end capture→critique→fix→verify over fixtures
npm run smoke:e2e -- --fresh-mode fixed   # deterministic variant CI uses
npm run smoke:package                 # prove the npm tarball works without repo state
node bin/screenslop.mjs doctor        # check Baguette, XcodeBuildMCP, Xcode, simctl, Swift, Node
npm run cleanup:macos:dry             # preview macOS sidecar cleanup (always dry-run first)
```

Before claiming any work is done, the AGENTS.md contract expects: `node bin/screenslop.mjs doctor` and `npm test`. CI additionally runs both matrix invocations and `npm pack --dry-run` (see `.github/workflows/ci.yml`) — mirror those locally for release-shaped changes.

Run the CLI without installing: `node bin/screenslop.mjs <command> [--json] [--dry-run]`.

## Architecture

**Command → collector split.** `bin/screenslop.mjs` is a thin `switch` dispatcher plus all human/JSON printing and redaction. It does no domain logic — each command delegates to a `collect*()` function under `src/<domain>/`:

| Command | Collector | Domain |
|---|---|---|
| `see` | `collectSee` | `src/evidence/` — capture one evidence bundle |
| `critique` | `collectCritique` | `src/critique/` — score pillars, emit findings |
| `fix` | `collectFix` | `src/fix/` — locate source, patch SwiftUI, apply |
| `verify` | `collectVerify` | `src/verify/` — match baseline findings vs fresh evidence |
| `matrix` | `collectMatrix` | `src/matrix/` — bounded six-cell device/settings report |
| `learn` | `collectDesignProfile` | `src/design/` — project-local design profile |
| `setup`/`init` | `planInitConfig` etc. | `src/config/` — detect + write `.screenslop/config.json` |

When adding a command, keep that seam: parsing/printing/redaction in `bin/`, all logic in a `collect*` module that returns a plain result object.

**The pipeline is a loop, not a line.** `see` writes an evidence bundle → `critique` derives findings from it → `fix` patches only high-confidence issues → `see` again → `critique` again → `verify` compares the old finding against the fresh bundle. Evidence is the artifact; reports are derived from it. See `docs/architecture.md` for the full layer breakdown.

**Runtime drivers, ordered by capability:** Baguette → XcodeBuildMCP → xcodebuild/simctl → manual. Only Baguette and XcodeBuildMCP are wired today; the simctl/xcodebuild fallback is planned, not shipped — do not claim it exists in docs or output. `src/runtime/detect.mjs` decides what's available; `doctor` reports it. Dependencies are never bundled — Screenslop detects them and offers install commands only after confirmation.

**Config.** Project runtime metadata lives in `.screenslop/config.json` (git-ignored — it can leak private workspace paths and bundle IDs). `schemaVersion: 1` is the v0.1 shape and is allowed to change across 0.x with an explicit `init --migrate` path. `sourceHints` is evidence metadata and never grants write scope; source edits require an explicit `sourceRoot` from config or `--source-root`.

## Conventions that will bite you if ignored

**Agent-facing JSON is redacted.** Any output that could go to a coding agent replaces private paths, scheme names, bundle IDs, and source roots with `<placeholder>` tokens (see the `redact*` functions in `bin/screenslop.mjs`). This is a public-repo leak-prevention rule, enforced by `tests/redaction-check.test.mjs` / `tests/check-dogfood-redaction.test.mjs` and `scripts/check-dogfood-redaction.mjs`. New JSON fields that carry paths or identifiers must be redacted too.

**Safety gates on writes.** JSON mode never prompts and never writes without `--yes`. `fix --apply` refuses without a resolved `sourceRoot`. Package/CLI updates and simulator boots ask before acting. Preserve these — they're deliberate, not friction to remove.

**Public engine only.** This repo is the public engine/CLI/agent-integration. Screenslop Studio (the Mac app) is private and must *wrap* this engine, never fork its logic or schemas. Do not add `apps/mac/` or Studio-shaped placeholder code here (`docs/repo-strategy.md` lists the readiness gates that block it).

**Schemas are contracts.** `schemas/*.schema.json` (evidence, finding, matrix-report, design-profile, design-review) back `tests/contracts.test.mjs`. Changing output shape means updating the schema and the contract test together.

**Matrix reports never silently shrink.** No-config and runtime gaps are first-class cell statuses (`unavailable`, `dry-run`), not omissions. The report states whether appearance/Dynamic Type were applied, requested-only, or unavailable — it doesn't claim settings were applied unless capture succeeded.

## Voice

Comments and docs follow Gabi's persona (see the global CLAUDE.md): warm, direct, dry humor, no corporate filler. Match the tone already in `README.md` and the existing JSDoc — explain *why*, not just *what*. Conventional Commits are required.
