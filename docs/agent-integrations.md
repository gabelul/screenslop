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
3. Run `screenslop critique` on the captured bundle.
4. Patch only selected findings.
5. Run `screenslop see` again after edits.
6. Run `screenslop critique` on the fresh bundle.
7. Run `screenslop verify <baseline> --fresh-bundle <fresh>` for selected findings.
8. For layout-sensitive work, run `screenslop matrix --profile examples/matrix/phone-sizes.json --critique --json` before calling the fix done.

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
- Always recapture and critique after edits before calling a fix verified.
- For SwiftUI spacing, onboarding, paywalls, checkout, settings, compact sheets, tab bars, scroll views, Dynamic Type-sensitive layouts, and similar responsive UI work, run the phone-size matrix before saying the work is done.

Agents may use Baguette's `http://localhost:8421/farm` page to observe several booted simulators or focus one device for input. See `docs/baguette-farm.md` for the full boundary. That is observation only. Any critique, fix, or verification claim still needs Screenslop capture, findings, and fresh-bundle verify artifacts.

## Sibling tool compatibility

Screenslop should play nicely with the other agent tools, but it should not become a launcher for all of them. Keep the boundary boring:

- Pixeltamer generates and edits images. It can help with banners, README assets, or mockups, but it does not prove a rendered Apple app screen is fixed.
- Pixelslop is the browser/web visual QA sibling. Screenslop is the Apple runtime sibling. Both inspect real rendered output instead of guessing from source.
- Stitch Kit helps agents design and convert UI, including SwiftUI ideas. Screenslop verifies the real Apple UI after it runs.
- Slopbuster cleans prose, comments, docs, and commit text. It is useful for final polish, not runtime UI proof.
- Claude Code Skill Activator can index the Screenslop skill after install. It should help discovery, not replace the capture -> critique -> fix -> fresh capture -> verify loop.

## CLI commands agents should rely on

```bash
screenslop doctor
screenslop see --json --surface <name>
screenslop critique <baseline-evidence-dir> --json
screenslop fix <baseline-evidence-dir> --finding <id> --source-root <app-root> --json
screenslop see --json --surface <name>
screenslop critique <fresh-evidence-dir> --json
screenslop verify <baseline-evidence-dir> --fresh-bundle <fresh-evidence-dir> --finding <id> --json
screenslop matrix --dry-run --json
```

The `--json` forms should be implemented early. Human output can be friendly; agent output needs strict contracts.

## Fixture-backed e2e smoke

Agents can check the command contract without a simulator by running:

```bash
npm run --silent smoke:e2e -- --fresh-mode fixed
```

This smoke exercises the internal fixture loop:

```text
fixture bundle -> critique -> fix temp SwiftUI source -> fresh fixture bundle -> critique -> verify
```

Treat that as contract proof only. It shows that Screenslop writes and consumes the right artifacts. It does not replace runtime capture for real Apple UI review. For real app work, agents still need `screenslop see` before critique and fresh `screenslop see` before claiming a fix is verified.

## Real-runtime MVP smoke

Agents can run the live sample-app loop when Apple runtime tools are available:

```bash
npm run smoke:runtime
```

The smoke uses XcodeBuildMCP to build and launch `examples/runtime-smoke-app`, then uses Baguette-backed `screenslop see` for both baseline and fresh evidence. It proves the public engine loop against one deterministic sample app issue. It does not prove private or user app screens are fixed. For those, capture the actual app surface and verify against a fresh recapture from that app.

The script prints one JSON report. Agents should treat any nonzero exit as a hard stop, not as permission to fall back to fixture proof.

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

## Design profile integration boundary

Design Intelligence is a planned extension for coding agents. The reliable shipped loop is still capture -> critique -> fix -> fresh capture -> fresh critique -> verify.

When Design Intelligence ships, agents should run the profile freshness check before making design claims. If the profile is stale, they should request or run a refresh preview, inspect the delta, and only write `.screenslop/design-profile.json` after explicit approval. The profile stays private by default and should not be committed.

The agent packet is the intended bridge for subjective review. Screenslop will package the screenshot path, accessibility summary, deterministic findings, matrix cell metadata, project profile, review questions, and output schema. Agents can then return `design`, `product-logic`, or `profile-gap` findings without pretending they are measured defects.

Do not merge subjective judgment into `verified-fixed`. Design findings need their own proof label and may require human review.
