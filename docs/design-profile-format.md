# Design Profile Format

A Screenslop design profile is the project-local memory for app-specific design review.

Default private path:

```text
.screenslop/design-profile.json
```

That file is ignored by default because it can contain product language, private source paths, and design rules copied from private work. If a project wants a public profile, export a redacted Markdown or JSON copy under `docs/` instead.

## Shape

The first version is `schemaVersion: 1` and is validated by `schemas/design-profile.schema.json`.

Core sections:

- `project`: app name, platform, category, audience, and tone.
- `sources`: scanned docs, SwiftUI files, token files, and evidence bundles with hashes.
- `tokens`: colors, typography, spacing, radii, materials, and icons.
- `components`: app-specific UI building blocks and expected traits.
- `screenTypes`: rules for onboarding, settings, paywalls, empty states, dashboards, and other flows.
- `stateSemantics`: product-state rules, such as when a badge can say active, locked, pending, or complete.
- `reviewRules`: app-aware rules that can produce design findings.
- `freshness`: source hash and current/stale status.

## Refresh contract

A future `screenslop learn --check` will compare profile source hashes with the current project. A future `screenslop learn --refresh` will update learned facts while preserving user-authored rules where possible.

Agents should treat a stale profile as a blocker for design claims. Run a refresh dry-run first, review the delta, then write only after explicit confirmation.
