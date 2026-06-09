# Project Setup

`npx skills add` installs the Screenslop skill. It does not create private app config.

Run first-use setup from the app repo:

```bash
screenslop setup --json --dry-run
```

If the JSON says `status: "ready"`, show the planned config to the user. Write only after approval:

```bash
screenslop setup --json --yes
```

If the JSON says `status: "needs-selection"`, pass the target fields explicitly and dry-run again:

```bash
screenslop setup \
  --project PetPacket.xcodeproj \
  --scheme PetPacket \
  --bundle-id com.booplex.petpacket \
  --source-root PetPacket \
  --surface Onboarding \
  --json \
  --dry-run
```

`.screenslop/config.json` is project-local and private. Do not commit it.

Setup is not proof. Proof starts with runtime capture:

```bash
screenslop see --surface <surface> --boot --json
screenslop critique artifacts/<run-id> --json
```

A fix is only proven after fresh capture, fresh critique, and `screenslop verify`.
