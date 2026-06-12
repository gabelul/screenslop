# Release Checklist

Run these before merging a Release Please PR:

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

`docs/engine-contract.json` is the machine-readable gate and command contract.
If the CLI, skill, or checklist changes, update that file first and let the
contract tests catch the boring drift. Boring drift is still drift.

`status` is workflow state. `outcome` is proof state. A completed workflow story
can still have `outcome: "recorded-blocker"` when the honest result is “we
recorded why this cannot pass yet.”

Private dogfood gate:

```bash
node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --identifier <stable-accessibility-identifier> \
  --preflight-only

node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --identifier <stable-accessibility-identifier>
```

Before copying any private dogfood result into public docs, run the machine leak
check against the final JSON report:

```bash
node scripts/check-dogfood-redaction.mjs artifacts/<dogfood-report>.json \
  --forbid "$HOME" \
  --forbid "<private-source-root>" \
  --forbid "<private-bundle-id>"
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

If the private app `.screenslop/config.json` path is missing, incomplete, or unsafe, stop there.
Record the blocker as `recorded-blocker` and keep Screenslop Studio blocked. A
sample-app pass is not private dogfood proof, no matter how much we want the
annoying gate to be over.

Check these by hand:

- `README.md`, `docs/commands.md`, `docs/architecture.md`, and `skills/screenslop/SKILL.md` describe the same command behavior.
- `schemas/` and `examples/json/` match current JSON output shape.
- No private `.screenslop/config.json` or user-app path is committed.
- Private dogfood has either passed with a redacted report or is recorded as the
  reason Studio remains blocked.
- The release outcome is `recorded-blocker`, not `passed`, while private
  dogfood is missing.
- `docs/repo-strategy.md` keeps Studio as a wrapper, not a second engine.
- Config policy is explicit: `schemaVersion: 1` is the v0.1 generation, and 0.x releases may change it with migration.
- Confirm `npm pack --dry-run` excludes `.omx/`, local artifacts, private config, and private example-app agent files. `npm run --silent smoke:package` extracts the tarball and runs doctor, dry-run command JSON, selected package tests, and the fixture smoke from inside the package.
- Confirm GitHub issue templates, PR template, CI workflow, README, changelog, contribution notes, security notes, and `.github/assets/social-preview.png` match the release.

Release automation:

- `.github/workflows/release.yml` runs on pushes to `main`.
- Release Please opens a release PR using `release-please-config.json`
  and `.release-please-manifest.json`.
- Merging that release PR creates the GitHub release and tag.
- The same workflow publishes to npm with trusted publishing:
  `npm publish --provenance --access public`.
- Manual retry is available from GitHub Actions with `workflow_dispatch` and
  `publish: true` when the GitHub release exists but npm publish failed.

One-time npm setup:

1. Create or claim the `screenslop` package on npm.
2. Open `https://www.npmjs.com/package/screenslop/access`.
3. Add trusted publisher with:
   - owner: `gabelul`
   - repository: `screenslop`
   - workflow: `release.yml`
   - environment: `npm`

Upload `.github/assets/social-preview.png` manually in GitHub Settings if the preview needs refreshing.
