# Screenslop Design Intelligence Module Plan

Date: 2026-06-14
Status: planned, not implemented
Scope: public Screenslop engine / CLI / skill / agent contract only

## Requirements summary

Screenslop should grow beyond the current deterministic critique slice without losing the trust boundary that makes it useful. The new module should let Screenslop read a project, learn or refresh an app-specific design profile, and use that profile to produce design-aware recommendations from real runtime evidence.

The important split:

- Keep the deterministic proof layer intact.
- Add a separate Design Intelligence layer for hierarchy, typography, color, component fit, emotional tone, state contradictions, slop patterns, and product-design recommendations.
- Make AI coding agents and CLI users know when and how to invoke the new design layer.
- Give projects a safe way to refresh the learned profile when code, docs, tokens, or product direction changes.

## Evidence from the current repo

- Screenslop is already framed as runtime-first, and the core rule is not to critique from source alone when runtime evidence is available: `docs/architecture.md:3-5`.
- Project config is private by design because paths and bundle IDs can leak private app details: `docs/architecture.md:37-43`.
- The architecture already names broader critique pillars: hierarchy, typography, color, layout, accessibility, interaction, motion, platform fit, slop patterns, and performance risk: `docs/architecture.md:104-119`.
- `screenslop learn` is already reserved in the command model for learning a design system from evidence and code, but it is not wired yet: `docs/commands.md:112-141`.
- The current critique implementation is deterministic: it loads evidence, AX tree, accessibility/layout/log detectors, then writes findings: `src/critique/collect-critique.mjs:18-34`.
- Current findings have a stable schema with severity, pillar, evidence, fix, verification, confidence, and effort: `src/critique/findings.mjs:23-42` and `schemas/finding.schema.json:6-18`.
- The agent contract already requires runtime evidence, fresh recapture, and phone-size matrix proof for layout-sensitive work: `docs/agent-integrations.md:63-75`.
- The public engine must remain the source of truth for CLI, skills, agents, and future Studio: `docs/repo-strategy.md:5-16`.

## Decision

Add a new internal module named **Design Intelligence** under `src/design/` and expose it through:

```bash
screenslop learn
screenslop learn --refresh
screenslop learn --check
screenslop critique <bundle> --design
screenslop critique <bundle> --design-profile <file>
screenslop matrix --profile examples/matrix/phone-sizes.json --critique --design --json
```

The deterministic critique path stays the default. The design-aware layer is opt-in at first, then agents should auto-use it when a project profile exists or when the user asks for design polish, visual quality, hierarchy, typography, brand fit, onboarding quality, paywall quality, settings polish, or slop review.

## Non-goals

- Do not bake BoardingReady-specific design rules into Screenslop core.
- Do not require a hosted LLM for the basic CLI to work.
- Do not auto-edit subjective design findings in the first implementation.
- Do not call subjective design judgments “verified” in the same way as AX frame or touch-target proof.
- Do not commit private `.screenslop/design-profile.json` by default.
- Do not start Screenslop Studio work as part of this module.

## Architecture

### 1. Design profile model

Add a project-local profile:

```text
.screenslop/design-profile.json
```

Private by default. Optional public export later:

```text
docs/screenslop-design-profile.md
```

Schema: `schemas/design-profile.schema.json`.

Proposed shape:

```json
{
  "schemaVersion": 1,
  "project": {
    "name": "BoardingReady",
    "platform": "ios",
    "appCategory": "pet-care",
    "audience": ["pet owners"],
    "tone": ["warm", "calm", "trustworthy"]
  },
  "sources": [
    {
      "path": "PetPacket/Features/Onboarding/WelcomeView.swift",
      "kind": "swiftui-source",
      "hash": "sha256:...",
      "lastSeenAt": "2026-06-14T00:00:00.000Z"
    }
  ],
  "tokens": {
    "colors": [],
    "typography": [],
    "spacing": [],
    "cornerRadii": [],
    "materials": [],
    "icons": []
  },
  "components": [
    {
      "name": "PrimaryCTA",
      "purpose": "main screen action",
      "expectedTraits": ["visually dominant", "bottom reachable", "single primary per screen"]
    }
  ],
  "screenTypes": [
    {
      "name": "onboarding",
      "goals": ["build trust", "reduce setup anxiety"],
      "rules": ["one obvious next action", "warm empty-copy", "no debug-looking state"]
    }
  ],
  "stateSemantics": [
    {
      "name": "premium badge",
      "rules": ["badge state must match entitlement or lock state", "do not imply active setup when setup is incomplete"]
    }
  ],
  "reviewRules": [
    {
      "id": "design.cta.weak-primary-action",
      "pillar": "hierarchy",
      "severity": "P2",
      "description": "Primary action should be visually dominant and not compete with secondary actions."
    }
  ],
  "freshness": {
    "createdAt": "2026-06-14T00:00:00.000Z",
    "updatedAt": "2026-06-14T00:00:00.000Z",
    "sourceHash": "sha256:...",
    "status": "current"
  }
}
```

