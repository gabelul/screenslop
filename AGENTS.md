# Screenslop Agent Notes

Start by reading:

```text
docs/session-handoff.md
docs/architecture.md
docs/commands.md
docs/repo-strategy.md
docs/agent-integrations.md
```

Screenslop is the public engine/CLI/agent-integration repo. Screenslop Studio is private and should wrap this engine, not duplicate it.

Runtime priority:

```text
Baguette -> XcodeBuildMCP -> xcodebuild/simctl -> manual evidence
```

Core rule: do not critique Apple UI from source alone when runtime evidence can be captured.

Before claiming work is done, run:

```bash
node bin/screenslop.mjs doctor
npm test
```

If macOS sidecar files appear, preview cleanup first:

```bash
npm run cleanup:macos:dry
```

Ask before destructive cleanup.
