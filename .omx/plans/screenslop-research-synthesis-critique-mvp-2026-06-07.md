# Screenslop Research Synthesis + Critique MVP Plan

Date: 2026-06-07
Mode: `$oh-my-codex:plan`
Scope: planning only. No source implementation in this pass.

## Requirements Summary

- Research-synthesize the gathered Screenslop source projects in `research/` and decide what should influence the critique MVP.
- Plan the first `screenslop critique` MVP now that `screenslop see` can create real Baguette evidence bundles.
- Keep Screenslop as the public engine/CLI/agent-integration repo; Studio wraps it instead of duplicating critique logic (`docs/session-handoff.md:19-28`).
- Preserve the runtime-first rule: do not critique Apple UI from source alone when runtime evidence exists (`docs/architecture.md:3-5`).
- Use the current command model: `see` captures screenshot/AX/logs/manifest/summary, and `critique` reviews evidence into findings (`docs/commands.md:53-69`).
- Keep research repos untracked; promote any adopted decisions into tracked docs (`docs/research-workspace.md:3-21`, `research/repos/README.md:34`).
- Before claiming completion during implementation, run `node bin/screenslop.mjs doctor` and `npm test` per repo instructions.

## Current Screenslop Baseline

- Runtime order is already defined as Baguette, then XcodeBuildMCP, then xcodebuild/simctl, then manual evidence (`docs/session-handoff.md:30-37`, `docs/architecture.md:26-33`).
- The next engineering step in the handoff explicitly says to implement the first critique pass after `see` (`docs/session-handoff.md:86-98`).
- The evidence model is artifact-first: reports are derived from evidence bundles (`docs/architecture.md:35-53`).
- The critique engine already names the intended pillars: hierarchy, typography, color/contrast, layout/safe areas, accessibility, interaction, motion, platform fit, slop patterns, and performance risk (`docs/architecture.md:55-70`).
- The current finding schema requires `id`, `severity`, `pillar`, `title`, and `evidence`, and evidence can already point to artifacts, AX nodes, screenshot regions, and source hints (`schemas/finding.schema.json:1-37`).
- The current severity model is P0-P3 and already has usable descriptions (`src/critique/rubric.mjs:14-19`).
- The evidence schema records driver, device, screenshot, AX tree, logs, summary, capture status, and capture steps (`schemas/evidence.schema.json:6-64`).
- A real Baguette bundle currently exposes AX nodes with `role`, `label`, `value`, `identifier`, `enabled`, `hidden`, and `frame`, including screen-size root frames and control frames. That supports deterministic AX and layout checks immediately.

## Research Synthesis

### Adopt Now

1. Evidence-backed scoring discipline from Pixelslop.
   - Pixelslop's core pattern is to render real UI and measure it, not infer from code (`research/repos/pixelslop/README.md:14`, `research/repos/pixelslop/CLAUDE.md:3-6`).
   - Its rubric requires every score to cite concrete evidence, not taste language (`research/repos/pixelslop/dist/skill/resources/scoring.md:1-7`).
   - Screenslop should copy that discipline, but not the browser/DOM implementation.

2. Priority grouping and state concepts from Pixelslop, adapted to Screenslop findings.
   - Pixelslop groups findings by priority and uses checkpointed fix/verify loops (`research/repos/pixelslop/README.md:47`, `research/repos/pixelslop/CLAUDE.md:14-21`).
   - Its plan format tracks status, issue id, priority, category, and measured description (`research/repos/pixelslop/dist/skill/resources/plan-format.md:1-6`, `research/repos/pixelslop/dist/skill/resources/plan-format.md:59-83`).
   - Screenslop MVP should emit grouped findings now; status mutation can wait for `fix`/`verify`.

3. Mobile-screen-eval's finding shape.
   - It reports each finding with Element, Observation, Why, Recommendation, and Effort (`research/repos/mobile-screen-eval/README.md:35-43`).
   - It evaluates with Nielsen heuristics, WCAG 2.1 AA, and platform guidelines (`research/repos/mobile-screen-eval/README.md:44-53`).
   - Screenslop should adapt this into `title`, `detail`, `suggestedFix`, `verification`, and a lightweight `effort` field or markdown report field.