### 2. Design context collector

Add `src/design/collect-project-context.mjs`.

It should read only allowed project-local inputs:

- `.screenslop/config.json` for `sourceRoot`, `defaultSurface`, `artifactsDir`, and source hints.
- SwiftUI source files under `sourceRoot`.
- Existing docs such as `README.md`, `AGENTS.md`, `CLAUDE.md`, `docs/**/*.md`, and committed design docs.
- Evidence bundles from `artifactsDir` when explicitly requested.
- Token files when explicitly passed with `--tokens`.

It must ignore:

- `.git/`, `.omx/`, `.omc/`, `node_modules/`, `DerivedData/`, `build/`, `artifacts/` unless an artifact bundle is explicitly passed, and any symlink escapes.
- Secrets such as `.env`, provisioning profiles, keychains, or files matching common credential names.

Outputs:

```text
artifacts/<run>/design-context.json
artifacts/<run>/design-context.md
```

The JSON should keep machine-readable facts. The Markdown should be an agent-readable design brief.

### 3. Learning and refresh flow

Add `src/design/learn-profile.mjs` and `src/design/refresh-profile.mjs`.

Commands:

```bash
screenslop learn --json --dry-run
screenslop learn --write --yes --json
screenslop learn --from-artifacts artifacts/<run> --json --dry-run
screenslop learn --tokens path/to/tokens.json --json --dry-run
screenslop learn --check --profile .screenslop/design-profile.json --json
screenslop learn --refresh --profile .screenslop/design-profile.json --json --dry-run
screenslop learn --refresh --write --yes --json
```

Behavior:

- `--dry-run` prints the profile draft and writes no profile.
- `--write` writes `.screenslop/design-profile.json` only with confirmation or `--yes`.
- `--check` compares stored source fingerprints with the current project and reports `current`, `stale`, `missing-sources`, or `needs-review`.
- `--refresh` preserves user-authored overrides where possible, updates learned facts, and records a change summary.
- `--from-artifacts` lets a profile learn from real captured screens.
- `--tokens` imports design tokens from a local file without making Screenslop depend on a token tool in v1.

Refresh report shape:

```json
{
  "ok": true,
  "command": "learn",
  "mode": "refresh",
  "profile": ".screenslop/design-profile.json",
  "status": "stale",
  "changes": [
    { "kind": "source-changed", "path": "PetPacket/Features/Onboarding/WelcomeView.swift" },
    { "kind": "token-added", "token": "colors.accentPremium" }
  ],
  "artifacts": {
    "profileDraft": "artifacts/.../design-profile.draft.json",
    "refreshReport": "artifacts/.../design-refresh.json"
  }
}
```

### 4. Design-aware critique flow

Extend `screenslop critique` with opt-in design flags:

```bash
screenslop critique artifacts/<run> --design --json
screenslop critique artifacts/<run> --design-profile .screenslop/design-profile.json --json
screenslop critique artifacts/<run> --design --agent-packet --json
```

Rules:

- Deterministic findings still run first.
- Design findings are appended after deterministic findings.
- Design findings must include evidence pointers and a proof label.
- If no profile exists, `--design` should either:
  - fail with `missing-design-profile` in strict JSON mode, or
  - write a design-review packet and tell the user/agent to run `screenslop learn` first.

Finding additions:

Extend `createFinding` and `schemas/finding.schema.json` with optional fields, keeping existing required fields stable:

```json
{
  "kind": "measured | design | product-logic | profile-gap",
  "proofLevel": "measured | runtime-informed | profile-informed | agent-judgment",
  "requiresHumanReview": true,
  "profileRuleId": "design.cta.weak-primary-action",
  "judgment": "The primary action competes with two secondary actions.",
  "alternatives": ["Demote the secondary button", "Move tertiary action into overflow"]
}
```

