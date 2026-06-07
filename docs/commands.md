# Command Model


## Core commands

### `screenslop init`

Sets up the project connection.

Use it for:

- runtime checks
- scheme / workspace / bundle ID detection
- Baguette / XcodeBuildMCP / simctl preferences
- artifact folder config
- default devices and matrix profiles
- optional context file creation

This is setup, not design learning.

### `screenslop learn`

Learns the app's design system from evidence and code.


Use it for:

- capturing representative screens
- reading accessibility trees
- scanning SwiftUI code
- extracting colors, typography, spacing, symbols, materials, motion patterns
- building or refreshing `DESIGN.md`
- writing app-specific review rules

Possible future flow:

```bash
screenslop learn --surface Settings
screenslop learn --from-artifacts artifacts/<run-id>
screenslop learn --tokens path/to/tokens.json
```

`tokextract` may fit here as a token-source adapter:

```text
token/design artifacts -> normalized tokens -> DESIGN.md seed
```

Do not wire it until its input/output contract is inspected.

### `screenslop see`

Captures evidence for the current screen.

Outputs:

- screenshot
- accessibility tree
- logs
- evidence manifest
- summary

### `screenslop critique`

Reviews evidence and produces findings.

Every finding needs a screenshot region, AX node, log line, source hint, or an explicit note that evidence is missing.

Agent JSON contract:

- `bundle`, `evidence`, and generated artifact paths are repo-relative when the bundle lives inside the current project root.
- Those paths are absolute when the bundle lives outside the current project root, such as a copied bundle in `/tmp`.
- Artifact reads prefer files next to the bundle before falling back to repo-root paths from the manifest. This keeps shared or copied bundles self-contained.

### `screenslop fix`

Plans and optionally applies selected safe fixes from a critique bundle.

Default behavior is conservative: it writes `fix-plan.json` and `fix.md` into the bundle, then edits nothing unless `--apply` is passed and confirmed. In non-interactive runs, `--apply` also needs `--yes`.

Common forms:

```bash
screenslop fix artifacts/<run> --dry-run
screenslop fix artifacts/<run> --finding <id> --source-root <app-root> --dry-run --json
screenslop fix artifacts/<run> --finding <id> --source-root <app-root> --apply --yes --label "Save settings" --json
screenslop fix artifacts/<run> --finding <id> --source-root <app-root> --apply --yes --verify-command "npm test"
```

Options:

- `--finding <id>` selects one finding. Repeat it or pass comma-separated IDs for more than one.
- `--source-root <path>` limits source search and patching to that app source tree.
- `--dry-run` writes the plan/report and does not edit source.
- `--apply` enables source edits for auto-fixable findings. It requires at least one `--finding`; dry-run is the only mode that can plan all findings at once.
- `--yes` confirms non-interactive apply runs.
- `--label <text>` supplies the replacement label for accessibility-label fixes.
- `--verify-command <command>` runs a bounded verification command and records pass/fail in `fix-session.json`.
- `--json` prints parseable JSON only and never prompts. Use `--yes` with `--json --apply`.

MVP auto-fixes are deliberately narrow:

- `ax.missing-name` with a unique `.accessibilityIdentifier(...)`, `.reviewID(...)`, or `sourceHint` line.
- `ax.generic-name` with the same source certainty and a supplied label.
- `layout.touch-target` with a unique source match and no existing nearby frame modifier.

Unsupported or ambiguous findings still appear in the fix plan, but Screenslop does not edit source for them. `layout.offscreen-frame`, `logs.*`, evidence-quality findings, visible-label-only matches, and duplicate source matches are manual in this MVP.

No fresh evidence means no verified fix claim. A passed `--verify-command` is recorded as `verify-passed`; only a future recapture/critique loop should use `recapture-passed`.

### `screenslop verify`

Checks whether previous findings were actually fixed.

No fresh evidence, no verified claim.

### `screenslop matrix`

Runs a surface across devices and settings:

- iPhone small / large
- iPad split width
- light / dark
- Dynamic Type normal / accessibility
- Reduce Motion
- Reduce Transparency

### `screenslop watch`

Future live loop for iterative design work.

This is where Baguette's stream view can become extremely useful.

## Short version

```text
init      connect the project
learn     understand the design system
see       capture evidence
critique  find issues
fix       patch selected issues
verify    prove the fix
matrix    test the screen under stress
watch     live iteration loop
```
