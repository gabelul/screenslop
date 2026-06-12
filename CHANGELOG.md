# Changelog

## [0.1.1](https://github.com/gabelul/screenslop/compare/v0.1.0...v0.1.1) (2026-06-12)


### Features

* add configured target preflight ([3c4b1e9](https://github.com/gabelul/screenslop/commit/3c4b1e95e2b7a2299864743e9b580cbe7699407a))
* add Screenslop agent instructions ([65af716](https://github.com/gabelul/screenslop/commit/65af716bfc168b9a148aed7f3d77ba9b13096b7f))
* add Screenslop first-use setup ([3d0799f](https://github.com/gabelul/screenslop/commit/3d0799f9e08a303caa2f2af42334ba05814f4d15))
* report matrix setting status ([ac58e88](https://github.com/gabelul/screenslop/commit/ac58e88507eb46219b9f693e74cf81f0c4ad6ea2))


### Bug Fixes

* catch mixed placeholder path leaks ([42f5bbe](https://github.com/gabelul/screenslop/commit/42f5bbe6e0a58f9ee60f20e4fa84a784fc2e6cba))
* close dogfood redaction review gaps ([ad34de0](https://github.com/gabelul/screenslop/commit/ad34de0a5c25fc351018b8382de0a0b1045afaec))
* make dogfood checker ci-safe ([49eff17](https://github.com/gabelul/screenslop/commit/49eff170a45d273a8747ea412081854208065e72))
* redact dogfood checker read errors ([9617c75](https://github.com/gabelul/screenslop/commit/9617c75e7229df5ff6275ac82cb5186d56762786))
* redact dogfood checker report path ([d405086](https://github.com/gabelul/screenslop/commit/d40508643df782817f26d9c578dd48a72c2ed5ea))

## v0.1.0 - 2026-06-08

First public engine release.

### Shipped

- CLI entrypoint with `init`, `doctor`, `see`, `critique`, `fix`, `verify`, and `matrix`.
- Project config schema `schemaVersion: 1` with safe migration and path containment rules.
- Baguette-backed evidence capture for simulator screenshot, accessibility tree, and logs.
- Deterministic critique findings for accessibility, layout, logs, and evidence quality.
- Conservative SwiftUI fix planning and selected safe auto-fixes.
- Fresh-evidence verification that compares baseline findings against a new critique.
- Six-cell matrix MVP with per-cell evidence bundles and explicit unavailable states.
- Real-runtime sample app smoke using XcodeBuildMCP + Baguette.
- Agent docs and Screenslop skill scaffold for Codex/Claude/Cursor-style workflows.
- Package boundary with private state, local config, research folders, `.omx`, and generated artifacts excluded.

### Known limits

- `screenslop see` still needs Baguette for the real capture path.
- Matrix records requested appearance and Dynamic Type metadata, but does not force every setting at runtime yet.
- Auto-fixes stay narrow by design. If Screenslop is unsure, it writes a plan instead of playing code roulette.