Initial design detectors:

- `design.profile-gap`: no usable profile exists for design critique.
- `design.cta.weak-primary-action`: multiple visible primary-looking actions or no clear primary action from AX labels/source/profile.
- `design.state.badge-contradiction`: text/state semantics conflict with a known profile rule.
- `design.copy.generic-empty-state`: empty state copy violates project tone/profile rules.
- `design.component.mismatch`: source or AX labels suggest a component is not using the expected design-system component.
- `design.matrix.inconsistent-hierarchy`: phone-size matrix shows materially different primary action order/visibility across cells.

### 5. Agent packet for subjective review

Because a local Node CLI cannot reliably make visual taste judgments without a model provider, add a first-class agent handoff packet.

Command:

```bash
screenslop critique artifacts/<run> --design --agent-packet --json
```

Artifacts:

```text
artifacts/<run>/design-review-packet.json
artifacts/<run>/design-review-prompt.md
artifacts/<run>/design-profile.used.json
```

The packet should include:

- screenshot path
- AX summary
- deterministic findings summary
- current design profile
- screen metadata
- matrix cell metadata when available
- explicit review questions
- output schema for agent-produced findings

Agent-produced design findings can be imported later:

```bash
screenslop critique artifacts/<run> --import-design-findings artifacts/<run>/agent-design-findings.json --json
```

This keeps the CLI useful for Codex, Claude Code, Cursor, and other agents without forcing Screenslop to own every LLM provider on day one.

### 6. Optional provider adapters, not required for v1

Add a provider seam, but keep it off by default:

```text
src/design/providers/
  agent-packet.mjs
  local-rules.mjs
  openai.mjs        # future optional
  anthropic.mjs     # future optional
```

The v1 implementation should ship `local-rules` and `agent-packet` first. Hosted model adapters can come later behind explicit environment variables and docs.

### 7. Matrix integration

Extend matrix with design review:

```bash
screenslop matrix --profile examples/matrix/phone-sizes.json --critique --design --json
```

Each captured cell should include:

```json
{
  "critique": { "summary": {}, "findings": [] },
  "design": { "summary": {}, "findings": [], "profile": ".screenslop/design-profile.json" }
}
```

Add matrix-level design findings:

- primary CTA disappears on small phone
- content hierarchy changes in a way the profile disallows
- Pro Max layout stretches beyond the design rhythm
- Dynamic Type layout loses component semantics

### 8. Fix and verify boundaries

Do not auto-apply design findings at first.

`screenslop fix` behavior:

- measured findings: existing safe auto-fixes continue.
- design findings: write a suggestion plan only.
- product-logic findings: suggestion plan only unless a future typed rule has a safe source patch.

`screenslop verify` behavior:

- measured findings: same matching logic as today.
- design findings: compare before/after evidence and design review output, then emit `improved`, `unchanged`, `regressed`, or `needs-human-review`.
- never call design findings `verified-fixed` unless the finding has a deterministic measurable matcher.

### 9. Skills and AI coding-agent UX

Update the Screenslop skill so agents know this flow:

```bash
screenslop doctor
screenslop learn --check --json
screenslop learn --refresh --json --dry-run   # when stale
screenslop see --surface <surface> --json
screenslop critique artifacts/<run> --json
screenslop critique artifacts/<run> --design --json
screenslop critique artifacts/<run> --design --agent-packet --json  # if the agent host will do subjective review
screenslop matrix --profile examples/matrix/phone-sizes.json --critique --design --json
```

Agent rules:

- If the user asks for UI polish, design quality, hierarchy, typography, color, emotional fit, onboarding quality, paywall quality, settings quality, badge/state logic, slop, or app-specific design fit, run the design-aware pass.
- If `.screenslop/design-profile.json` is missing, run `screenslop learn --json --dry-run` and ask before writing.
- If `screenslop learn --check` returns stale, run `screenslop learn --refresh --json --dry-run` before judging the screen.
- Treat deterministic findings and design findings differently in summaries.
- Do not claim subjective design improvements are verified unless fresh evidence plus a refreshed design review supports the claim.

Update:

- `skills/screenslop/SKILL.md`
- `skills/screenslop/reference/runtime.md`
- `docs/agent-playbook.md`
- `docs/agent-integrations.md`
- `docs/commands.md`
- `docs/known-limitations.md`
- `docs/release-checklist.md`
- `README.md`

