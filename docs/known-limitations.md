# Known Limitations

Screenslop v0.1 is an engine/CLI MVP, not Screenslop Studio.

## Runtime

- Baguette is the preferred capture path. XcodeBuildMCP is used for build/run in the real-runtime and matrix paths.
- `screenslop see` has no full fallback capture path when Baguette is unavailable.
- Matrix records requested appearance and Dynamic Type metadata, but those settings are not yet forced at runtime.

## Fixing

- Auto-fixes are limited to safe SwiftUI accessibility labels, generic labels, and touch-target patches with strong source matches.
- `fix-session.json` is context, not proof. Only fresh capture plus fresh critique can support a verified-fix claim.

## Config

- `.screenslop/config.json` uses `schemaVersion: 1`, but the schema remains provisional until the v0.1 release boundary is frozen.
- `sourceRoot` and `artifactsDir` must stay inside the project root for this version.

## Product boundary

- The public repo owns engine, CLI, schemas, runtime, docs, and agent integration.
- Screenslop Studio is private and should wrap this engine instead of duplicating it.
