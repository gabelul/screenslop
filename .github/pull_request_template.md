## What this PR does

<!-- One sentence. Be specific. -->

## Evidence

<!-- Commands run, screenshots, runtime bundles, or reason runtime proof was not possible. -->

## Checklist

- [ ] I ran `npm test`
- [ ] I ran `node bin/screenslop.mjs doctor` when runtime behavior changed
- [ ] I ran `npm run --silent smoke:e2e -- --fresh-mode fixed` when the fix/verify loop changed
- [ ] I ran `npm run smoke:runtime` or explained why runtime proof was not available
- [ ] No private `.screenslop/config.json`, app paths, screenshots, or generated artifacts are committed
- [ ] Docs and schemas match the changed command behavior
