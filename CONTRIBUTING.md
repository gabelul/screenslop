# Contributing

Screenslop is small on purpose right now. The best contributions are the ones that keep the evidence loop honest.

## Ground rules

- Do not critique Apple UI from source alone when runtime evidence can be captured.
- Keep Screenslop Studio out of this public repo. Studio wraps the engine; it does not fork it.
- Every finding needs evidence: screenshot region, AX node, log line, source hint, or an explicit weak-evidence note.
- No broad auto-fix behavior without strong source matching and tests.
- Do not commit local `.screenslop/config.json`, private app paths, generated artifacts, or research clones.

## Local checks

Run these before opening a PR:

```bash
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
npm run cleanup:macos:dry
npm pack --dry-run
```

If you changed runtime behavior and have the Apple tooling installed, also run:

```bash
npm run smoke:runtime
```

## Commit style

Use conventional commits:

```text
feat: add a new command or user-visible capability
fix: repair shipped behavior
chore: repo maintenance or release bookkeeping
docs: documentation-only change
test: test-only change
refactor: internal cleanup without behavior change
```

Keep the subject short and specific. Future us has enough problems without archaeology-by-commit-message.

## Good first issues

Good first issues usually live in these areas:

- more fixture coverage for finding matching
- docs gaps around agent workflows
- better error messages for config and runtime setup
- additional deterministic critique rules with evidence

Runtime-driver work is welcome, but it needs real proof. A happy-path stub is not enough.
