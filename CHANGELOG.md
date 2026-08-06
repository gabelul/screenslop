# Changelog

## [0.2.0](https://github.com/gabelul/screenslop/compare/v0.1.10...v0.2.0) (2026-08-06)


### ⚠ BREAKING CHANGES

* `see` exits non-zero when capture stability cannot be proven, and records `capture.status: partial` rather than reporting a clean capture. `verify` returns `needs-human-review` instead of `verified-fixed` when the fresh capture was unstable, when the stability probe failed, or when the bundle predates stability checks entirely — so bundles captured with 0.1.10 or earlier no longer verify as fixed until recaptured. `matrix` exits non-zero when any cell failed or could not tie its capture to the simulator it built, and those cells are excluded from `summary.captured` while still being captured and critiqued. See docs/upgrading.md.

### Features

* flag evidence bundles captured while the screen was still moving ([5bf1547](https://github.com/gabelul/screenslop/commit/5bf1547d4c551c7d24340e2ecf5b649733097015))
* honor config defaultDevice when picking the capture simulator ([9d96987](https://github.com/gabelul/screenslop/commit/9d96987e8f098924b866fc73a3b509628a03b132))
* name the token behind a failing contrast finding ([7b99b0c](https://github.com/gabelul/screenslop/commit/7b99b0cb6939a41d5fb8e80a6838189ec505ed1b))


### Bug Fixes

* attribute derived token variants instead of calling them unknown drift ([68f1b85](https://github.com/gabelul/screenslop/commit/68f1b85d52fda15c70e8b37571791a6cb9619bb0))
* bound the caret exemption to a focused field and close the truncation hole ([4cc3a39](https://github.com/gabelul/screenslop/commit/4cc3a392d5fd89849466876b352d8354189095d5))
* capture at full JPEG quality and read PNG screenshots ([f0a14cf](https://github.com/gabelul/screenslop/commit/f0a14cfc05dc17842830667496543dfc6ebf883e))
* catch turning spinners, cluster motion independently, prove matrix targets ([92bc4c6](https://github.com/gabelul/screenslop/commit/92bc4c600d1213af3ad0b825430b1e7b4967b4d1))
* close the review findings on capture stability, attribution, and devices ([914326b](https://github.com/gabelul/screenslop/commit/914326b48a7b004cc4d70647f0f61efaeaf99dbf))
* close the second review round on proof gating, tiles, and blend ambiguity ([cc955b1](https://github.com/gabelul/screenslop/commit/cc955b13c3a23bf9e4bc7f2c461e610334cf441a))
* detect sparse motion, drop the neutral blend exemption, flag matrix identity ([72ca660](https://github.com/gabelul/screenslop/commit/72ca660285c7ce17433a156e3798ac1b8eeae1c8))
* disclose capture state in the design packet and pin the see.ok contract ([0556fe2](https://github.com/gabelul/screenslop/commit/0556fe230cd44ecc0659fab20a02e40236d1cc8c))
* fail closed on build envelopes and conflicting background references ([d4a7ec2](https://github.com/gabelul/screenslop/commit/d4a7ec27ba2ef6e7ecc706e663c89a020f9b7767))
* grade contrast confidence by threshold margin, not text size alone ([1a2b1dd](https://github.com/gabelul/screenslop/commit/1a2b1ddb35a949a1ae24987c7fcc686fa91a5b14))
* keep a runtime-less matrix run a scaffold, not a failed proof ([ee5c2d0](https://github.com/gabelul/screenslop/commit/ee5c2d0d4763070ef78b42b5d5d3d09040a8feda))
* keep critiquing captures that are unproven but not empty ([93d95d0](https://github.com/gabelul/screenslop/commit/93d95d0fdb02773dcc9d60e5e1c795b25c630593))
* make localized motion monotonic, catch slow rotation, exempt caret by field ([fbadf02](https://github.com/gabelul/screenslop/commit/fbadf02073673904c32287d1747ae79d4cf61940))
* propagate unproven captures to command success and test what the guards claim ([af75103](https://github.com/gabelul/screenslop/commit/af7510362f731147ee2f6c0fd11c76d6e060ed5b))
* stop --help from running the command it asks about ([033dd42](https://github.com/gabelul/screenslop/commit/033dd424396b0f89fc260b961b28e8ab85832305))


### Maintenance

* mark the capture-proof changes as breaking ([8b5476f](https://github.com/gabelul/screenslop/commit/8b5476f9603773f98e95c67476ce544353146616))

## [0.1.10](https://github.com/gabelul/screenslop/compare/v0.1.9...v0.1.10) (2026-07-31)


### Features

* add cross-run critique trend and wire the new detectors ([650b45a](https://github.com/gabelul/screenslop/commit/650b45aab58dae5fc46b3c373fac0e4c2e887172))
* add HIG pattern, spacing rhythm, and truncation-risk detectors ([eaef25e](https://github.com/gabelul/screenslop/commit/eaef25e4e8bb106bc177d96428002c15aa217883))
* add screenshot pixel sampling with contrast and color-balance detectors ([4361456](https://github.com/gabelul/screenslop/commit/4361456dfddd9be5615f43bf08b7ed09b1cfecaa))
* add semantic token layers with alias resolution to the design profile ([5ed64d5](https://github.com/gabelul/screenslop/commit/5ed64d5b521264a5ad8bf8446838fb47e807f138))
* add thumb-reach, destructive-adjacency, alignment, and working-memory design detectors ([5018c9c](https://github.com/gabelul/screenslop/commit/5018c9c0ddcb2bed0b20442f3b935917af066618))
* add token-drift findings and persona walkthroughs to design review ([040e58c](https://github.com/gabelul/screenslop/commit/040e58c41bbad896d07bf9c65067b511fbbab9ad))
* nudge critique users toward learn when no design profile exists ([972c9f5](https://github.com/gabelul/screenslop/commit/972c9f57243a436b34723e8462b7c68cff7e6ea0))


### Bug Fixes

* tune truncation margin and small-text contrast confidence from dogfood ([a4806fc](https://github.com/gabelul/screenslop/commit/a4806fc700000a7c028a01f503c8296a0410ad77))

## [0.1.9](https://github.com/gabelul/screenslop/compare/v0.1.8...v0.1.9) (2026-06-16)


### Bug Fixes

* suppress recurring AX frame false positives ([89bcceb](https://github.com/gabelul/screenslop/commit/89bcceb11b95ad8450093d9603b994e5548b042b))

## [0.1.8](https://github.com/gabelul/screenslop/compare/v0.1.7...v0.1.8) (2026-06-16)


### Bug Fixes

* drop stale material token noise on refresh ([f16be77](https://github.com/gabelul/screenslop/commit/f16be771e9f548a7fbb7a6cb52e0929a23fe9717))
* keep noisy learned tokens from hiding gaps ([0bf0b1b](https://github.com/gabelul/screenslop/commit/0bf0b1b45345024ca5eb65be3258462dfbe2f131))

## [0.1.7](https://github.com/gabelul/screenslop/compare/v0.1.6...v0.1.7) (2026-06-15)


### Features

* extract design tokens during learn ([58569f6](https://github.com/gabelul/screenslop/commit/58569f6f5c67863a7977cd3660f6a85c4b44427f))

## [0.1.6](https://github.com/gabelul/screenslop/compare/v0.1.5...v0.1.6) (2026-06-15)


### Bug Fixes

* report current freshness after learn write ([1636cba](https://github.com/gabelul/screenslop/commit/1636cbaebfd0bdca2e5d5e7ee9981fd10dfb664b))

## [0.1.5](https://github.com/gabelul/screenslop/compare/v0.1.4...v0.1.5) (2026-06-15)


### Features

* add explicit CLI self-update ([d57b647](https://github.com/gabelul/screenslop/commit/d57b647ed819b53fc0cce317a4c3a8a381cfbaca))

## [0.1.4](https://github.com/gabelul/screenslop/compare/v0.1.3...v0.1.4) (2026-06-14)


### Bug Fixes

* show CLI version in doctor ([0959fed](https://github.com/gabelul/screenslop/commit/0959fed23e5b576e2987b4deca5dc1311650f2fa))
* warn when Screenslop CLI is stale ([3cc380c](https://github.com/gabelul/screenslop/commit/3cc380c08eb98a00e98f152805ffd4ba12e6197c))

## [0.1.3](https://github.com/gabelul/screenslop/compare/v0.1.2...v0.1.3) (2026-06-14)


### Features

* add configured runtime smoke target ([6ffe3d8](https://github.com/gabelul/screenslop/commit/6ffe3d85305f538322361e4668ed626e0b42b14c))
* add configured target preflight ([a379a09](https://github.com/gabelul/screenslop/commit/a379a090379573f04164ab5e63903d7dfb45226c))
* add design intelligence module boundary ([cf9c776](https://github.com/gabelul/screenslop/commit/cf9c776306290e285977993ac2bb531449f1f7b1))
* add design profile learn command ([3ba4aab](https://github.com/gabelul/screenslop/commit/3ba4aabdfc89dad08006d56603a80c00e7f2af43))
* add design review packets ([6e20b79](https://github.com/gabelul/screenslop/commit/6e20b79850cd57749fccaa1181a45e00e00d0b93))
* add design verification statuses ([ec51401](https://github.com/gabelul/screenslop/commit/ec514013ec9af850f13c5c46808ba8b6f3695e5c))
* add evidence-backed critique MVP ([096ca7d](https://github.com/gabelul/screenslop/commit/096ca7d18cc85227fa42bcb3c1b956431a89db92))
* add matrix MVP report ([d545d47](https://github.com/gabelul/screenslop/commit/d545d47cf9d82fe80bd209caf674a5a8f6ecc14f))
* add project config schema ([a4551d0](https://github.com/gabelul/screenslop/commit/a4551d0227c7a467842892366df5f0213b90a107))
* add Screenslop agent instructions ([618a44d](https://github.com/gabelul/screenslop/commit/618a44d49453b968d0665ca2d4773e47984a1f7e))
* add Screenslop first-use setup ([591f67d](https://github.com/gabelul/screenslop/commit/591f67dd12f63804c91d41023c08736042297a68))
* add screenslop fix MVP ([ab7aebe](https://github.com/gabelul/screenslop/commit/ab7aebe7ab9112f68688716e50f9a3a255e8eb39))
* add screenslop verify MVP ([d4fdc4b](https://github.com/gabelul/screenslop/commit/d4fdc4b1490ca5474f2aa4e7c55996b13760af88))
* report matrix setting status ([ec1109e](https://github.com/gabelul/screenslop/commit/ec1109e270a10ae9826e8dbad5b734922c0c032f))
* thread design review through matrix ([173167a](https://github.com/gabelul/screenslop/commit/173167ae507a6f355ac307ad94ea9070a30b467e))


### Bug Fixes

* catch mixed placeholder path leaks ([26d730d](https://github.com/gabelul/screenslop/commit/26d730d79b7fbc8d2c2ec89074f37bae50308a88))
* close dogfood redaction review gaps ([72f0317](https://github.com/gabelul/screenslop/commit/72f0317578dc09397fdbea7145ddc7dca536ff4e))
* close v0 release boundary seams ([deac800](https://github.com/gabelul/screenslop/commit/deac800764205f6011b7d8ed1fd9d4840f8d3b12))
* harden design review boundaries ([9c6aa61](https://github.com/gabelul/screenslop/commit/9c6aa611e5136e159704e827df672c3c33f7f0c4))
* keep npm CLI binary in package ([ce0c736](https://github.com/gabelul/screenslop/commit/ce0c736fe4493f7e61f82c33cc46671b249751a9))
* make dogfood checker ci-safe ([5e19237](https://github.com/gabelul/screenslop/commit/5e19237a2261e630200e9aed55b1c37be195d600))
* redact dogfood checker read errors ([e5a064c](https://github.com/gabelul/screenslop/commit/e5a064caa1e9619fcdb684c4ac5e47e3a606f0a0))
* redact dogfood checker report path ([78e579a](https://github.com/gabelul/screenslop/commit/78e579a2a3e1d28e995ebc1bb473051d9928f26e))
* require design review provenance ([c280b1d](https://github.com/gabelul/screenslop/commit/c280b1d7274289db26c4fb7984df0b2a47979597))
* ship working v0 package smokes ([514b392](https://github.com/gabelul/screenslop/commit/514b392816cd247e53da6555cab455b79161fcc8))
* use portable shell runner ([d79931c](https://github.com/gabelul/screenslop/commit/d79931cdcff85c19265b9649d1d9f0d9ddad066e))

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
