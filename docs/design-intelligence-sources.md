# Design Intelligence Sources

This is the graduated version of the `research/` folder. Thirty-odd repos were cloned, read, and argued with. This doc keeps what survived. Anything not listed here stayed in `research/` because it duplicated something, generated screens instead of reviewing them, or was pleasant but useless.

The rule from `research/findings/README.md` applies: research notes are disposable, decisions are tracked. These are the decisions.

## The thesis

Impeccable, Pixelslop, and Screenslop are the same idea pointed at three surfaces:

| Tool | Surface | Eyes (evidence) | Brain (design law) |
|---|---|---|---|
| impeccable | web/frontend code | jsdom + browser overlay | rich: 41-rule engine, registers, thresholds |
| pixelslop | rendered web pages | Playwright | medium |
| screenslop | Apple/SwiftUI apps | Baguette screenshot + AX tree + logs | thin (today) |

Impeccable has the best design brain and the worst eyes — jsdom does no layout, and their own docs admit the two detector paths disagree. Screenslop has the best eyes (a real running app, a real accessibility tree, a fix/verify loop) and the thinnest brain. The work is putting a brain like impeccable's behind eyes like ours, for Apple UI.

The moat stays where it already is: runtime evidence plus the capture → critique → fix → fresh capture → verify loop. Nothing in the research folder has that combination. The design intelligence below is content, not architecture. Load it as rules and priors; do not weld it into the engine.

## The two-track scoring model (adopt)

Impeccable's `critique` never produces one vibe-score. It runs two isolated tracks and refuses to merge them blind:

1. **Deterministic scan** — a rule engine over the DOM. Every finding gets a rule ID and a P0–P3 severity.
2. **Design judgment** — an LLM pass scoring Nielsen's 10 heuristics 0–4 each (40 points, explicit rubric text per tier), plus a cognitive-load checklist built on the ≤4-item working-memory rule, plus persona walkthroughs.

Screenslop already has this seam: `critique` (measured findings, `verified-fixed` semantics) versus `critique --design` / agent packet (judgment findings, `improved`/`needs-human-review` semantics). Impeccable independently arrived at the same split and proved it works. Keep the seam. Never let a judgment finding claim `verified-fixed`.

What we should add from their version:

- **Rubric text per score tier.** "Hierarchy: 2/4" is noise. "2 = primary action findable but competing with two siblings" is a finding.
- **Score trend across runs.** Impeccable persists critique snapshots and tracks the trend. Our evidence bundles already give us the storage; the comparison is cheap.
- **Severity tie-break test.** Their P0/P1 boundary question is "would a user contact support over this?" Steal it verbatim.

## Persona walkthroughs (adopt, Apple-flavored)

Impeccable evaluates every critique through five named personas, each with a concrete red-flag checklist. This is the cheapest way to catch design problems that no threshold catches — the screen can pass every measurement and still confuse a first-time user.

Their five, translated to Apple runtime reality:

| Persona | Impeccable original | Screenslop translation | Evidence we can attach |
|---|---|---|---|
| power user | Alex: efficiency, shortcuts | muscle-memory user: is the primary action stable across screens? | AX tree diff across surfaces |
| first-timer | Jordan: onboarding confusion | first-launch user: is the next step obvious with zero context? | screenshot + AX action count |
| accessibility | Sam: assistive tech | VoiceOver + accessibility Dynamic Type user | AX labels/traits, matrix a11y cell |
| stress-tester | Riley: hostile input | long-content user: 40-char German labels, 9999 unread | runtime capture with stress data |
| mobile | Casey: small screen | one-handed iPhone user: thumb reach, small device | matrix small-phone cell + AX frames |

These belong in the **agent packet**, not the deterministic detectors. The packet already carries the screenshot, AX summary, findings, and review questions; persona checklists are exactly the kind of review question it was built for. Findings come back as `design` kind with `requiresHumanReview` where appropriate — never as measured findings.

## Portable mechanisms (the two real finds)

### tokextract — token extraction done properly

`research/repos/tokextract` AST-walks a real SwiftUI codebase with tree-sitter-swift across 9 categories (color, typography, spacing, shape, shadow, animation, components, Liquid Glass, theme injection) and emits:

