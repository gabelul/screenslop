# Design Intelligence

Screenslop has two review layers.

1. Deterministic critique: measured findings from runtime evidence.
2. Design intelligence: app-aware recommendations from runtime evidence plus a project design profile.

The deterministic layer stays the default. It handles things like missing AX labels, weak evidence, touch targets, offscreen frames, and logs. Design intelligence is separate because hierarchy, typography, color, emotional fit, product-state logic, and slop patterns need project context.

## Planned flow

```bash
screenslop learn --json --dry-run
screenslop learn --write --yes --json
screenslop learn --check --json
screenslop learn --refresh --json --dry-run

screenslop critique artifacts/<run> --design --json
screenslop critique artifacts/<run> --design-profile .screenslop/design-profile.json --json
screenslop critique artifacts/<run> --design --agent-packet --json
```

`--design` should never weaken the proof boundary. Design findings must say what kind of judgment they are:

- `measured`: deterministic, tool-measured proof.
- `design`: app-aware design recommendation.
- `product-logic`: visible state or copy contradiction.
- `profile-gap`: missing or stale profile context.

Design findings also carry a `proofLevel`:

- `measured`
- `runtime-informed`
- `profile-informed`
- `agent-judgment`

Only measured findings can become `verified-fixed` automatically. Design findings can become `improved`, `unchanged`, `regressed`, or `needs-human-review` after fresh evidence and a fresh design review.

## Agent packet

The first implementation should not require a hosted LLM. When a coding agent can do the subjective review, Screenslop can write a packet:

```text
artifacts/<run>/design-review-packet.json
artifacts/<run>/design-review-prompt.md
```

The packet gives the agent the screenshot path, AX summary, deterministic findings summary, design profile, screen metadata, matrix cell metadata when available, review questions, and an output schema.

## Guardrails

- Do not bake app-specific rules into the public engine.
- Do not commit private `.screenslop/design-profile.json`.
- Do not auto-edit subjective findings in the first implementation.
- Do not claim subjective fixes are verified without fresh evidence and the right proof label.
- Keep Screenslop Studio as a wrapper around this engine, not a fork of the design logic.