4. Apple/mobile thresholds as deterministic MVP rules.
   - Apple HIG research repeats 44x44pt touch targets, safe areas, adaptive layout, Dynamic Type, and platform conventions (`research/repos/apple-hig-designer-skill-2026/SKILL.md:183-190`).
   - Apple app UI notes call out Dynamic Type, semantic colors, SF Symbols, 44x44pt targets, 4.5:1 contrast, labels, and Reduce Motion (`research/repos/apple-app-ui-design/SKILL.md:114-127`).
   - Pixel-perfect-mobile repeats 44pt targets, 14-16pt body text, 4pt grid, and WCAG contrast thresholds (`research/repos/pixel-perfect-mobile/SKILL.md:20-31`, `research/repos/pixel-perfect-mobile/SKILL.md:41-65`, `research/repos/pixel-perfect-mobile/SKILL.md:204-220`).
   - The critique MVP should implement only the thresholds that current evidence can prove: touch target size, missing labels, generic labels, offscreen/clipping candidates, and log errors.

5. Baguette's device-point coordinate contract.
   - Baguette's `describe-ui` emits frames in device points, ready to feed back into taps (`research/repos/baguette/README.md:172-176`).
   - Baguette documents that the wire format is points, not normalized coordinates (`research/repos/baguette/docs/ARCHITECTURE.md:185-199`).
   - Screenslop critique should treat AX frames as point units, not pixels, and reserve screenshot-region math for later image-aware checks.

6. Thin runtime-driver layering from Baguette.
   - Baguette separates app orchestration, domain values, and infrastructure adapters (`research/repos/baguette/docs/ARCHITECTURE.md:59-76`).
   - Its domains are mockable ports and value types (`research/repos/baguette/docs/ARCHITECTURE.md:78-102`).
   - Screenslop should keep critique modules pure and test them with fixture bundles instead of hard-wiring Baguette commands into critique logic.

7. Impeccable's direct craft vocabulary, not its command model.
   - Impeccable is useful for shared design vocabulary and deterministic anti-pattern rules (`research/repos/impeccable/README.md:13-17`).
   - Its product voice is direct, specific, and rooted in craft (`research/repos/impeccable/PRODUCT.md:11-18`).
   - Screenslop commands should still stay different because Screenslop sees the app (`docs/commands.md:1-4`).

### Adopt Later

1. Pixelslop personas and checkpoint protocol.
   - Personas and checkpointing are valuable but belong after critique can produce stable finding IDs (`research/repos/pixelslop/CLAUDE.md:14-21`, `research/repos/pixelslop/CLAUDE.md:120-128`).

2. Baguette stream/input/watch loop.
   - Baguette has long-lived `input`, `stream`, and `serve` modes (`research/repos/baguette/README.md:166-189`).
   - This maps to future `screenslop watch`, not the first critique pass (`docs/commands.md:94-98`).

3. XcodeBuildMCP fallback driver.
   - XcodeBuildMCP has CLI and MCP modes, plus a per-workspace daemon for stateful operations like log capture and debugging (`research/repos/XcodeBuildMCP/README.md:8-23`, `research/repos/XcodeBuildMCP/README.md:72-98`).
   - Good fallback path, but not a critique MVP blocker because Baguette evidence is already available.

4. Swift visual matrix testing.
   - `swift-visual-testing` generates device/theme/locale snapshot matrices and catalogs (`research/repos/swift-visual-testing/README.md:10-17`, `research/repos/swift-visual-testing/README.md:122-130`).
   - That belongs in `matrix`/`verify`, not the first single-bundle critique (`docs/roadmap.md:38-42`).

5. Tokextract / DESIGN.md.
   - Tokextract emits `tokens.json`, `DESIGN.md`, and `audit.md` from SwiftUI code (`research/repos/tokextract/README.md:1-9`).
   - It extracts colors, typography, spacing, shapes, shadows, animations, components, Liquid Glass, and theme injection (`research/repos/tokextract/README.md:11-25`).
   - Its hybrid deterministic-parse plus LLM-naming architecture is a good `learn` model (`research/repos/tokextract/README.md:128-169`).
   - Do not wire it now; Screenslop's own docs already say to inspect the input/output contract before connecting tokextract (`docs/commands.md:22-51`, `research/findings/source-candidates.md:13-21`).

### Reject for Critique MVP

- Do not copy Impeccable's command names. Screenslop's workflow differs because it has runtime evidence (`docs/commands.md:1-4`).
- Do not ship source-only design criticism. The architecture forbids it when runtime evidence exists (`docs/architecture.md:3-5`).
- Do not import Swift snapshot-testing packages into the JS CLI for this MVP. Snapshot matrix work is later (`research/repos/swift-visual-testing/Package.swift:19-23`, `docs/roadmap.md:38-42`).
- Do not copy browser DOM heuristics from Pixelslop directly. Its viewport protocol and computed-style snippets are web-specific (`research/repos/pixelslop/dist/skill/resources/visual-eval.md:9-65`). Screenslop should adapt the evidence-first shape to AX/runtime data.
- Do not promise reliable typography, contrast, motion, or color scoring until Screenslop collects the needed evidence. Current Baguette evidence can prove AX and frame findings; it cannot yet compute text contrast or font scale without extra image/source analysis.