- **W3C DTCG `tokens.json`** — a standard token format instead of an invented one
- a `DESIGN.md` brand narrative
- an **`audit.md` drift report** — magic numbers, near-duplicate value clusters, harmonization recommendations with confidence tiers

This is what `screenslop learn` wants to be when it grows up. Our current extraction is regex-and-Markdown heuristics; tokextract parses the actual AST. Two adoption paths, in order of preference:

1. **Adopt the concepts**: DTCG as the design-profile token format, and "drift" as a first-class finding class — *this screen uses `#FF6B35`, the profile says the accent is `#E8590C`, confidence high.* Drift findings are deterministic and provable, which means they can ride the measured track, not the judgment track.
2. **Evaluate the tool itself** as a `learn` backend, per the standing note in `research/findings/source-candidates.md`: inspect its output contract first, wire nothing blindly.

The drift concept matters more than the tool. A critique grounded in *your app's actual tokens* beats one grounded in generic HIG defaults every time.

### swift-visual-testing — snapshot matrix as verify infrastructure

Declarative `@SnapshotSuite` / `@Snapshot` macros generate a device × theme × locale matrix with a `manifest.json`, a snapshot catalog, and an HTML gallery. That's our `matrix` command's ambition, already shipped as a Swift package. Mine it for:

- the manifest/catalog schema (compare with `schemas/matrix-report.schema.json`)
- the baseline-vs-fresh diff mechanism, which is exactly the `verify` step's shape

## Rule catalogs to load as priors

### Checkable thresholds (from impeccable, survive translation to screenshot + AX tree)

| Dimension | Threshold | Provable from |
|---|---|---|
| Contrast | 4.5:1 body, 3:1 large text (18px+/14px bold), 3:1 UI components | screenshot pixels |
| Touch target | 44×44pt minimum | AX frames (we already ship `layout.touch-target`) |
| Body text | ≥16px, never <12px; line-height 1.5–1.7 | AX font info |
| Type hierarchy | ≥1.25 ratio between steps; 3:1+ reads as strong, <2:1 reads as flat | AX font info |
| Spacing | 4pt base scale; tight grouping 8–12pt, section gaps 48–96pt | AX frames |
| Color distribution | 60/30/10 dominant/secondary/accent | screenshot histogram |
| Working memory | ≤4 competing items per group (nav items, form fields per cluster) | AX tree element counts |
| Motion | 150–300ms, exponential ease-out, no bounce/elastic | source only (runtime motion capture not shipped) |
| i18n headroom | 30–40% extra space for translated text | AX frames + stress capture |

### Named anti-pattern taxonomy (from ios-ui-design-skills and ios-hig-design)

Both repos ship severity-tagged catalogs with memorable rule names: **Hamburger Burial, Dead Buttons, Affordance Confusion, Flat Depth, Geometric Discord, Dead-End Empty State, Dark Pattern Settings**, plus HIG bans (hamburger menus where a tab bar fits, `.ignoresSafeArea()` misuse, stacked modals). Named rules beat numbered rules — `ax.missing-name` is our convention, and `layout.hamburger-burial` reads better than `layout.rule-17`. Use their taxonomy as naming inspiration when detectors grow.

### Liquid Glass (from liquid-glass-skill)

Post-cutoff iOS 26 API knowledge our fix path needs to not write broken code: `GlassEffectContainer` grouping requirements, glass-on-glass stacking bans, modifier ordering, `#available` fallbacks. Also the template for how platform idioms should live here: **versioned, checkable rules**, because Liquid Glass is today's idiom and something else is next year's.

### Anti-slop bans worth porting (impeccable + swiftui-design-skill)

The subset that translates to Apple UI: gradient text, default glassmorphism (now with a Liquid Glass-shaped exception that needs care), identical card grids, purple-blue AI gradients, emoji-as-icons, Inter/Roboto on Apple platforms where SF Pro belongs, modal-as-first-thought.

And impeccable's **category-reflex check**, run at two altitudes: first-order (could you guess the palette from the app category alone?) and second-order (could you guess the aesthetic from category-plus-anti-references?). Pure judgment-track material for the agent packet.

