# Runtime Evidence

Screenslop trusts rendered evidence over source guesses.

## Preferred capture

Use Baguette when available:

```bash
baguette list --json
baguette screenshot --udid <UDID> --output artifacts/<run>/screenshot.jpg
baguette describe-ui --udid <UDID> --output artifacts/<run>/accessibility.json
baguette logs --udid <UDID> --style ndjson --bundle-id <bundle-id>
```

## Fallbacks

If Baguette is missing:

- use XcodeBuildMCP simulator tools when available (`xcodebuildmcp tools`, `xcodebuildmcp simulator ...`)
- otherwise use `xcrun simctl io <UDID> screenshot`
- ask for a screenshot only when runtime capture is blocked

## Source mapping

Prefer stable identifiers:

```swift
.accessibilityIdentifier("settings.closeButton")
```

The future helper is a debug-only `reviewID` modifier that records file and line without affecting release builds.
