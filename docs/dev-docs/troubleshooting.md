# Troubleshooting

Landmines we've already stepped on. Check here before debugging something that
feels familiar. This is not a changelog — it records what actually happened,
including the embarrassing parts, because the embarrassing parts are the useful
ones.

## Contrast findings that are simply wrong (fixed after 0.2.0)

**Symptom.** `critique` reports text as failing WCAG at a ratio a contrast
checker disagrees with. Small secondary labels are the worst affected. The
finding records a `sampledTextColor` that, measured against the background,
clears the threshold the finding says it fails.

**Root cause.** The reported ratio was computed from the mean luminance of each
pixel cluster:

```js
const ratio = contrastRatio(lowerMean, upperMean);
```

Most glyph samples land on anti-aliased edges, so the text cluster's mean sits
blended toward the background and the ratio comes out low. `representativeTextColor()`
already existed to recover the true glyph color — its result was recorded in the
finding and then ignored when computing the number.

**Fix.** Compute the ratio from the recovered glyph color and the attributed
background. `src/critique/detectors/contrast.mjs`.

**Why 318 tests missed it.** Every fixture painted text as crisp alternating
columns — `x % 2 === 0 ? color : surface` — with no blended pixels at all. With
no anti-aliasing, the cluster mean *is* the glyph color, so the broken line and
the correct one returned the same number in every test. The bug only existed on
real renders.

**Lesson.** A fixture that renders text more cleanly than a real renderer does
cannot test a detector that reads anti-aliased pixels. When a detector's
docstring explains a bias, check that something actually corrects it rather than
just apologising for it — the tiny-text caveat and the widened confidence bands
were compensation machinery built on top of a fixable bug.

## `see` captures the iOS home screen and reports success (fixed after 0.2.0)

**Symptom.** A clean evidence bundle — `capture.status: complete`, stability
`stable`, exit 0 — containing a screenshot of the springboard. `critique` then
scores Apple's home screen and files the findings against your project.

**Root cause.** `see` captured whatever the simulator was showing and never
asked what it was. Device selection resolves *which simulator*; nothing resolved
*which app*. Point it at a simulator where the app isn't installed and every
signal still reads clean.

**Fix.** The accessibility root already carries the frontmost app's display name
(empty on the springboard) — it just wasn't read. It's now compared against the
name resolved from the configured bundle id via `simctl listapps`. See
`src/evidence/foreground.mjs`.

**Gotcha worth keeping.** An app *absent* from a listing that succeeded is
decisive — it cannot be the app on screen. An app that can't be resolved because
`xcrun` is missing is not. Collapsing those two into "cannot verify" is what let
the springboard bundle through in the first draft of the fix.

**Lesson.** Three claims travel with every bundle — which device, which app,
which screen. Fixing the first one does not touch the other two.

## `verify` proves a fix against a different screen (fixed after 0.2.0)

**Symptom.** `verified-fixed` on a finding nobody fixed.

**Root cause.** `verify` matched findings by fingerprint across whatever pair of
bundles it was handed, with no check that they showed the same app or screen. A
finding "disappears" simply because its node path stopped matching. `--surface`
is a label the operator types and nothing validates, so an app resumed on a
different tab yields a bundle labelled `home` showing something else.

**Fix.** Captures record the screen's own heading; `verify` compares observed app
and heading and downgrades `verified-fixed` to `needs-human-review` on a
mismatch. `src/verify/subject-gate.mjs`.

**Deliberate limit.** Declared surface names are recorded but never compared.
They're claims — gating on them withdraws proof for a harmless rename, and would
have missed this bug entirely, since both bundles said `home`.

## Simulator name in config matches nothing

**Symptom.** `see` warns `Config targets "iPhone 17 Pro" but no simulator matched
it` and captures a different device.

**Cause.** Stock simulator names get renamed (`DL · 17 Pro (review device)`), so
a `defaultDevice` written months ago matches nothing. The fallback then picks the
first booted simulator, which may be the wrong one of several.

**Fix.** Pass `--udid`, or update `defaultDevice` to the current name. Note the
step is reported as `ok` with a warning message rather than as a failure — easy
to miss in a wall of `ok` lines.

## CI fails on `matrix --profile ... --json` with no simulator

**Symptom.** Exit 1 on CI, passes locally.

**Cause.** The unproven-cell gate counted cells that never reached a capture
attempt because the environment had no simulator. CI runs that invocation
*without* `--dry-run`; a local "CI mirror" that adds the flag doesn't reproduce
it. Fixed by treating `no-config`, `target-incomplete` and `dry-run` as
environment gaps rather than proof failures.

**Lesson.** Run the `run:` lines from `ci.yml` verbatim. A paraphrased mirror is
not a mirror.

## Matrix cells and the foreground gate — verified

Matrix cells capture through `collectSee`, so they inherit the frontmost-app
check. This was flagged as an untested interaction because both CI invocations
exit on environment gaps before reaching a capture, so no real cell had ever
exercised it — a regression there would have been invisible to the suite for the
same reason the contrast bug was.

Settled with a real single-cell run against a live app: `foreground-app` passes,
`targetIdentity` is `verified`, the cell captures, and matrix exits 0. Build and
launch settle comfortably before the capture fires.

If cells ever do start failing on `foreground-app`, the cause is the app not
being frontmost yet, and the fix is a settle-and-retry after launch — not
loosening the gate.

Note that `matrix --profile` refuses a path outside the project root, so a
throwaway profile belongs in the git-ignored `.screenslop/` directory.

**Known limit:** `screenTitle` takes the first heading-like label on screen. On a
screen whose first heading is the app's own name, two different screens can share
a title, so the subject gate can't tell them apart. It fails toward allowing the
comparison, which is the safe direction.
