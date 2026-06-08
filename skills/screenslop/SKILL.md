---
name: screenslop
description: Use when the user wants to review, critique, fix, verify, or visually inspect Apple app UI from real runtime evidence. Screenslop captures Baguette-backed simulator evidence, produces evidence-backed findings, applies narrow fixes, and verifies against fresh captures. XcodeBuildMCP is used for build/run support; non-Baguette capture fallback is future work.
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

1. Baguette: shipped capture path for iOS simulator screen, AX tree, logs, and input.
2. XcodeBuildMCP: shipped build/run support for smoke and matrix flows.
3. `xcrun simctl` / `xcodebuild`: planned lower-level fallback work.
4. Manual evidence: user-provided screenshot plus source paths when automation is not available.

## Commands

- `init`: create or migrate `.screenslop/config.json` with target metadata.
- `doctor`: check runtime availability.
- `see`: capture screenshot, AX tree, logs, and source hints through Baguette in v0.1.
- `critique`: score evidence and produce findings.
- `fix`: patch selected safe findings; use `--source-root` or config before applying.
- `matrix`: write a bounded six-cell report with linked evidence bundles.
- `verify`: compare baseline findings with a fresh bundle; it does not capture
  new evidence by itself.
- `watch`: future live review loop; current CLI prints a placeholder.

## Longer references

- See `docs/agent-playbook.md` for practical Codex, Claude Code, Cursor, and terminal workflows.
- See `skills/screenslop/reference/agent-contract.md` for the compact command contract.
- See `skills/screenslop/reference/dogfood.md` for the private real-app dogfood gate and redaction check.

## Review rule

Every finding needs evidence:

- screenshot region
- AX node
- log line
- source hint
- or an explicit note that evidence is missing

If Baguette is not available, stop and fix runtime setup or use manual evidence. Do not pretend `see` has a full automated fallback yet. The whole point is to see the thing instead of arguing with SwiftUI in the abstract.

## Standard checks

```bash
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
node bin/screenslop.mjs matrix --dry-run --json
npm run --silent smoke:package
```

Use `npm run smoke:runtime` when Apple simulator tools are available. It proves
the sample app loop only. User-app claims still need evidence from that app.

For private dogfood, check the target without launching first:

```bash
node scripts/smoke-real-runtime.mjs --config .screenslop/config.json --identifier <stable-id> --preflight-only
```

Only a full configured run with fresh capture, fresh critique, and
`verifyStatus: "verified-fixed"` proves a user-app fix. If the private config is
missing, record the outcome as `recorded-blocker` and keep Studio blocked. The
sample app is not a get-out-of-jail-free card, sadly.
