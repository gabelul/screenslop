Execute .omx/plans/screenslop-design-intelligence-module-2026-06-14.md as a durable Screenslop engine implementation.

Keep these constraints:
- Keep deterministic critique/proof intact and default.
- Add Design Intelligence as a separate module under src/design/.
- Do not bake BoardingReady-specific rules into the public engine.
- Do not require a hosted LLM for the basic CLI.
- Do not auto-edit subjective design findings in the first implementation.
- Do not call subjective design findings verified-fixed unless they have deterministic measurable proof.
- Keep private .screenslop/design-profile.json uncommitted by default.
- Update CLI docs, README, skill, agent instructions, schemas, tests, and package whitelist.
- Run required verification, commit, and push each completed slice.

Implement in these stories:

1. Contracts and docs foundation: design-profile/design-review schemas, finding optional fields, design intelligence docs, examples, command/skill docs, package whitelist, contract tests.
2. Learn/check/refresh MVP: src/design profile schema, project context collector, learn/refresh implementation, screenslop learn CLI, tests for dry-run/write/check/stale/refresh/safety.
3. Design review MVP: load profile, summarize evidence, agent packet, local design rules, design critique flags/imports, tests for design findings, missing profile, agent packet, imported findings.
4. Matrix design integration: thread --design through matrix, per-cell design summaries, matrix-level consistency checks, schema/tests/docs/skill updates.
5. Verify semantics for design findings: improved/unchanged/regressed/needs-human-review statuses, deterministic verified-fixed boundary, before/after design report tests.
6. Final hardening and dogfood boundary: local gates, package smoke, ai-slop/docs polish, independent review, redacted BoardingReady dogfood plan or blocker note if private runtime cannot be safely run.
