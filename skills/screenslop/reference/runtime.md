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

## Baguette farm

When `baguette serve` is running, Baguette exposes a device farm at:

```text
http://localhost:8421/farm
```

Use it as a live operator view across booted simulators. It can help compare small, normal, and large phones, then focus a tile for streaming and input. It is not proof by itself. Screenslop proof still comes from `screenslop see`, `screenslop critique`, and fresh-bundle `screenslop verify`. For non-interactive phone-size proof, use `screenslop matrix --profile examples/matrix/phone-sizes.json --critique --json` instead of opening the farm.

If this skill is being used from the Screenslop repo or npm package, read `docs/baguette-farm.md` for the full boundary.

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
