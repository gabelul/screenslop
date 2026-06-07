# Architecture

Screenslop is a runtime-first design review tool for Apple apps.

The core rule: never critique from source alone when runtime evidence is available.

## Layers

### Runtime drivers

Runtime drivers know how to control the app surface.

```text
RuntimeDriver
  listDevices()
  boot(device)
  runApp(options)
  screenshot(outputPath)
  accessibilityTree(outputPath)
  logs(outputPath)
  tap(point)
  type(text)
  rotate(orientation)
```

Drivers are ordered by capability:

1. `BaguetteDriver`
2. `XcodeBuildMCPDriver`
3. `SimctlDriver`
4. `ManualDriver`

Baguette is preferred because it can stream the simulator, inspect the on-screen AX tree, dispatch input, and collect logs from the same runtime surface. XcodeBuildMCP is the next fallback because it is agent-native: it gives build, run, test, simulator, screenshot, and inspection workflows through an MCP server and CLI instead of forcing Screenslop to manually stitch every Xcode command together.

### Evidence collector

The collector writes one bundle per run:

```json
{
  "runId": "2026-06-07T11-30-00-settings",
  "surface": "Settings",
  "device": "iPhone 17 Pro",
  "appearance": "dark",
  "dynamicType": "accessibility3",
  "screenshot": "artifacts/.../screenshot.jpg",
  "accessibilityTree": "artifacts/.../accessibility.json",
  "logs": "artifacts/.../logs.ndjson",
  "sourceHints": ["SettingsView.swift"]
}
```

Evidence is the artifact. Reports are derived from it.

### Critique engine

The critique engine reads evidence plus project context and scores these pillars:

- hierarchy
- typography
- color and contrast
- layout and safe areas
- accessibility
- interaction states
- motion and feedback
- platform fit
- slop patterns
- performance risk

Each finding must point to evidence. If the evidence is weak, the finding says so.

### Source mapper

Runtime evidence becomes actionable when the app uses stable identifiers.

Recommended convention:

```swift
.accessibilityIdentifier("settings.closeButton")
```

Future helper:

```swift
.reviewID("SettingsView.closeButton", file: #fileID, line: #line)
```

The source mapper should use accessibility identifiers, visible labels, file grep, SwiftSyntax, and project naming conventions to suggest source locations.

### Fix loop

The fix loop is deliberately small:

1. Pick top findings.
2. Locate likely source.
3. Patch SwiftUI.
4. Build/run.
5. Capture fresh evidence.
6. Mark fixed, partial, or failed.

No heroic rewrite because a button is three points too low. Fix the thing that evidence proves.

## Mac app plan

A Mac app is useful as a shell, not as the first implementation.

Good Mac app features:

- live simulator stream
- evidence bundle browser
- side-by-side before/after screenshots
- AX tree inspector
- finding triage
- matrix progress view
- one-click rerun

The app should call the CLI/core APIs so agents and humans use the same engine.
