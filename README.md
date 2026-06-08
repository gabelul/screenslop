# Screenslop

Screenslop is Pixelslop for Apple apps: run the app, capture the real screen, read the accessibility tree, inspect the source, then fix what actually broke.

AI can generate SwiftUI now. Very fast. Sometimes suspiciously fast. Screenslop exists because "it compiles" is not the same as "this screen feels native, readable, accessible, and not like a tutorial screenshot with a nicer font."

## What it does

Screenslop reviews Apple app UI from evidence, not vibes:

1. Configures a target app.
2. Runs or connects to an Apple app surface.
3. Captures screenshots, accessibility JSON, logs, and source hints.
4. Scores the screen across Apple-native design pillars.
5. Produces findings with proof.
6. Fixes selected issues and verifies with a fresh capture.
7. Writes a bounded matrix report across the first device/settings cells.

Baguette is the preferred runtime for iOS simulator screens. If it is not available, Screenslop falls back to XcodeBuildMCP, then `xcrun simctl` / `xcodebuild`, screenshots, and manual evidence where possible.

## Why this exists

Impeccable has the right taste system. Pixelslop has the right evidence loop for web. Baguette gives Apple apps the missing runtime layer.

Screenslop takes the useful idea and makes it native:

```text
see the app -> critique the rendered UI -> patch SwiftUI -> verify on the simulator
```

## Commands

```bash
screenslop init      # create or migrate .screenslop/config.json
screenslop doctor    # check Baguette, XcodeBuildMCP, Xcode, simctl, and fallback paths
screenslop see       # capture screenshot + AX tree + logs
screenslop critique  # score current evidence and produce findings
screenslop fix       # patch selected safe findings
screenslop verify    # confirm previous findings are fixed
screenslop matrix    # write a bounded six-cell stress report
screenslop watch     # live review loop for ongoing UI iteration
```

## Current status

The public MVP loop is wired for evidence capture, critique, selected safe fixes,
fresh verification, configured runtime smoke, and a bounded matrix report.

Evidence bundles look like:

```text
artifacts/<run-id>/screenshot.jpg
artifacts/<run-id>/accessibility.json
artifacts/<run-id>/logs.ndjson
artifacts/<run-id>/summary.md
```

Useful local checks:

```bash
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
npm run smoke:runtime
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
```

## Runtime priority

1. **Baguette**: live simulator control, screenshots, AX tree, logs, input.
2. **XcodeBuildMCP**: MCP/CLI fallback for agent-friendly build, run, test, screenshot, and simulator workflows.
3. **simctl/xcodebuild**: stable fallback for local machines when MCP tooling is not installed.
4. **Manual evidence**: user-provided screenshot plus source path.

## Mac app or CLI?

CLI first, Mac app later.

The agent needs a boring, scriptable core more than it needs a beautiful wrapper. A Mac app will help once the capture and finding loop works: device farm view, screenshot diffs, finding triage, and one-click reruns. But the Mac app should call the same core, not become the core.

## Repo strategy

Screenslop is the public engine repo: core, CLI, and agent integrations. The future Mac app should live privately as Screenslop Studio and wrap this same engine instead of growing a second critique brain. See [docs/session-handoff.md](docs/session-handoff.md), [docs/commands.md](docs/commands.md), [docs/repo-strategy.md](docs/repo-strategy.md), [docs/agent-integrations.md](docs/agent-integrations.md), [docs/known-limitations.md](docs/known-limitations.md), [docs/release-checklist.md](docs/release-checklist.md), [docs/maintenance.md](docs/maintenance.md), and [docs/research-workspace.md](docs/research-workspace.md).

## License

Apache 2.0.

Built by Gabi @ Booplex, because AI can now make Apple apps look almost right, and "almost right" is where the annoying bugs live.
