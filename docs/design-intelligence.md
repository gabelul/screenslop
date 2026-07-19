# Design Intelligence

Screenslop has two review layers.

1. Deterministic critique: measured findings from runtime evidence.
2. Design intelligence: app-aware recommendations from runtime evidence plus a project design profile.

The deterministic layer stays the default. It handles things like missing AX labels, weak evidence, touch targets, offscreen frames, and logs. Design intelligence is separate because hierarchy, typography, color, emotional fit, product-state logic, and slop patterns need project context.

## Current flow

```bash
screenslop learn --json --dry-run
screenslop learn --write --yes --json
screenslop learn --check --json
screenslop learn --refresh --json --dry-run
screenslop learn --refresh --write --yes --json
screenslop init --design-source ../SharedDesignSystem --json --dry-run

screenslop critique artifacts/<run> --design --json
screenslop critique artifacts/<run> --design-profile .screenslop/design-profile.json --json
screenslop critique artifacts/<run> --design --agent-packet --json
screenslop critique artifacts/<run> --import-design-findings design-findings.json --json
screenslop matrix --profile examples/matrix/phone-sizes.json --critique --design --agent-packet --json
```

`learn` scans repo-local design docs plus configured `designSources`, skips build/checkouts and localization/generated noise such as `L10n.swift`, then extracts lightweight colors, typography, spacing, corner radii, materials, and icons from Markdown token rows and common SwiftUI design-system patterns. Current Swift patterns include `DynamicTheme`, `Color(hex:)`, HSB colors, `Font.custom`, spacing/radius constants, materials, and SF Symbols. Token records include confidence/provenance fields. If trusted core buckets are still missing, it records `profileGaps` so agents say what is missing.

The shipped design critique path loads the private profile, can write a redacted agent packet, and can import agent-produced findings. In JSON mode, `--design` fails with `missing-design-profile` unless a usable profile exists or `--agent-packet`/`--import-design-findings` is handling the review handoff. It should never weaken the proof boundary. Design findings must say what kind of judgment they are:

- `measured`: deterministic, tool-measured proof.
- `design`: app-aware design recommendation.
- `product-logic`: visible state or copy contradiction.
- `profile-gap`: missing or stale profile context.

Design findings also carry a `proofLevel`:

- `measured`
- `runtime-informed`
- `profile-informed`

## Token drift

When a profile with parseable color tokens exists and the capture has real pixels, `critique --design` samples the screenshot's accent colors and compares them against the learned tokens:

- `design.token-drift`: the screen uses an accent the profile never learned (RGB distance > 60 from every token).
- `design.token-near-miss`: an accent sits close to a learned token but not on it — the classic hardcoded approximation of a token value.

Both are P3 design-lane findings with `proofLevel: profile-informed` and `requiresHumanReview`. Drift is measured against the learned profile, and the profile may itself be stale — the findings say so. They never claim `verified-fixed` semantics.

## Persona walkthroughs

The agent packet carries five persona lenses for the subjective pass: first-launch user, one-handed phone user, VoiceOver + accessibility Dynamic Type user, stress-content user, and muscle-memory user. Each persona ships 2-4 concrete questions about the captured screenshot and AX evidence, and every question routes the reviewer to `design`, `product-logic`, or `profile-gap` findings — measured claims stay with the deterministic detectors. The packet schema (`schemas/design-review.schema.json`) validates the persona shape.
- `agent-judgment`

Only measured findings can become `verified-fixed` automatically. Design findings can become `improved`, `unchanged`, `regressed`, or `needs-human-review` after fresh evidence and a fresh design review. They do not become `verified-fixed` automatically.

## Agent packet

This implementation does not require a hosted LLM. When a coding agent can do the subjective review, Screenslop can write a packet:

```text
artifacts/<run>/design-review-packet.json
artifacts/<run>/design-review-prompt.md
```

The packet gives the agent the screenshot path, AX summary, deterministic findings summary, a redacted profile summary, screen metadata, matrix cell metadata when available, review questions, and an output schema. It does not copy the full private profile into the packet.

## Guardrails

- Do not bake app-specific rules into the public engine.
- Do not commit private `.screenslop/design-profile.json`.
- Do not auto-edit subjective findings in the first implementation.
- Do not claim subjective fixes are verified without fresh evidence and the right proof label.
- Keep Screenslop Studio as a wrapper around this engine, not a fork of the design logic.
