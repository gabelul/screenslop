# Skill Installation

Screenslop has two separate pieces:

1. The CLI engine, which runs commands like `screenslop doctor` and `screenslop see`.
2. The agent skill, which teaches Codex, Claude Code, Cursor, or another agent how to use the CLI without guessing.

Install both when you want an agent to review Apple UI. The skill does not replace the CLI, and the CLI does not install your private app config.

## Install the CLI

From GitHub:

```bash
npm install -g github:gabelul/screenslop#v0.1.0
screenslop doctor
```

From a checkout:

```bash
git clone https://github.com/gabelul/screenslop.git
cd screenslop
npm install
node bin/screenslop.mjs doctor
```

If you do not want a global install, run the CLI through the checkout:

```bash
node bin/screenslop.mjs see --dry-run --json
```

## Install the agent skill

The recommended path is the Skills CLI. Preview first:

```bash
npx skills add gabelul/screenslop --list
```

That should list one skill named `screenslop`. Then install it:

```bash
npx skills add gabelul/screenslop --skill screenslop
```

Use the Skills CLI flags when you need a specific scope:

```bash
npx skills add gabelul/screenslop --skill screenslop --global
npx skills add gabelul/screenslop --skill screenslop --agent '*' --yes
npx skills add gabelul/screenslop --skill screenslop --copy
```

The Skills CLI is only a file-placement step. It does not run Screenslop, does not create `.screenslop/config.json`, and does not connect a private app.

## Manual install

If you prefer a manual install, clone the repo and copy or symlink the whole `skills/screenslop` folder. Do not install only `SKILL.md`; the skill links to bundled reference files.

```bash
git clone https://github.com/gabelul/screenslop.git
cd screenslop
```

Claude Code, user-level:

```bash
mkdir -p ~/.claude/skills
ln -s "$PWD/skills/screenslop" ~/.claude/skills/screenslop
```

Codex CLI, user-level:

```bash
mkdir -p ~/.codex/skills
ln -s "$PWD/skills/screenslop" ~/.codex/skills/screenslop
```

Generic agent skill folder. Use this for agents that read `~/.agents/skills`; Codex should use `~/.codex/skills` instead:

```bash
mkdir -p ~/.agents/skills
ln -s "$PWD/skills/screenslop" ~/.agents/skills/screenslop
```

Project-level installs are useful when your host supports repo-local skills and you want to avoid user-level state:

```bash
mkdir -p .claude/skills .codex/skills
ln -s "$PWD/skills/screenslop" .claude/skills/screenslop
ln -s "$PWD/skills/screenslop" .codex/skills/screenslop
```

Cursor and other IDE agents vary. If the IDE can read skills from a local folder, point it at the whole `skills/screenslop` folder or at `skills/screenslop/SKILL.md` plus its `reference/` directory. If not, use the CLI commands from `docs/agent-playbook.md` as project instructions.

## First run inside an agent

Tell the agent to read:

```text
skills/screenslop/SKILL.md
docs/agent-playbook.md
```

If the agent host does not auto-load skills, ask it to run the shipped
bootstrap contract instead of pasting rules by hand:

```bash
screenslop instructions --agent codex
```

Then run:

```bash
screenslop doctor
screenslop setup --json --dry-run
```

If setup returns `status: "ready"`, review the planned config and write it only after approval:

```bash
screenslop setup --json --yes
```

If running from a checkout:

```bash
node bin/screenslop.mjs doctor
```

A healthy setup prefers this runtime order:

```text
Baguette -> XcodeBuildMCP -> xcodebuild/simctl -> manual evidence
```

In v0.1, live `screenslop see` capture still needs Baguette. Do not quietly swap to source-only critique and call it the same thing.

## Private app config is separate

Private target config lives in `.screenslop/config.json` inside the app repo you want to inspect. It can contain workspace paths, bundle IDs, source roots, screenshots, and artifact paths, so do not commit it.

Create or preview config separately from skill installation:

```bash
screenslop setup --json --dry-run
```

`setup` is configuration only. It does not prove the UI is good and it does not run a private dogfood fix loop. Proof starts with runtime capture.

For private dogfood, use a local ignored config in the app repo and pass its path explicitly from the Screenslop checkout. The smoke runner resolves `--config` from the Screenslop repo, so use an absolute path or a relative path from this checkout:

```bash
node scripts/smoke-real-runtime.mjs \
  --config /path/to/private-app/.screenslop/config.json \
  --identifier <stable-accessibility-identifier> \
  --preflight-only
```

A sample app smoke proves the sample app only. A private app needs its own capture, fresh critique, and `verifyStatus: "verified-fixed"` before anyone says the real app is fixed.

## Troubleshooting

If an agent cannot find the skill:

1. Confirm the CLI works with `screenslop doctor`.
2. Confirm the skill folder contains `SKILL.md`.
3. Confirm the host runtime is looking at the same scope you installed into: user-level or project-level.
4. For manual symlinks, replace an old link before creating a new one:

```bash
rm ~/.codex/skills/screenslop
ln -s "$PWD/skills/screenslop" ~/.codex/skills/screenslop
```

Only remove the `screenslop` symlink you created. Do not delete whole agent skill folders.
