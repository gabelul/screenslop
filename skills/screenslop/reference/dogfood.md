# Private Dogfood

Private dogfood proves Screenslop on a real app. The sample runtime smoke is useful, but it is not this gate. Run these commands from the Screenslop checkout and pass an absolute private-app config path, or a path relative to the checkout.

## Preflight

```bash
node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --identifier <stable-accessibility-identifier> \
  --preflight-only
```

## Full run

```bash
node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --identifier <stable-accessibility-identifier>
```

## Pass condition

The final report must show `summary.status: "passed"`, `summary.verifyStatus: "verified-fixed"`, and `pathDisplayMode: "redacted"`.

Before committing any public lesson, run:

```bash
node scripts/check-dogfood-redaction.mjs artifacts/<dogfood-report>.json \
  --forbid "$HOME" \
  --forbid "<private-source-root>" \
  --forbid "<private-bundle-id>"
```

If private config is missing or unsafe, record `recorded-blocker` and keep Studio blocked.