## MVP Product Boundary

### Command

```bash
node bin/screenslop.mjs critique artifacts/<bundle>
node bin/screenslop.mjs critique artifacts/<bundle> --json
```

Optional later convenience:

```bash
node bin/screenslop.mjs critique --latest
```

Keep `--latest` out of the first patch unless it falls out naturally. Explicit bundle paths are easier to test and harder to misunderstand.

### Inputs

- `evidence.json` from a `screenslop see` bundle.
- `accessibility.json` when present.
- `logs.ndjson` when present.
- `screenshot.jpg` path for report evidence, but no deep image analysis in MVP.
- Existing `sourceHints[]` when present.

### Outputs

- Human CLI summary grouped by severity.
- JSON CLI output with `ok`, `bundle`, `findings`, and `summary`.
- `findings.json` written into the evidence bundle.
- `critique.md` written into the evidence bundle.

### Finding Contract

Each finding must include:

- `id`: stable slug, preferably deterministic from rule + node path/role/label/frame.
- `severity`: P0-P3.
- `pillar`: one of the existing schema pillars.
- `title`: direct issue title.
- `detail`: measured observation and why it matters.
- `evidence`: artifact path plus AX node/frame/log line/source hint when available.
- `suggestedFix`: practical SwiftUI/actionable fix wording.
- `verification`: exact recapture or assertion needed.

Recommended schema extensions for implementation:

- `confidence`: `high | medium | low`.
- `effort`: `low | medium | high`.
- `ruleId`: machine-stable detector id.
- `evidence.note`: explicit missing-evidence note when the finding is an evidence-quality warning.

## MVP Detectors

Implement deterministic detectors first. No LLM dependency in the MVP.

### 1. Evidence Quality

- If `capture.status` is not `complete`, create an evidence-quality finding.
- If the screenshot is missing, create a P1/P2 finding depending on whether AX exists.
- If the AX tree is missing, create a P1 because the critique cannot verify labels, frames, or semantics.
- If logs were requested but missing, create a P3 evidence-gap note.

Why first: it protects Screenslop from pretending weak evidence is strong, matching the architecture rule that weak evidence must say so (`docs/architecture.md:55-70`).

### 2. Missing or Empty Labels on Interactive AX Nodes

Flag enabled visible interactive nodes where `label`, `title`, and meaningful `value` are all absent.

Initial interactive roles:

- `AXButton`
- `AXLink`
- `AXTextField`
- `AXTextArea`
- `AXSlider`
- `AXSwitch`
- `AXMenuButton`
- `AXPopUpButton`
- any role containing `Button`, `Link`, `Slider`, `Switch`, `TextField`, or `TextArea`

Severity:

- P1 for primary interactive controls with no accessible name.
- P2 for ambiguous cases, such as slider values without labels.
- P3 for identifier-source guidance when the control is accessible to users but hard to map to source.

### 3. Generic or Low-Information Labels

Flag visible interactive labels like:

- `Button`
- `Image`
- `Icon`
- `Close` if there are multiple close controls without context
- repeated identical labels among sibling controls where values do not disambiguate them

Severity:

- P2 by default.
- P1 if repeated labels block task completion, such as multiple unlabeled destructive actions.

### 4. Touch Target Size

For visible enabled interactive nodes, flag frames under 44x44 device points.

Severity:

- P1 if both width and height are below 44.
- P2 if one axis is below 44 but likely has surrounding hit padding.
- P3 if the visual frame is small but role/value suggests it may be a system accessory. Keep this conservative to avoid false positives like Apple's close glyphs with larger hit areas.

Apple/mobile support:

- 44x44pt appears in HIG research and mobile-eval research (`research/repos/apple-hig-designer-skill-2026/SKILL.md:183-190`, `research/repos/mobile-screen-eval/README.md:49-53`).

### 5. Offscreen or Oversized Frame Candidates

Using the root `AXApplication` frame as screen bounds:

- Flag non-root visible nodes with negative `x/y` or frames extending beyond root bounds.
- Ignore known overlay/dismiss regions by identifier or role where the oversized region is intentional, for example `PopoverDismissRegion`.
- Mark as candidate, not confirmed clipping, unless the node is interactive and its center falls outside bounds.

Severity:

- P1 if an enabled interactive control center is outside the screen.
- P2 if content is likely clipped.
- P3 if it looks like an intentional overlay/backdrop.