### 10. Documentation and examples

Add:

```text
docs/design-intelligence.md
docs/design-profile-format.md
examples/design-profile/minimal.json
examples/design-profile/boardingready-redacted.json
examples/json/design-review-packet.json
```

The BoardingReady example must be redacted and generic enough to ship publicly. No private paths, no private product secrets, no raw app screenshots unless explicitly approved.

## Implementation steps

### Phase 1 — Contracts and docs

1. Add `schemas/design-profile.schema.json`.
2. Add `schemas/design-review.schema.json` for agent/imported design findings.
3. Extend `schemas/finding.schema.json` with optional `kind`, `proofLevel`, `requiresHumanReview`, `profileRuleId`, `judgment`, and `alternatives`.
4. Add `docs/design-intelligence.md` and `docs/design-profile-format.md`.
5. Update command docs and skill docs with the planned flow.
6. Add contract tests for schemas, docs, skill text, and package whitelist.

Acceptance:

- `node --test tests/contracts.test.mjs` validates the new schema files and docs references.
- `npm run --silent smoke:package` proves new docs/examples/schemas ship in the package.

### Phase 2 — Learn/check/refresh MVP

1. Add `src/design/profile-schema.mjs`.
2. Add `src/design/collect-project-context.mjs`.
3. Add `src/design/learn-profile.mjs`.
4. Add `src/design/refresh-profile.mjs`.
5. Wire `screenslop learn` in `bin/screenslop.mjs`.
6. Add tests in `tests/design-profile.test.mjs`.

Acceptance:

- `screenslop learn --json --dry-run` returns a profile draft without writing.
- `screenslop learn --write --yes --json` writes `.screenslop/design-profile.json` in a temp fixture project.
- `screenslop learn --check --json` returns `current` for unchanged inputs.
- Changing a fixture SwiftUI file makes `screenslop learn --check --json` return `stale`.
- `screenslop learn --refresh --json --dry-run` returns a draft and change summary without writing.
- Symlink escapes and blocked folders are refused.

### Phase 3 — Design review packet and local rules

1. Add `src/design/load-profile.mjs`.
2. Add `src/design/summarize-evidence.mjs`.
3. Add `src/design/agent-packet.mjs`.
4. Add `src/design/review-design.mjs`.
5. Add initial local rules in `src/design/rules/`.
6. Extend `collectCritique` options so `--design` can append design findings.
7. Add `--design`, `--design-profile`, `--agent-packet`, and `--import-design-findings` to `screenslop critique`.
8. Add tests in `tests/design-review.test.mjs`.

Acceptance:

- `screenslop critique fixtures --design-profile <profile> --json` emits deterministic findings plus design findings when fixture rules match.
- Missing profile in strict JSON mode returns a parseable `missing-design-profile` error.
- `--agent-packet` writes `design-review-packet.json` and `design-review-prompt.md`.
- Imported agent findings are schema-validated and normalized into Screenslop findings.

### Phase 4 — Matrix + design intelligence

1. Thread `--design` through `src/matrix/collect-matrix.mjs`.
2. Add matrix-level design consistency checks.
3. Extend matrix report schema for optional design summary per cell.
4. Update phone-size guidance in skills/docs.
5. Add matrix tests.

Acceptance:

- `screenslop matrix --profile examples/matrix/phone-sizes.json --critique --design --dry-run --json` preserves all three cells and reports design status as unavailable/dry-run instead of dropping cells.
- Live/fake matrix tests prove per-cell design review is recorded when critique succeeds.
- Agent docs tell coding agents to run design matrix checks for layout/design-sensitive work.

### Phase 5 — Verify semantics for design findings

1. Extend verify matching to understand `kind: design` and `proofLevel`.
2. Add statuses: `improved`, `unchanged`, `regressed`, `needs-human-review`.
3. Keep `verified-fixed` for deterministic measurable fixes only.
4. Add before/after report sections for design findings.

Acceptance:

- Existing deterministic verify tests still pass.
- A fixture design finding with improved fresh review returns `improved`, not `verified-fixed`.
- A missing fresh design review returns `needs-human-review`.

### Phase 6 — BoardingReady dogfood, redacted

