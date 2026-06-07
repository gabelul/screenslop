# Repo Strategy

Screenslop should be one repo until there is a strong reason to split it.

The product has two faces, but one engine:

```text
Screenslop Core   -> public evidence capture, runtime drivers, critique, fix, verify
Screenslop CLI    -> public scriptable utility and agent entrypoint
Screenslop Skill  -> public agent instructions around the same CLI/core
Screenslop Studio -> private Mac app wrapper around the same core
```

The engine is the source of truth. The CLI, agent integrations, and Mac app are clients.

## Why one repo

One repo keeps the annoying parts honest:

- one evidence schema
- one finding schema
- one runtime driver stack
- one critique rubric
- one fix loop
- one test suite
- one release history

Splitting early sounds tidy, but it usually creates drift. The CLI gets one behavior, the app gets another, and suddenly we are debugging two products that pretend to be one. No thanks.

## Proposed layout

```text
screenslop/
  packages/
    core/              # shared engine, no UI assumptions
    cli/               # command-line wrapper around core
    skill/             # agent skill files and references
  apps/
    studio-mac/        # future paid/polished Mac app
  schemas/             # evidence and finding contracts
  docs/                # architecture, roadmap, product notes
  examples/            # fixture apps and captured evidence
```

The current scaffold is flatter while the core is tiny. Once `see` and `critique` are real, move into this package layout.

## Runtime dependency policy

Screenslop should not bundle Baguette or XcodeBuildMCP by default.

It should detect them, explain what is missing, and offer install commands:

```bash
brew install baguette
brew tap getsentry/xcodebuildmcp && brew install xcodebuildmcp
# or
npm install -g xcodebuildmcp@latest
```

For the Mac app, use the same policy:

1. Run onboarding checks.
2. Detect Baguette, XcodeBuildMCP, Xcode, simctl.
3. Explain which features are available.
4. Ask before installing anything.
5. Keep fallback mode usable even if the user skips installs.

The app can feel polished without pretending it owns every dependency.

## Open source vs private app

The clean model:

- **Screenslop Core + CLI + agent integrations:** public/open source. This attracts builders, lets agents use it, and gives other people room to add drivers, rules, and integrations.
- **Screenslop Studio:** private commercial Mac app. This is the polished product: visual triage, device matrix, before/after diffs, AX inspector, onboarding, and guided fixes.

The Mac app should import or call the same public core. No separate critique logic. No duplicate schemas. No second runtime stack.

This gives the public project exposure and contribution surface without giving away the whole paid product.

## Repo split

Because the Mac app is private, the long-term shape should be two repos:

```text
screenslop          # public engine + CLI + agent integrations
screenslop-studio   # private Mac app consuming the public engine/CLI
```

For this early scaffold, it is still useful to keep `apps/mac/` as a placeholder so the engine API is designed with the app in mind. But real Mac app code should move to the private repo once it starts.

The split is fine as long as the private app never forks the logic. It consumes the public engine like any other client.