## Proposed new pillars

The current rubric: hierarchy, typography, color/contrast, layout/safe-areas, accessibility, interaction states, motion, platform fit, slop, performance risk. Two additions earned their place:

### Performance (upgrade from "risk" to measured)

`swiftui-performance-audit` splits code suspicion from trace-backed evidence and demands before/after metrics — the same epistemics as our verify loop. The logs we already capture in `see` carry hang and frame-drop signals. Findings become falsifiable: baseline evidence, fix, fresh evidence, compare. Upgrade the pillar from vague "risk" to measured where logs allow.

### Structural stability (new, and possibly the moat)

`swiftui-view-refactor` and `swiftui-ui-patterns` catalog source anti-patterns — unstable view identity from top-level `if/else` branch swapping, boolean-flag sheet racing, state-ownership confusion — whose *symptoms* are runtime-visible: flicker, lost scroll position, lost focus, wrong sheet presented, re-triggered animations.

A single screenshot can't see these. **An AX tree diffed across states can.** Web tooling has no equivalent of a running app's accessibility tree observed across interactions; this pillar is structurally unavailable to impeccable and pixelslop. It requires interaction capture (tap, then re-capture), which the runtime drivers already model (`tap`, `type` in the driver interface). Sequence it after the current MVP loop is proven on real apps — but sequence it.

## Provability triage

Every borrowed rule lands in exactly one lane. This is the discipline that keeps the design brain from corrupting the evidence engine:

| Lane | Proof standard | Examples |
|---|---|---|
| **Measured (runtime)** | deterministic from screenshot/AX/logs; eligible for `verified-fixed` | contrast ratios, touch targets, type scale ratios, spacing grid, element counts, token drift |
| **Source-assisted** | needs source or profile context; measured only with config | Liquid Glass API misuse, motion curves, structural anti-patterns (until AX-diff ships) |
| **Judgment (agent packet)** | LLM/human review; capped at `improved`/`needs-human-review` | personas, category-reflex, cognitive load beyond counting, "is this placement right" |

A rule that can't name its lane doesn't ship.

## What we deliberately did not adopt

- **The generative design skills** (`swiftui-design-skill`, `swift-ui-design`, `ios-design-swiftui`, `apple-app-ui-design`): "write me a beautiful screen" is not our job. We review what exists. Mined their anti-slop bans and one review rubric; left the rest.
- **UXpert-iOS-App**: the nearest product-shape duplicate — screenshot in, critique out, shipped iOS app. No AX tree, no logs, no fix/verify loop. Validates the concept, threatens nothing. Worth knowing it exists.
- **store-craft, designlint-skill's CRO layer, mobile-app-accessibility-audit**: App Store assets, conversion optimization, and a source-level a11y checklist. Peripheral. Widening scope because a repo was interesting is how tools die.
- **Impeccable's rule-sync architecture.** Their own `CLAUDE.md` documents five places every detection rule must stay manually in sync (engine, browser build, extension, site counts, skill text), and calls forgetting one "the most common mistake." That pain is a warning label. Our detectors stay in one place (`src/critique/detectors/`), rule metadata stays next to the rule, and anything derived is generated, not hand-synced.

## Sequencing (proposal, not plan)

1. **Token drift findings** — DTCG-shaped profile, drift as a measured finding class. Builds directly on `learn` and `designSources`; deterministic; highest value per effort.
2. **Threshold detectors** — type-scale ratio, spacing-grid conformance, element-count/working-memory checks from the AX tree. Extends the existing detector pattern without new capture capability.
3. **Persona packets** — persona checklists and category-reflex questions in the agent packet. Content work, near-zero engine work.
4. **Score rubric text + trend** — per-tier rubric language and cross-run score comparison in critique output.
5. **Structural stability** — AX-diff across interactions. Needs interaction capture; sequence after the MVP loop is proven on a real private app (the dogfood gate in `docs/repo-strategy.md` still comes first).

Each of these goes through the normal phase gates (`npm test`, smoke, doctor) and the redaction rules before it touches agent-facing output. Research is exciting; evidence is the product.
