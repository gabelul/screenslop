# Changelog

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