1. In BoardingReady, run `npx screenslop learn --json --dry-run`.
2. Review and write a private `.screenslop/design-profile.json` only after confirmation.
3. Capture a real screen with `screenslop see`.
4. Run deterministic critique.
5. Run design critique.
6. Run phone-size matrix with `--critique --design`.
7. Fix one measured finding and one design recommendation manually.
8. Recapture and verify measured proof; record design improvement separately.
9. Redact any public lesson before committing anything to Screenslop.

Acceptance:

- Private dogfood report contains no raw private paths or screenshots in public commits.
- At least one design finding is useful and not just generic advice.
- Agent playbook instructions are updated if dogfood shows confusion.

## Test plan

Unit tests:

- profile schema validation
- profile source fingerprinting
- source scanner blocked-path handling
- refresh merge behavior
- design finding normalization
- local design rule detectors
- imported agent findings validation

Integration tests:

- `learn --dry-run` in fixture project
- `learn --write --yes` in temp project
- `learn --check` current/stale states
- `critique --design-profile` with fixture evidence
- `critique --agent-packet` artifact writing
- `matrix --critique --design` dry-run and fake live cells
- `verify` design statuses

Package/contract tests:

- schemas included in npm package
- examples included in npm package
- skill docs mention learn/check/refresh/design critique
- CLI help advertises learn/design flags honestly

Manual/runtime tests:

- `node bin/screenslop.mjs doctor`
- `npm test`
- `npm run --silent smoke:package`
- `npm run smoke:runtime` when simulator tools are available
- BoardingReady private dogfood with redacted summary

## Risks and mitigations

### Risk: subjective findings look as “proven” as measured findings

Mitigation: add `kind`, `proofLevel`, and `requiresHumanReview`; keep `verified-fixed` reserved for deterministic matchers.

### Risk: profile becomes stale and gives bad advice

Mitigation: source fingerprints, `screenslop learn --check`, `screenslop learn --refresh`, and skill rules that agents must refresh stale profiles before design critique.

### Risk: project scan leaks private data

Mitigation: private profile default, blocked folders, symlink checks, redacted public examples, package whitelist tests, and dogfood redaction checks.

### Risk: CLI becomes dependent on an LLM provider

Mitigation: ship local rules and agent packet first. Provider adapters are optional and explicit later.

### Risk: design system becomes too app-specific for the public engine

Mitigation: keep project-specific rules inside `.screenslop/design-profile.json`; Screenslop core only defines schemas, collectors, review plumbing, and generic rule categories.

### Risk: agents skip the new module

Mitigation: update skill, `screenslop instructions`, agent playbook, README, and contract tests so the new commands are visible to Codex, Claude Code, Cursor, and CLI users.

## Verification commands before declaring implementation done

```bash
node --test tests/contracts.test.mjs
node --test tests/design-profile.test.mjs
node --test tests/design-review.test.mjs
node bin/screenslop.mjs learn --json --dry-run
node bin/screenslop.mjs critique tests/fixtures/evidence/<fixture> --design-profile examples/design-profile/minimal.json --json
node bin/screenslop.mjs matrix --profile examples/matrix/phone-sizes.json --critique --design --dry-run --json
node bin/screenslop.mjs doctor
npm test
npm run --silent smoke:package
git diff --check
npm run cleanup:macos:dry
```

Run `npm run cleanup:macos -- --yes` after preview when sidecars appear.

## Suggested execution staffing

This is broad enough for Team + Ultragoal after plan approval.

Recommended roles:

- architect: schema boundaries, command contract, proof semantics.
- worker/executor: learn/check/refresh implementation.
- worker/executor: critique/design review packet implementation.
- tester: schema, CLI, matrix, verify regression tests.
- docs: docs, skill, README, agent instructions.
- verifier: final local gates, package smoke, dogfood evidence boundary.
- critic/reviewer: proof-boundary review before merge.

Suggested launch:

```bash
$oh-my-codex:ultragoal Execute .omx/plans/screenslop-design-intelligence-module-2026-06-14.md
```

For a coordinated parallel implementation run, use Team under Ultragoal leadership so checkpoint evidence lands back in the durable goal ledger.

## Open questions for execution

1. Should the first profile file be `.screenslop/design-profile.json` only, or should `screenslop learn --write` also offer a public `docs/screenslop-design-profile.md` export?
2. Should `screenslop critique --design` auto-detect `.screenslop/design-profile.json`, or require `--design-profile` for v1 strictness?
3. Should hosted model providers be planned now as optional future adapters, or kept out until local rules + agent packets prove useful?
4. Which BoardingReady screen should be the first private dogfood target?
