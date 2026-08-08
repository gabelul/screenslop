# Upgrading

Behaviour changes worth knowing about before you upgrade. Screenslop is 0.x, so
these land without a major bump — but they change what commands return, which
matters if anything automated reads them.

## 0.2.0 → next

Three changes, all from pointing 0.2.0 at a real SwiftUI app for the first time.
Each one was invisible to the test suite and obvious within twenty minutes of a
real capture.

### Contrast findings you had before may have been wrong

The reported contrast ratio was computed from the mean of each pixel cluster.
Most glyph samples land on anti-aliased edges, so the text mean sat blended
toward the background and the ratio came out low — inventing failures for text
that passes.

Two labels in a real app measured 4.1:1 and 4.2:1 and were flagged P2. Their
recorded colors against the sampled background are 5.24:1 and 7.01:1.

The bias only ever ran one way, so **no real failure was ever missed** — but
expect fewer findings, and expect some previously "failing" text to stop being
reported. The damage was downstream: `verify` re-measured with the same skew, so
a genuinely fixed color could still report `still-present`.

Findings where the glyph color could not be attributed now say the ratio is a
floor rather than presenting a blended average as a measurement.

### `see` fails when the app on screen isn't the configured one

`see` captured whatever the simulator was showing. Pointed at a simulator where
the app wasn't installed, it captured the iOS home screen and reported a
complete, stable capture.

Captures now compare the accessibility root's app name against the name resolved
from `defaultBundleId`, and exit non-zero on a mismatch.

- The configured app **not installed** on the target simulator is a mismatch.
- No `defaultBundleId`, or no `xcrun`, is `unverified` — recorded, not failed.
- Every bundle now records the app it saw, even when it can't be checked.

**If you script `see`:** a project with `defaultBundleId` set and the app not
running will now fail where it used to pass. Launch the app first.

### `verify` won't prove a fix across two different screens

`verify` matched findings by fingerprint across any two bundles, with no check
they showed the same app or screen. `--surface` is an unvalidated label, so an
app resumed on a different tab produced a bundle named `home` showing something
else — and a finding that "disappeared" returned `verified-fixed`.

Captures record the screen's own heading. When the observed app or heading
differs between baseline and fresh, `verified-fixed` becomes
`needs-human-review` and `still-present` drops from high to medium confidence.

Bundles predating this carry no heading, and an unrecorded value never counts as
a disagreement — older baselines still verify as before.

## 0.1.10 → 0.2.0

Four changes can alter an exit code or a status you were already relying on. All
four make Screenslop claim *less* than it used to, which is the point: the old
behaviour reported success in cases it could not actually prove.

### `see` exits non-zero when a capture cannot be proven still

`see` now takes a second throwaway frame after the accessibility tree and
compares it to the screenshot. If the screen was moving — a transition, a
loading state, a spinner — the capture is recorded as `capture.status: partial`
and the command exits non-zero.

The bundle is still written and still inspectable. It simply stops claiming to
be a settled capture, because findings derived from a moving frame describe a
frame no user ever saw: layout math reads positions that were still sliding,
contrast reads colours that were still fading.

**If you script `see`:** a non-zero exit no longer means "capture failed". It
can also mean "captured, but not proven". Read `capture.status` and
`capture.stability` to tell them apart.

### `verify` no longer returns `verified-fixed` without proven stability

`verified-fixed` is a proof label, and only a fresh capture measured as `stable`
earns it. Three cases now return `needs-human-review` instead:

- the fresh capture was measured **unstable**
- the stability probe **failed** (`unknown`)
- the bundle **predates this check entirely** and has no stability field

That third case is the one that will surprise you: **bundles captured with
0.1.10 or earlier will verify as `needs-human-review`, not `verified-fixed`.**
They are still readable and still comparable — they just never established that
their fresh capture was still, so they cannot claim deterministic proof.
Recapture with the new version to get `verified-fixed` back.

A `still-present` finding keeps its status on an unstable capture but drops to
`medium` confidence, because motion can invent a finding as well as hide one — a
label caught mid-fade measures a contrast it never has at rest.

### `matrix` exits non-zero when any cell is unproven

A matrix cell claims "built this, then captured it". It can only claim that when
the build and the capture agree on which simulator they touched. Cells now carry
`targetIdentity`:

- `verified` — both ends named the same device; counts as `captured`
- `mismatch` — they named different devices; the cell **fails**
- `unverified` — the build tool reported no identity, so the two resolved a
  simulator name independently; the cell is `unavailable`

Unverified cells are **still captured and still critiqued** — you keep the
evidence and the findings. They are excluded from `summary.captured`, and any
failed or unverified cell makes `report.ok` false, so the run exits non-zero.

Previously a run with five verified cells and one unverified cell exited zero.

### Device selection follows config before whatever is booted

`see` now honours `defaultDevice` from `.screenslop/config.json`, matching what
`matrix` already did. A booted simulator no longer wins by default — a stray
simulator left running would otherwise hijack the capture and produce a bundle
for the wrong app.

- `--udid` and `--device` still take precedence over config.
- A `--device` or `--udid` naming nothing is an error.
- A `defaultDevice` naming nothing warns and falls back.
- A name matching **several** simulators (two `iPhone 17 Pro` on different
  runtimes is a stock setup) is now an error rather than a silent pick of the
  first one. Pass `--udid` to disambiguate.

## Operational notes

**Evidence bundles are larger.** Captures now request maximum JPEG quality
instead of accepting the runtime's 0.85 default. Measured against a lossless
reference, that cuts worst-case channel error from 71/255 to 6/255 — which
matters because pixel rules sample exactly the antialiased text edges where the
error concentrated. Screenshots run roughly 2.4× the previous size.

**`--help` no longer runs the command.** `screenslop see --help` used to fall
through and capture — booting a simulator to answer a question about flags. Any
script relying on that (unlikely, but it worked) now gets help text and exit 0.

**Design review packets carry capture state.** `captureStatus` and
`captureStability` are now in the packet JSON and the generated prompt, so an
agent judging a screenshot knows whether that screenshot can be trusted.