### 6. Log Error Signals

Parse `logs.ndjson` line-by-line without loading huge logs into memory.

Flag:

- `fault`
- `error`
- uncaught exception patterns
- Auto Layout / constraint breakage strings
- SwiftUI runtime warnings that mention invalid frames, NaN, or layout cycles

Severity:

- P1 for crash/exception/fault lines.
- P2 for layout warnings.
- P3 for noisy but relevant warnings.

### 7. Source Mapping Hint Quality

If an AX node has no `identifier`, add a P3 source-mapping hint only when it also has another finding. Do not spam one finding per unlabeled identifier.

Why: source mapper value is real (`docs/architecture.md:72-88`), but missing identifiers are not always user-facing bugs.

## Non-MVP Detectors

- Contrast ratios: needs pixel sampling plus text/background region confidence or source token evidence.
- Typography scale: needs font/source extraction or better runtime text attributes.
- Dynamic Type: needs matrix capture under accessibility text settings.
- Reduce Motion: needs runtime environment capture and motion observation.
- Liquid Glass/material misuse: needs source analysis or richer runtime layer metadata.
- Persona evaluation: needs stable core findings first.

## Implementation Steps for the Execution Phase

1. Add critique loading and path resolution.
   - New file: `src/critique/load-evidence.mjs`.
   - Read `evidence.json` from a bundle directory.
   - Resolve artifact paths relative to repo root and bundle root.
   - Return structured missing-artifact diagnostics instead of throwing raw file errors.

2. Add AX tree utilities.
   - New file: `src/critique/ax-tree.mjs`.
   - Flatten nested AX trees.
   - Preserve node path/index for stable finding IDs.
   - Normalize labels, roles, enabled/hidden state, and frames.

3. Add deterministic detectors.
   - New file: `src/critique/detectors/accessibility.mjs`.
   - New file: `src/critique/detectors/layout.mjs`.
   - New file: `src/critique/detectors/logs.mjs`.
   - New file: `src/critique/detectors/evidence-quality.mjs`.

4. Add finding builder and grouping.
   - New file: `src/critique/findings.mjs`.
   - Generate deterministic IDs.
   - Validate severity/pillar values against the existing rubric.
   - Group counts by severity and pillar.

5. Add report writers.
   - New file: `src/critique/report.mjs`.
   - Write `findings.json`.
   - Write `critique.md` with grouped findings, evidence references, and verification steps.

6. Wire CLI command.
   - Update `bin/screenslop.mjs`.
   - Parse `critique <bundle> --json`.
   - Human output should be short and grouped by severity.
   - JSON output should be strict and useful for agents.

7. Add fixtures and tests.
   - New fixtures under `tests/fixtures/evidence/`.
   - Add tests for:
     - complete bundle with no findings.
     - missing AX tree evidence gap.
     - missing label on interactive node.
     - touch target below 44pt.
     - offscreen frame candidate.
     - log error finding.
     - deterministic finding IDs.
     - `--json` CLI shape.

8. Promote research decisions into tracked docs.
   - New doc: `docs/research-adoptions.md`.
   - Summarize what was adopted, deferred, and rejected from the gathered repos.
   - Keep details out of ignored `research/` as required by `docs/research-workspace.md:21`.

9. Slopbuster pass.
   - Review new reports/docs/comments for AI-ish phrasing.
   - Keep comments technical and short. Add JSDoc/TSDoc-style comments for exported JS functions, per repo instructions.

## Acceptance Criteria

- `node bin/screenslop.mjs critique artifacts/<bundle>` prints a human summary grouped by severity.
- `node bin/screenslop.mjs critique artifacts/<bundle> --json` returns parseable JSON with `ok`, `bundle`, `summary`, and `findings`.
- A critique run writes `findings.json` and `critique.md` into the bundle directory.
- Every non-evidence-gap finding includes at least one concrete evidence pointer: AX node/frame, artifact path, log line, screenshot path/region, or source hint.
- Test fixtures prove missing label, small touch target, offscreen frame, missing evidence, and log error behavior.
- `npm test` passes.
- `node bin/screenslop.mjs doctor` passes.
- macOS sidecar cleanup, if needed, is run only through the cleanup script and previewed first.

## Risks and Mitigations

- AX role names may differ across apps or iOS versions.
  - Mitigation: role matching should be broad but conservative, and fixtures should include unknown roles.

- Touch target false positives are possible because visual frame and hit frame may differ.
  - Mitigation: use P2/P3 for one-axis failures and system-accessory-looking controls; phrase as hit-target candidate unless evidence is strong.

