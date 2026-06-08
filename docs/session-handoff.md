# Session Handoff

This file exists so a new AI session can pick up Screenslop without needing the original chat.

## Project paths

Public engine:

```text
<local Screenslop checkout>
```

Private Mac app shell:

```text
<private Screenslop Studio checkout>
```

## Product decision

Screenslop is the public engine, CLI, schemas, runtime drivers, docs, and AI-agent integrations.

Screenslop Studio is the private Mac app wrapper. It should consume Screenslop instead of building its own critique logic.

```text
The engine owns the truth.
Studio owns the experience.
```

## Runtime priority

Screenslop runtime order:

1. Baguette
2. XcodeBuildMCP
3. xcodebuild + simctl
4. manual evidence

Current local status from `screenslop doctor`:

```text
baguette: 0.1.74
xcodebuildmcp: 2.5.1
Xcode: 26.5
Swift: 6.3.2
```

## Current engine state

Working pieces:

- `bin/screenslop.mjs`
- project config and migration in `src/config/`
- runtime detection in `src/runtime/detect.mjs`
- Baguette capture in `src/runtime/baguette.mjs`
- evidence bundle scaffold in `src/evidence/`
- critique, fix, verify, and matrix modules in `src/`
- schemas in `schemas/`
- agent skill in `skills/screenslop/`
- docs in `docs/`
- ignored research workspace in `research/`

Tests:

```bash
npm test
```

Doctor:

```bash
node bin/screenslop.mjs doctor
```

Fixture smoke:

```bash
npm run --silent smoke:e2e -- --fresh-mode fixed
```

Real-runtime sample smoke:

```bash
npm run smoke:runtime
```

The real-runtime smoke builds and launches `examples/runtime-smoke-app` through XcodeBuildMCP, captures Baguette evidence, applies one safe sample-app fix, recaptures, critiques again, and verifies the selected finding against fresh evidence. It is sample-app proof, not proof for a private user app.

Matrix smoke:

```bash
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
```

The matrix command writes a six-cell report and one evidence bundle per cell. No
config is not a blocker for the command; cells are marked unavailable with
explicit no-config evidence instead of being dropped.

## Important docs

Read these first in a new session:

```text
docs/architecture.md
docs/commands.md
docs/repo-strategy.md
docs/agent-integrations.md
docs/research-workspace.md
docs/roadmap.md
```

## Current release state

The v0.1 engine loop is complete and package-ready. The flat repo layout is intentional for v0.1; `package.json` uses an explicit `files` whitelist so local state, research folders, `.omx`, generated artifacts, and private config stay out of the npm tarball.

Before tagging or publishing, run the release checklist in `docs/release-checklist.md`.

## Research workspace

Ignored research folders:

```text
research/repos/
research/skills/
research/findings/
```

Many Apple/SwiftUI/design-agent repos are cloned there. They are not shipped. Mine them for patterns, then promote clean decisions into tracked docs.

## Cleanup note

Because this lives on an external drive, macOS creates `._*` sidecar files.

Preview cleanup:

```bash
npm run cleanup:macos:dry
```

Delete after confirmation:

```bash
npm run cleanup:macos
```

Do not delete files silently.
