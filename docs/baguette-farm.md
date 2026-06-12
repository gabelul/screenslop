# Baguette Farm

Baguette ships a local device-farm dashboard for booted simulators. Screenslop does not own that UI, but agents and Studio can use it as a live operator surface while Screenslop keeps the canonical proof in evidence bundles.

## Verified entrypoint

Start the Baguette server:

```bash
baguette serve
```

By default it binds to `127.0.0.1:8421`. The local CLI also supports an explicit host and port:

```bash
baguette serve --host 127.0.0.1 --port 8421
```

Open the farm:

```text
http://localhost:8421/farm
```

The installed Baguette build verified for this doc served:

- `GET /farm` as HTML.
- `GET /simulators.json` as JSON with `running` and `available` simulator arrays.
- `GET /simulators/<udid>` as the per-device focus page.
- `GET /simulators/<udid>/definition.json` as the per-device browser SDK bootstrap payload.

Do not document extra endpoint contracts from memory. Probe them first; some guessed paths return 404.

## What the farm is good for

Use the farm when you want a fast visual read across several booted simulators. The upstream README plus the served farm assets describe these operator affordances:

- Wall, grid, and list views for the simulator set.
- Filtering by platform, runtime, state, and search text.
- List sorting through sortable columns.
- Click a simulator tile to focus it for the higher-quality stream and input path.
- Keep small, normal, and large iPhones visible while checking layout risk.

This is especially useful before or during a `screenslop matrix` run. It lets a human or coding agent see whether the tiny phone, default phone, and Pro Max class surfaces are obviously different before deciding which capture needs the most attention.

## What it is not

The farm is not Screenslop proof.

Screenslop proof is still the bundle written by the CLI:

```bash
screenslop see --surface <surface> --json
screenslop critique artifacts/<run-id> --json
screenslop verify artifacts/<baseline-run-id> --fresh-bundle artifacts/<fresh-run-id> --json
```

Use the farm to observe and steer. Use Screenslop artifacts to make claims.

That boundary matters because a dashboard view can help you notice a clipped button, but it does not store the screenshot, AX tree, logs, finding IDs, or fresh-bundle comparison that an agent needs before saying a fix is verified.

## Device-size matrix thinking

For iPhone UI work, prefer a small / normal / large spread instead of only the newest default simulator:

- Small: compact iPhone class, useful for clipping and crowded sheets.
- Normal: the team's default iPhone target.
- Large: Pro Max class, useful for stretched layouts and weak hierarchy.

Screenslop's shipped matrix command has its own profile and report contract. Use `examples/matrix/phone-sizes.json` for a headless small / normal / large phone run. The Baguette farm is the live dashboard beside that work; it does not replace the matrix report or its evidence bundles.

## Studio boundary

Screenslop Studio can wrap this idea later as a polished multi-device preview and control surface. It should still call the public engine for capture, critique, fix, and verify.

No duplicate critique logic. No private fork of schemas. No Studio-only proof format.

## Safe agent wording

Good:

```text
I used Baguette farm to inspect all booted simulators, then ran Screenslop capture and verification for the claim.
```

Bad:

```text
The farm looked fixed, so the issue is verified.
```

If the farm is unavailable, record that as operator-dashboard unavailable. Do not downgrade to source-only Apple UI critique when runtime capture is still possible through the normal Screenslop path.
