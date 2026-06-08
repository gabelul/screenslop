Execute .omx/plans/screenslop-agent-playbook-real-app-dogfood-2026-06-08.md as an engine-only Screenslop goal. Keep Studio blocked. Use these durable stories only:

1. Ship and package the agent playbook for Codex, Claude Code, Cursor/generic agents, and terminal workflows. Update README/package docs map as needed.
2. Polish the Screenslop skill/reference docs so agents know the runtime-first contract, fresh-bundle verify rule, and private dogfood gate without overclaiming fallback capture.
3. Add/validate the dogfood redaction checker, contract tests, and package-smoke coverage.
4. Run private real-app dogfood preflight/full smoke if .screenslop/config.json exists; otherwise record recorded-blocker with redacted preflight evidence and keep Studio blocked.
5. Run final verification, review, commit, push, and checkpoint durable evidence.

Acceptance criteria are the acceptance criteria from .omx/plans/screenslop-agent-playbook-real-app-dogfood-2026-06-08.md. Do not add Studio files, do not commit private config/artifacts, and do not cut a release tag.
