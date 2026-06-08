# Getting Started

Screenslop is easiest to understand as a loop:

```text
capture real UI -> critique evidence -> fix selected issue -> recapture -> verify
```

If you skip the recapture, you do not have a verified fix. You have a hopeful edit. Hope is lovely, but it is not a test.

## 1. Check the machine

```bash
node bin/screenslop.mjs doctor
```

The preferred stack is:

1. Baguette
2. XcodeBuildMCP
3. xcodebuild + simctl
4. manual evidence

Baguette is the best path for current iOS simulator evidence because it can capture the screenshot, AX tree, and logs from the live surface.

## 2. Create project config

Start with a dry run:

```bash
node bin/screenslop.mjs init --json --dry-run
```

Then create or migrate the local config when you are ready:

```bash
node bin/screenslop.mjs init \
  --workspace MyApp.xcworkspace \
  --scheme MyApp \
  --bundle-id com.example.MyApp \
  --source-root MyApp \
  --surface Settings \
  --device "iPhone 17" \
  --json \
  --yes
```

`.screenslop/config.json` is ignored by git because it can contain private paths and bundle IDs.

Before you run a private app, check the config shape without launching anything:

```bash
node scripts/smoke-real-runtime.mjs \
  --config .screenslop/config.json \
  --identifier settings.saveButton \
  --preflight-only
```

That prints JSON, validates the configured target fields, redacts private paths
and bundle IDs, and stops before Baguette, XcodeBuildMCP, build/run, capture, or
verify. If this fails, fix the config first. No need to wake the simulator just
to discover you misspelled a scheme. Not that any of us would ever do that.

## 3. Capture evidence

```bash
node bin/screenslop.mjs see --surface Settings --json
```

The command writes an evidence bundle under `artifacts/` or your configured `artifactsDir`.

## 4. Critique the bundle

```bash
node bin/screenslop.mjs critique artifacts/<run-id> --json
```

Findings must point back to evidence. If evidence is weak, the finding says so.

## 5. Fix one selected finding

```bash
node bin/screenslop.mjs fix artifacts/<run-id> \
  --finding <finding-id> \
  --source-root MyApp \
  --apply \
  --yes \
  --label "Save settings" \
  --json
```

The MVP only applies narrow, high-confidence SwiftUI patches. Ambiguous findings become manual plan items instead of surprise edits, which is exactly how it should be.

## 6. Recapture and verify

```bash
node bin/screenslop.mjs see --surface Settings --json
node bin/screenslop.mjs critique artifacts/<fresh-run-id> --json
node bin/screenslop.mjs verify artifacts/<baseline-run-id> \
  --fresh-bundle artifacts/<fresh-run-id> \
  --finding <finding-id> \
  --fix-session artifacts/<baseline-run-id>/fix-session.json \
  --json
```

`fix-session.json` is context. Fresh evidence is proof.

## Sample app smoke

For a self-contained live runtime check:

```bash
npm run smoke:runtime
```

This builds `examples/runtime-smoke-app`, captures baseline evidence, applies one safe fix, captures fresh evidence, and verifies the selected finding. It proves the Screenslop loop against the sample app, not against a private app you have not captured yet.
