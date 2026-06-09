# Screenslop Agent Contract

Agents use Screenslop through the CLI. The caller can be Codex, Claude Code, Cursor, or a terminal script; the evidence contract is the same.

## Required loop

```bash
screenslop setup --json --dry-run
screenslop doctor
screenslop see --surface <surface> --json
screenslop critique artifacts/<baseline-run> --json
screenslop fix artifacts/<baseline-run> --finding <id> --source-root <app-root> --apply --yes --label "<label>" --json
screenslop see --surface <surface> --json
screenslop critique artifacts/<fresh-run> --json
screenslop verify artifacts/<baseline-run> --fresh-bundle artifacts/<fresh-run> --finding <id> --fix-session artifacts/<baseline-run>/fix-session.json --json
```

`verify` compares against a fresh bundle. It does not capture one.

`setup` is configuration only. If it returns `status: "ready"`, ask before writing with `screenslop setup --json --yes`.

## Stop rules

- Do not critique from source alone when runtime evidence can be captured.
- Do not claim non-Baguette `see` fallback is shipped in v0.1.
- Do not commit private config or dogfood artifacts.
- Do not call a private app fixed until fresh capture, fresh critique, and `verified-fixed` prove the selected finding is gone.
