# Known Limitations

Screenslop v0.1 is an engine/CLI MVP, not Screenslop Studio.

## Runtime

- Baguette is the preferred capture path. XcodeBuildMCP is used for build/run in the real-runtime and matrix paths.
- `screenslop see` has no full fallback capture path when Baguette is unavailable.
- Matrix records requested appearance and Dynamic Type metadata, but those settings are not yet forced at runtime.
- Screenslop does not start or open Baguette farm automatically. Run `baguette serve` yourself and open `http://localhost:8421/farm` when you want the upstream operator dashboard.

## Fixing

- Auto-fixes are limited to safe SwiftUI accessibility labels, generic labels, and touch-target patches with strong source matches.
- `fix-session.json` is context, not proof. Only fresh capture plus fresh critique can support a verified-fix claim.

## Config

- `.screenslop/config.json` uses `schemaVersion: 1` as the v0.1 generation. It is a 0.x contract, so future 0.x releases may change it with an explicit migration path.
- `sourceRoot` and `artifactsDir` must stay inside the project root for this version.

## Product boundary

- The public repo owns engine, CLI, schemas, runtime, docs, and agent integration.
- Screenslop Studio is private and should wrap this engine instead of duplicating it.
- Studio work is blocked until the engine passes the documented readiness gates: contract tests, package smoke, sample runtime smoke, matrix setting status, configured-target preflight, private dogfood `verified-fixed` proof, redaction proof, and agent contract drift checks.
- The private dogfood gate outcome is `recorded-blocker` in this checkout because no private `.screenslop/config.json` is present. The preflight failure is redacted and parseable, but it is not a substitute for a real app capture, fix, fresh capture, fresh critique, and `verified-fixed` result.
- This repo should not grow `apps/mac/`, private wrapper scaffolding, or duplicate runtime/critique/fix logic while those gates are still open.

## Design Intelligence is partially shipped

The repository now ships `screenslop learn` for private design-profile plan/write/check/refresh and `critique --design` plumbing for profile gaps, agent packets, and imported design findings. It does not yet run a built-in visual-design scorer or hosted LLM review.

The private design profile path is `.screenslop/design-profile.json`. It is ignored by default because project tone, product semantics, source paths, and copied design rules can be private. A stale or missing profile should block design claims, not deterministic measured critique.

Design findings are not automatic `verified-fixed` proof. They need fresh evidence, a fresh design pass, and a proof label such as `profile-informed` or `agent-judgment`.
