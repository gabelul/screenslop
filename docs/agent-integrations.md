# Agent Integrations

Screenslop needs to work where AI coding agents already live. The engine should not care whether the caller is Claude Code, Codex, Cursor, or a future agent. Agents call the CLI/core, the core writes evidence and findings, and the agent decides how to patch the app.

## Integration model

```text
AI agent -> Screenslop skill/spec -> screenslop CLI -> core engine -> runtime driver
                                                       -> evidence bundle
                                                       -> findings
```

The CLI is the stable contract for agents. MCP can come later as a richer transport, but the CLI should remain the boring path that always works.

## Supported agent surfaces

### Codex

Ship a Codex-friendly skill that tells the agent to:

1. Run `screenslop doctor`.
2. Run `screenslop see` before judging UI.
3. Read the evidence bundle.
4. Produce findings with evidence references.
5. Patch only selected findings.
6. Run `screenslop verify` after edits.

Codex can also use XcodeBuildMCP tools directly when available, but Screenslop should still own the evidence schema and report format.

### Claude Code

Ship a Claude skill/spec with the same command contract. Claude Code can call Baguette and Screenslop directly from Bash, then use the evidence bundle to guide file edits.

### Cursor / other IDE agents

Use the same skill/spec shape, with no assumptions about the IDE. If the agent can run a shell command and edit files, it can use Screenslop.

## File layout

Public engine repo:

```text
packages/
  core/              # engine, schemas, runtime drivers
  cli/               # screenslop command
  agents/            # Claude/Codex/Cursor skill specs and install helpers
skills/
  screenslop/        # current skill scaffold while packages are flat
```

Private Mac app repo:

```text
screenslop-studio/
  app/               # private SwiftUI/AppKit app
  vendor-or-link/    # consumes public core/CLI as a dependency
```

The private app can call the public CLI at first. Later it can import a packaged core if that becomes cleaner.

## Agent contract

Every agent integration follows the same rules:

- Do not critique UI from source alone when runtime evidence is available.
- Prefer Baguette, then XcodeBuildMCP, then simctl/xcodebuild, then manual evidence.
- Every finding must include an evidence pointer.
- Do not install dependencies without explicit user confirmation.
- Do not patch everything by default. Pick the highest-value findings first.
- Always recapture or verify after edits.

## CLI commands agents should rely on

```bash
screenslop doctor --json
screenslop see --json --surface <name>
screenslop critique --json <evidence-dir>
screenslop fix --finding <id>
screenslop verify <evidence-dir>
screenslop matrix --surface <name> --profile default
```

The `--json` forms should be implemented early. Human output can be friendly; agent output needs strict contracts.

## MCP plan

An MCP server is useful later, but not required for the first version.

MCP tools could expose:

- `screenslop_doctor`
- `screenslop_see`
- `screenslop_critique`
- `screenslop_fix`
- `screenslop_verify`
- `screenslop_list_evidence`

Keep MCP as a wrapper over the same core. Do not let it grow separate behavior.
