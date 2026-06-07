# Command Model

Screenslop should not copy Impeccable's command names. The workflow is different because Screenslop can see the app.

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

This is the closest Screenslop equivalent to Impeccable's `init` + `document`, but stronger because it can use real screens.

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

Patches selected findings and recaptures evidence.

It should not fix everything by default. Pick the high-value findings first.

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
