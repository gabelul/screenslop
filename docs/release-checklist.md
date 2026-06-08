# Release Checklist

Run these before a v0.1 tag:

```bash
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
npm run smoke:runtime
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
npm run cleanup:macos:dry
npm pack --dry-run
```

Check these by hand:

- `README.md`, `docs/commands.md`, `docs/architecture.md`, and `skills/screenslop/SKILL.md` describe the same command behavior.
- `schemas/` and `examples/json/` match current JSON output shape.
- No private `.screenslop/config.json` or user-app path is committed.
- `docs/repo-strategy.md` keeps Studio as a wrapper, not a second engine.
- Config policy is explicit: `schemaVersion: 1` is the v0.1 generation, and 0.x releases may change it with migration.
- Confirm `npm pack --dry-run` excludes `.omx/`, local artifacts, private config, and private example-app agent files. Tests and smoke scripts are intentionally shipped so package scripts do not lie.
