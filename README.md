# Screenslop

Screenslop is Pixelslop for Apple apps: run the app, capture the real screen, read the accessibility tree, inspect the source, then fix what actually broke.

AI can generate SwiftUI now. Very fast. Sometimes suspiciously fast. Screenslop exists because "it compiles" is not the same as "this screen feels native, readable, accessible, and not like a tutorial screenshot with a nicer font."

## What it does

Screenslop reviews Apple app UI from evidence, not vibes:

1. Runs or connects to an Apple app surface.
2. Captures screenshots, accessibility JSON, logs, and source hints.
3. Scores the screen across Apple-native design pillars.
4. Produces findings with proof.
5. Fixes selected issues and verifies with a fresh capture.

Baguette is the preferred runtime for iOS simulator screens. If it is not available, Screenslop falls back to XcodeBuildMCP, then `xcrun simctl` / `xcodebuild`, screenshots, and manual evidence where possible.

## Why this exists


Screenslop takes the useful idea and makes it native:

```text
see the app -> critique the rendered UI -> patch SwiftUI -> verify on the simulator
```

## Commands

```bash
screenslop init      # create project context and runtime preferences
screenslop doctor    # check Baguette, XcodeBuildMCP, Xcode, simctl, and fallback paths
screenslop see       # capture screenshot + AX tree + logs
screenslop critique  # score current evidence and produce findings
screenslop fix       # patch selected findings, then recapture
screenslop matrix    # run across devices, appearance, type size, motion settings
screenslop verify    # confirm previous findings are fixed
screenslop watch     # live review loop for ongoing UI iteration
```

## Current status

This is the scaffold. The first real milestone is `screenslop see` producing an evidence bundle:

```text
artifacts/<run-id>/screenshot.jpg
artifacts/<run-id>/accessibility.json
artifacts/<run-id>/logs.ndjson
artifacts/<run-id>/summary.md
```

After that, critique and fix become much less hand-wavy.

## Runtime priority

1. **Baguette**: live simulator control, screenshots, AX tree, logs, input.
2. **XcodeBuildMCP**: MCP/CLI fallback for agent-friendly build, run, test, screenshot, and simulator workflows.
3. **simctl/xcodebuild**: stable fallback for local machines when MCP tooling is not installed.
4. **Manual evidence**: user-provided screenshot plus source path.

## Mac app or CLI?

CLI first, Mac app later.

The agent needs a boring, scriptable core more than it needs a beautiful wrapper. A Mac app will help once the capture and finding loop works: device farm view, screenshot diffs, finding triage, and one-click reruns. But the Mac app should call the same core, not become the core.

## Repo strategy

Screenslop is the public engine repo: core, CLI, and agent integrations. The future Mac app should live privately as Screenslop Studio and wrap this same engine instead of growing a second critique brain. See [docs/session-handoff.md](docs/session-handoff.md), [docs/commands.md](docs/commands.md), [docs/repo-strategy.md](docs/repo-strategy.md), [docs/agent-integrations.md](docs/agent-integrations.md), [docs/maintenance.md](docs/maintenance.md), and [docs/research-workspace.md](docs/research-workspace.md).

## License

Apache 2.0.

Built by Gabi @ Booplex, because AI can now make Apple apps look almost right, and "almost right" is where the annoying bugs live.
