# Session Handoff

This file exists so a new AI session can pick up Screenslop without needing the original chat.

## Project paths

Public engine:

```text
/Volumes/MyEXT/Projects/Apple_Stuff/screenslop
```

Private Mac app shell:

```text
/Volumes/MyEXT/Projects/Apple_Stuff/screenslop-studio
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

## Current scaffold

Working pieces:

- `bin/screenslop.mjs`
- runtime detection in `src/runtime/detect.mjs`
- Baguette wrapper stub in `src/runtime/baguette.mjs`
- evidence bundle scaffold in `src/evidence/`
- schemas in `schemas/`
- agent skill stub in `skills/screenslop/`
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

## Current next engineering step

Wire `screenslop see` to Baguette:

1. `baguette list --json`
2. choose a booted simulator or offer to boot one
3. capture screenshot with `baguette screenshot`
4. capture AX tree with `baguette describe-ui`
5. optionally collect logs
6. write a complete `evidence.json`
7. support `--json` output for agents

After that, implement the first `critique` pass against evidence.

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
