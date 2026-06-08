---
name: screenslop
description: Use when the user wants to review, critique, fix, verify, or visually inspect Apple app UI from real runtime evidence. Screenslop runs or connects to the app, captures screenshots, accessibility trees, logs, and source hints, then produces evidence-backed findings and fixes. Prefer Baguette for iOS simulator runtime control, with fallbacks to XcodeBuildMCP, simctl, and manual screenshots.
argument-hint: "[init|doctor|see|critique|fix|matrix|verify|watch] [target]"
user-invocable: true
allowed-tools:
  - Bash(node *)
  - Bash(npx screenslop *)
  - Bash(screenslop *)
  - Bash(baguette *)
  - Bash(xcodebuildmcp *)
  - Bash(npx -y xcodebuildmcp@latest *)
  - Bash(xcrun simctl *)
  - Bash(xcodebuild *)
---

Screenslop is an evidence-first Apple UI review skill. Do not critique SwiftUI from source alone when a screenshot or accessibility tree can be captured.

## Runtime order

1. Baguette: preferred for iOS simulator screen, AX tree, logs, and input.
2. XcodeBuildMCP: use when available in the agent environment.
3. `xcrun simctl` / `xcodebuild`: fallback for screenshots and build/run.
4. Manual evidence: screenshot plus source paths from the user.

## Commands

- `init`: create or migrate `.screenslop/config.json` with target metadata.
- `doctor`: check runtime availability.
- `see`: capture screenshot, AX tree, logs, and source hints.
- `critique`: score evidence and produce findings.
- `fix`: patch selected safe findings; use `--source-root` or config before applying.
- `verify`: compare baseline findings with fresh capture plus fresh critique.
- `matrix`: write a bounded six-cell report with linked evidence bundles.
- `watch`: future live review loop; current CLI prints a placeholder.

## Review rule

Every finding needs evidence:

- screenshot region
- AX node
- log line
- source hint
- or an explicit note that evidence is missing

If Baguette is available, use it before guessing. The whole point is to see the thing instead of arguing with SwiftUI in the abstract.

## Standard checks

```bash
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
node bin/screenslop.mjs matrix --dry-run --json
```

Use `npm run smoke:runtime` when Apple simulator tools are available. It proves
the sample app loop only. User-app claims still need evidence from that app.
