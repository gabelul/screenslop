Execute the approved Screenslop engine-proof plan at .omx/plans/screenslop-engine-proof-before-studio-2026-06-08.md as phase-level goals only.

Constraints:
- Work only in the public Screenslop engine/CLI/schema/runtime/test/docs/agent contract repo.
- Do not implement Screenslop Studio, apps/mac, private wrapper scaffolding, or duplicate engine logic.
- Commit and push every completed execution slice.
- Keep private .screenslop config, private paths, screenshots, bundle IDs, and dogfood artifacts untracked.
- Use runtime evidence before UI critique claims.
- Studio remains blocked until every engine readiness gate passes, especially the private dogfood verified-fixed and redaction gates.

Goals:
1. Boundary contract lock: make docs block Studio until engine gates pass, with no Studio placeholders.
2. Contract and package locks: golden JSON/schema tests, package whitelist checks, extracted package smoke.
3. Runtime smoke hardening: stable smoke summaries, failure-stage tests, source restoration, redacted JSON.
4. Matrix proof upgrades: six-cell preservation plus explicit applied/requested/unavailable setting status.
5. Configured-target preflight: private config validation, redacted parseable failures, public-safe checklist/docs.
6. Private dogfood confidence proof: real app capture -> critique -> fix -> fresh capture -> fresh critique -> verify with selectedFinding.source real-app, verifyStatus verified-fixed, and machine redaction pass; if unavailable/blocking, record blocker and keep Studio blocked.
7. Agent contract polish: align Screenslop skill/docs with actual CLI behavior and add contract-drift checks.
8. Release decision: run release checklist and tag only after green local plus CI evidence and explicit approval/need.

Required verification after implementation slices:
npm run cleanup:macos:dry
node --check bin/screenslop.mjs
find src tests scripts -name '*.mjs' -print0 | xargs -0 -n1 node --check
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:e2e -- --fresh-mode fixed
node bin/screenslop.mjs matrix --dry-run --json
node bin/screenslop.mjs matrix --profile examples/matrix/default.json --json
npm pack --dry-run

Before claiming engine proof complete, also run npm run smoke:runtime and private dogfood proof if a private target exists.
