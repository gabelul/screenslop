# Security

Screenslop reads local app code, local runtime artifacts, accessibility trees, logs, screenshots, and project config. Treat that data like it can contain private product details, because it probably can.

## Report a security issue

Please do not open a public issue for security problems.

Email: security@booplex.com

If that address ever bounces, open a minimal GitHub issue that says you need a private security contact. Do not include exploit details in the issue.

## Project safety rules

- `.screenslop/config.json` is ignored because it can contain private paths and bundle IDs.
- `sourceRoot` and `artifactsDir` must stay inside the project root for v0.1.
- `sourceRoot` and `artifactsDir` must not overlap.
- `fix --apply` requires an explicit source root and explicit confirmation.
- JSON apply mode requires `--yes`; it never prompts.
- Screenslop should not install runtime dependencies without explicit user confirmation.

If a change weakens one of these rules, it needs a very good reason and tests.
