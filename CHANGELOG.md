# Changelog

## [0.1.3](https://github.com/gabelul/screenslop/compare/v0.1.2...v0.1.3) (2026-06-12)


### Features

* add configured runtime smoke target ([0e55d72](https://github.com/gabelul/screenslop/commit/0e55d72f27edc85eccd6bef8cd2bb11aca97eb81))
* add configured target preflight ([16615c6](https://github.com/gabelul/screenslop/commit/16615c670d71417ef3f09ff59d24c620045c8740))
* add evidence-backed critique MVP ([2abee90](https://github.com/gabelul/screenslop/commit/2abee9019d0e2e83dbf5b674d5770b2849d54cfd))
* add matrix MVP report ([29b5498](https://github.com/gabelul/screenslop/commit/29b5498e24403ec2cfe00d632d169481d48c4c5b))
* add project config schema ([0561a99](https://github.com/gabelul/screenslop/commit/0561a994c523442ac0df0f61fc08df6541011a94))
* add Screenslop agent instructions ([4c7c750](https://github.com/gabelul/screenslop/commit/4c7c7509274637eae2302a97a0010dd02a852363))
* add Screenslop first-use setup ([9b22971](https://github.com/gabelul/screenslop/commit/9b229715534b507060ad960b016f0895d1d7e001))
* add screenslop fix MVP ([4615a56](https://github.com/gabelul/screenslop/commit/4615a567eca01762c31e04911d8c29f8cf0196ae))
* add screenslop verify MVP ([d0ac858](https://github.com/gabelul/screenslop/commit/d0ac858f3c490d9681742ae058dac53749a01e67))
* report matrix setting status ([c23cb7c](https://github.com/gabelul/screenslop/commit/c23cb7ce679437ece38627e922e8674974bc66bb))


### Bug Fixes

* catch mixed placeholder path leaks ([5b3dcf2](https://github.com/gabelul/screenslop/commit/5b3dcf22c6c9e9fe0ef752384036f1af1e98a916))
* close dogfood redaction review gaps ([fa680a8](https://github.com/gabelul/screenslop/commit/fa680a846ea1ffa855936ebecd05b83010bb8dcf))
* close v0 release boundary seams ([caa9f04](https://github.com/gabelul/screenslop/commit/caa9f04699d6096fc2ea299ccf8e5a1e298d71fd))
* keep npm CLI binary in package ([fef0e49](https://github.com/gabelul/screenslop/commit/fef0e4973d76dd088b9ca9348c68ffb00b0e9341))
* make dogfood checker ci-safe ([1b01f3d](https://github.com/gabelul/screenslop/commit/1b01f3de8cbe2621c78acd5dba44f2e4accb0898))
* redact dogfood checker read errors ([c40a4dd](https://github.com/gabelul/screenslop/commit/c40a4dd24efe012de82b175b9d71e7a0123de224))
* redact dogfood checker report path ([684923f](https://github.com/gabelul/screenslop/commit/684923f9c7c2c5751a91b8ddd2c84781786d2b8d))
* ship working v0 package smokes ([1b827c6](https://github.com/gabelul/screenslop/commit/1b827c689f486998a468b71c312673c559e4d8e0))
* use portable shell runner ([317e2e4](https://github.com/gabelul/screenslop/commit/317e2e4fdbf90efab67128a85dca2cbcfebba95c))

## [0.1.2](https://github.com/gabelul/screenslop/compare/v0.1.1...v0.1.2) (2026-06-12)


### Bug Fixes

* keep npm CLI binary in package ([a84d099](https://github.com/gabelul/screenslop/commit/a84d099ac2194f2d48a384cad53442cdfcea321f))

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
