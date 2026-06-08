# Screenslop Plan: GitHub Actions Node 24 Compatibility

Date: 2026-06-08
Status: ready for execution
Scope: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, optional docs note only if behavior changes

## Requirements Summary

Update the GitHub Actions workflows so Screenslop is ready for GitHub's Node 24 JavaScript action runtime change.

Current repo facts:

- `ci.yml` uses `actions/checkout@v4`, `actions/setup-node@v4`, and `node-version: 20` at lines 15-18.
- `release.yml` uses `actions/checkout@v4`, `actions/setup-node@v4`, and `node-version: 20` at lines 15-18.
- `package.json` declares `engines.node: >=20` at lines 75-76.
- There is no committed npm lockfile, so the current workflows correctly use `npm install`, not `npm ci`.
- The last successful release run still emitted GitHub's Node 20 JavaScript action runtime warning, even though CI and Release passed.

External guidance to verify during execution:

- GitHub Actions warning from the latest run says GitHub will force JavaScript actions to Node 24 by default on 2026-06-16 and remove Node 20 action runtime support on 2026-09-16.
- Official action release pages should be checked before editing, then use the current Node 24-compatible major versions of `actions/checkout` and `actions/setup-node`.

## RALPLAN-DR Summary

### Principles

1. Keep the public package runtime floor honest: CI may use Node 24, but `package.json` should stay `>=20` unless Node 20 support is intentionally dropped.
2. Fix the warning at the source by upgrading first-party actions instead of muting it with an insecure opt-out.
3. Keep release confidence high: Release should run the same test and pack gates that proved `v0.1.0` safe.
4. Do not widen scope into npm publishing, package version bumps, or runtime-driver work.

### Decision Drivers

1. GitHub's JavaScript action runtime change is date-bound and will affect workflows even if package code still supports Node 20.
2. Screenslop's npm package currently promises Node `>=20`; CI should continue proving that floor unless we intentionally change the contract.
3. The workflows are small, so the safest fix is a narrow workflow-only patch with remote CI evidence.

### Viable Options

#### Option A: Upgrade actions and test Node 20 + Node 24 in CI (favored)

Approach:

- Update `actions/checkout` and `actions/setup-node` to their current Node 24-compatible major versions.
- Change `ci.yml` to a Node matrix with `20` and `24`.
- Run full CI gates on Node 24.
- Run at least package-floor gates on Node 20.
- Update `release.yml` to Node 24 only.

Pros:

- Removes the Node 20 action-runtime warning.
- Proves package code still works on the declared Node floor.
- Keeps release on the future default runtime.

Cons:

- CI runs a little longer.
- Needs careful YAML shaping so matrix duplication does not make logs noisy.

#### Option B: Upgrade actions and switch all workflows to Node 24 only

Approach:

- Update action versions and set `node-version: 24` in CI and Release.

Pros:

- Smallest workflow diff.
- Fastest CI.

Cons:

- Stops proving the `>=20` package contract.
- Creates drift between `package.json` and CI coverage.

#### Rejected Option C: Keep v4 actions and set an opt-out flag

Approach:

- Use `ACTIONS_ALLOW_USE_UNSECURE_NODE_VERSION=true` or similar compatibility escape hatches.

Why rejected:

- It delays the problem instead of fixing it.
- It normalizes insecure/deprecated action runtime behavior in a fresh public repo release.

## Implementation Steps

1. Verify the current first-party action majors.

   - Check official `actions/checkout` and `actions/setup-node` release pages before editing.
   - Use the newest stable major that advertises Node 24 runtime support.
   - Do not guess if the latest major changes unexpectedly; stop and inspect the release notes.

2. Patch `.github/workflows/ci.yml`.

   Recommended shape:

   ```yaml
   strategy:
     fail-fast: false
     matrix:
       node-version: [20, 24]
   steps:
     - uses: actions/checkout@<node24-compatible-major>
     - uses: actions/setup-node@<node24-compatible-major>
       with:
         node-version: ${{ matrix.node-version }}
   ```

   Keep the existing gates:

   - `npm install`
   - `node --check bin/screenslop.mjs`
   - `find src tests scripts -name '*.mjs' -print0 | xargs -0 -n1 node --check`
   - `npm test`
   - `npm run --silent smoke:e2e -- --fresh-mode fixed`
   - `node bin/screenslop.mjs matrix --dry-run --json`
   - `node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json`
   - `npm pack --dry-run`

3. Patch `.github/workflows/release.yml`.

   - Upgrade `actions/checkout` and `actions/setup-node` to the same Node 24-compatible majors.
   - Set `node-version: 24` for release.
   - Keep release gates exactly as-is unless a real compatibility issue appears:
     - `npm install`
     - `npm test`
     - `npm pack --dry-run`
     - `gh release create ...`

4. Decide whether to add `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`.

   Preferred:

   - Add it only if official GitHub guidance still recommends it for pre-cutover validation after upgrading the actions.
   - If the upgraded action versions already run cleanly without the warning, skip the env var to avoid a temporary knob living forever.

5. Do not change `package.json` unless tests prove Node 20 is no longer supported.

   - `engines.node: >=20` remains correct if Node 20 matrix passes.
   - If Node 20 fails for a real code reason, stop and replan: that becomes a package support-policy change, not a workflow cleanup.