- Overlay regions can look offscreen by design.
  - Mitigation: ignore known dismiss/backdrop identifiers and roles, and treat oversized non-interactive regions as P3 candidates.

- Logs can be noisy.
  - Mitigation: start with a small allowlist of severe strings and cap log evidence snippets.

- Color, contrast, and typography claims would be tempting but under-evidenced.
  - Mitigation: explicitly defer those detectors until Screenslop collects pixel/source/token evidence.

## Verification Plan

Run during execution, not during this planning pass:

```bash
npm test
node bin/screenslop.mjs doctor
node bin/screenslop.mjs see --json --surface "Critique MVP Smoke" --logs --log-duration 500
node bin/screenslop.mjs critique artifacts/<latest-bundle> --json
```

Manual checks:

- Confirm `findings.json` validates against the updated finding schema.
- Confirm `critique.md` has no generic design criticism without evidence.
- Confirm repeated runs on the same fixture produce stable IDs.
- Confirm no destructive cleanup happened outside `npm run cleanup:macos` / `node scripts/cleanup-macos-sidecars.mjs --yes` after confirmation.

## Follow-up Staffing Guidance

Recommended execution path:

- Use `$ultragoal` by default if the user wants durable goal tracking across critique, docs, and verification.
- Use `$team` if parallel execution is desired:
  - `worker` lane: critique loader, detectors, CLI wiring.
  - `tester` lane: fixture design, detector tests, CLI JSON tests.
  - `docs` lane: `docs/research-adoptions.md` after implementation details settle.
  - `reviewer` lane: final code-quality review.
  - `verifier` lane: `doctor`, `npm test`, and live Baguette smoke.
- Use `$ralph` only if the user explicitly wants the same persistent single-owner loop used for `see`.

Suggested `$team` launch hint:

```text
$oh-my-codex:team Execute .omx/plans/screenslop-research-synthesis-critique-mvp-2026-06-07.md with worker+tester first, docs after tests, then reviewer+verifier.
```

Suggested Ralph fallback:

```text
$oh-my-codex:ralph Execute .omx/plans/screenslop-research-synthesis-critique-mvp-2026-06-07.md
```

## ADR

### Decision

Build the critique MVP as a deterministic, evidence-bundle reader focused on AX labels, touch targets, offscreen/clipping candidates, log errors, and evidence quality.

### Drivers

- Screenslop's core advantage is runtime evidence, not source-only taste review (`docs/architecture.md:3-5`).
- Current `see` bundles already contain enough Baguette evidence for AX/frame/log checks.
- Research strongly supports measured findings over vague design commentary (`research/repos/pixelslop/dist/skill/resources/scoring.md:1-7`).
- The roadmap already names missing labels, identifiers, clipping hints, contrast candidates, and touch targets for Phase 2 (`docs/roadmap.md:21-28`).

### Alternatives Considered

1. LLM design critique first.
   - Rejected for MVP. It would produce nicer prose but weaker proof, and could drift into source-free taste claims.

2. Full Pixelslop-style visual scoring first.
   - Rejected for MVP. Pixelslop's web scoring depends on computed DOM styles and browser viewports (`research/repos/pixelslop/dist/skill/resources/visual-eval.md:63-90`), which Screenslop does not yet collect for Apple apps.

3. Tokextract/design-system learning first.
   - Deferred. Useful for `learn`, but docs already warn not to wire tokextract before inspecting the contract (`docs/commands.md:45-51`).

4. XcodeBuildMCP fallback before critique.
   - Deferred. Valuable fallback, but Baguette already provides the evidence needed for the first critique pass.

### Why Chosen

This path gives Screenslop a useful critique command quickly without overclaiming. It uses the evidence the engine already captures, creates a real artifact (`findings.json` + `critique.md`), and sets up the later fix/verify loop.

### Consequences

- First critique will be narrower than the full product vision.
- Typography, contrast, color, and motion will be marked as future work unless evidence is available.
- Findings should be boring but trustworthy. That is the right trade for v1.

### Follow-ups

- Add image/pixel analysis for contrast candidates.
- Add source/token analysis via `learn` and possibly tokextract.
- Add XcodeBuildMCP fallback evidence collection.
- Add matrix capture for device/theme/Dynamic Type/Reduce Motion.
- Add fix/verify state tracking after finding IDs stabilize.

## Planner Notes

- This plan intentionally does not run `npm test` or `doctor`; no source implementation was performed.
- The previous `see` work should remain the baseline for live evidence capture.
- Sidecar files should continue to be handled through the cleanup script, not manual deletion.
