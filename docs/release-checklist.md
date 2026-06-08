# Release Checklist

Run these before a v0.1 tag or release cut:

```bash
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
npm run smoke:runtime
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
npm run cleanup:macos:dry
npm pack --dry-run
npm run --silent smoke:package
```

Private dogfood gate:

```bash
node scripts/smoke-real-runtime.mjs \
  --config .screenslop/config.json \
  --identifier <stable-accessibility-identifier> \
  --preflight-only

node scripts/smoke-real-runtime.mjs \
  --config .screenslop/config.json \
  --identifier <stable-accessibility-identifier>
```

The second command must finish with these public-safe summary values:

- `summary.status: "passed"`
- `summary.captureStatus: "passed"`
- `summary.critiqueStatus: "passed"`
- `summary.fixStatus: "passed"`
- `summary.freshCaptureStatus: "passed"`
- `summary.freshCritiqueStatus: "passed"`
- `summary.verifyStageStatus: "passed"`
- `summary.verifyStatus: "verified-fixed"`
- `pathDisplayMode: "redacted"`

If `.screenslop/config.json` is missing, incomplete, or unsafe, stop there.
Record the blocker and keep Screenslop Studio blocked. A sample-app pass is not
private dogfood proof, no matter how much we want the annoying gate to be over.

Check these by hand:

- `README.md`, `docs/commands.md`, `docs/architecture.md`, and `skills/screenslop/SKILL.md` describe the same command behavior.
- `schemas/` and `examples/json/` match current JSON output shape.
- No private `.screenslop/config.json` or user-app path is committed.
- Private dogfood has either passed with a redacted report or is recorded as the
  reason Studio remains blocked.
- `docs/repo-strategy.md` keeps Studio as a wrapper, not a second engine.
- Config policy is explicit: `schemaVersion: 1` is the v0.1 generation, and 0.x releases may change it with migration.
- Confirm `npm pack --dry-run` excludes `.omx/`, local artifacts, private config, and private example-app agent files. `npm run --silent smoke:package` extracts the tarball and runs doctor, dry-run command JSON, selected package tests, and the fixture smoke from inside the package.
- Confirm GitHub issue templates, PR template, CI workflow, README, changelog, contribution notes, security notes, and `.github/assets/social-preview.png` match the release.

Tag the release after the tree is clean and pushed:

```bash
git tag -a v0.1.0 -m "v0.1.0"
git push origin v0.1.0
```

The tag workflow creates a GitHub release after `npm test` and `npm pack --dry-run` pass on GitHub Actions. Upload `.github/assets/social-preview.png` manually in GitHub Settings if the preview needs refreshing.
