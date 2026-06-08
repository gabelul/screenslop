# RuntimeSmoke sample app

RuntimeSmoke is the tiny iOS app used by `npm run smoke:runtime`.

It intentionally ships with one fixable accessibility issue on `runtimeSmoke.saveButton`: the save button has a stable accessibility identifier, but the baseline source does not give it a spoken label. The real-runtime smoke builds and launches this app, captures Baguette evidence, applies a narrow Screenslop fix, rebuilds, recaptures, critiques again, and verifies the selected finding against fresh evidence.

This app only proves the public Screenslop engine loop. It does not prove a private user app is fixed.
