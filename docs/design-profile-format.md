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
- `sources`: scanned docs, SwiftUI files, token files, configured design sources, and evidence bundles with hashes.
- `designSources`: the private read-only design-system paths configured for learning.
- `tokens`: extracted colors, typography, spacing, radii, materials, and icons.
- `components`: app-specific UI building blocks and expected traits.
- `screenTypes`: rules for onboarding, settings, paywalls, empty states, dashboards, and other flows.
- `stateSemantics`: product-state rules, such as when a badge can say active, locked, pending, or complete.
- `reviewRules`: app-aware rules that can produce design findings.
- `profileGaps`: missing design knowledge that agents should report honestly.
- `freshness`: source hash and current/stale status.

## Refresh contract

`screenslop learn --check` compares profile source hashes with the current project. `screenslop learn --refresh` updates learned facts while preserving user-authored rules where possible. The extractor reads Markdown token tables/pairs and common SwiftUI static constants such as `Color`, `Font`, spacing, radius, material, and SF Symbol definitions.

Agents should treat a stale profile as a blocker for design claims. Run a refresh dry-run first, review the delta, then write only after explicit confirmation.