6. Run local checks before commit.

   Required local commands:

   ```bash
   npm run cleanup:macos:dry
   node bin/screenslop.mjs doctor
   npm test
   npm run --silent smoke:e2e -- --fresh-mode fixed
   npm pack --dry-run
   ```

   Optional but useful:

   ```bash
   node --check bin/screenslop.mjs
   find src tests scripts -name '*.mjs' -print0 | xargs -0 -n1 node --check
   node bin/screenslop.mjs matrix --dry-run --json
   node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
   ```

7. Commit and push.

   Suggested commit:

   ```text
   ci: update actions for Node 24 runtime
   ```

   Commit body should include Tested trailers for the commands above.

8. Verify remote workflows.

   - Push to `main` and watch the CI run.
   - Confirm the new run passes on all configured Node versions.
   - Confirm the previous Node 20 action-runtime warning is gone, or explain if GitHub still annotates a first-party action while compatibility is otherwise proven.
   - Do not create a new release tag for this workflow-only cleanup unless the user explicitly asks.

## Acceptance Criteria

- `ci.yml` no longer uses `actions/checkout@v4` or `actions/setup-node@v4`.
- `release.yml` no longer uses `actions/checkout@v4` or `actions/setup-node@v4`.
- CI runs with Node 24.
- CI still proves Node 20 package compatibility, unless a deliberate support-policy change is approved.
- Release workflow uses Node 24.
- Local gates pass:
  - `node bin/screenslop.mjs doctor`
  - `npm test`
  - `npm pack --dry-run`
- Remote GitHub CI passes after push.
- The GitHub Actions Node 20 runtime warning is gone from the new CI run, or a note documents exactly why it remains.
- No source/runtime/package release behavior changes are made.
- No npm package version bump and no release tag are created for this cleanup by default.

## Risks and Mitigations

- Risk: Upgrading action majors changes default behavior.
  - Mitigation: Read release notes before editing, keep workflow inputs minimal, and verify remote CI.

- Risk: Node 24 passes but Node 20 fails.
  - Mitigation: Treat this as a package-support decision. Do not silently change `engines.node` in the same task.

- Risk: A temporary env var becomes stale.
  - Mitigation: Prefer action upgrades over `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`; only add the env var if it gives concrete validation value.

- Risk: Release workflow fails because `gh release create` sees an existing tag/release during tests.
  - Mitigation: Do not trigger Release during this task unless intentionally testing a tag. CI on `main` is enough for the workflow cleanup.

## Verification Steps

Local:

```bash
npm run cleanup:macos:dry
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
npm pack --dry-run
```

Remote:

```bash
git push origin main
gh run list --workflow CI --limit 5
gh run watch <new-ci-run-id> --exit-status
gh run view <new-ci-run-id> --log | grep -i "Node.js 20\|deprecated\|warning" || true
```

If a Release workflow test is explicitly requested later:

```bash
git tag -a v0.1.1 -m "v0.1.1"
git push origin v0.1.1
gh run list --workflow Release --limit 5
gh run watch <release-run-id> --exit-status
```

Do not create that tag during this cleanup unless the user asks for a release.

## ADR

### Decision

Use Node 24-compatible first-party GitHub Actions and run Screenslop CI against Node 24 while keeping Node 20 compatibility coverage.

### Drivers

- GitHub Actions JavaScript runtime is moving from Node 20 to Node 24.
- Screenslop's package contract still says Node `>=20`.
- The previous release was successful but still produced a future-break warning.

### Alternatives considered

- Node 24 only everywhere: simpler, but stops proving the package floor.
- Deprecated runtime opt-out: rejected because it delays the failure.
- Package engine bump to `>=24`: rejected unless Node 20 actually breaks.

### Why chosen

It fixes the CI platform warning without changing what Screenslop claims to support for npm users.

### Consequences

- CI may run longer because of the Node matrix.
- Release uses the future default runtime and remains a clean package gate.
- Any real Node 20 break becomes visible instead of silently shipping.

### Follow-ups

- Revisit `engines.node` only when Screenslop intentionally adopts Node 24-only APIs or dependencies.
- After GitHub's Node 24 cutover, remove any temporary compatibility env var if one was added.
- Consider adding a tiny workflow note in `docs/release-checklist.md` only if release operators need new instructions.

## Follow-up Staffing Guidance

This is a narrow CI cleanup. Use a single executor lane.

Recommended execution:

```bash
$oh-my-codex:ralph Execute .omx/plans/screenslop-node-24-actions-compat-2026-06-08.md
```

For larger parallel follow-up, Team is not necessary here, but if used:

```bash
$oh-my-codex:team Execute .omx/plans/screenslop-node-24-actions-compat-2026-06-08.md with executor + verifier lanes
```

Team verification path:

- Executor patches workflows.
- Verifier confirms local gates and remote CI evidence.
- Ultragoal, if used, checkpoints the CI run IDs, warning status, commit hash, and final clean tree.

Goal-mode suggestion:

- `$ultragoal` is overkill for this small task unless you want durable ledger state.
- `$ralph` is the practical single-owner path here because the plan is short and verification is remote-CI-bound.
