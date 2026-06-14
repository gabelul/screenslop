# Screenslop Install Contract

The Screenslop skill is an instruction layer. The CLI must also be installed.

## Quick path

```bash
npm install -g screenslop@latest
screenslop doctor
npx skills add gabelul/screenslop --list
npx skills add gabelul/screenslop --skill screenslop
screenslop instructions --agent codex
```

`--list` is the safe preview. It should show one skill named `screenslop`.
`screenslop instructions` prints the same agent contract from the shipped CLI when a host does not auto-load the skill.

Skill updates do not update the CLI binary. If `screenslop doctor` reports an
older CLI, run:

```bash
npm install -g screenslop@latest
```

If global installs are blocked, call the current CLI through npm:

```bash
npx -y screenslop@latest doctor
```

## Manual paths

Common user-level paths:

```text
~/.codex/skills/screenslop
~/.claude/skills/screenslop
~/.agents/skills/screenslop
```

Project-level paths, when the host supports them:

```text
.codex/skills/screenslop
.claude/skills/screenslop
```

The target should point at `skills/screenslop`, not the repo root.

## Boundaries

- Do not put `.screenslop/config.json` in the skill folder.
- Do not commit private app paths, bundle IDs, screenshots, or dogfood reports.
- Do not treat sample runtime smoke as private app proof.
- Do not claim non-Baguette `see` fallback is shipped in v0.1.

For the full install notes, read `docs/skill-installation.md` from the Screenslop repo checkout or package docs. If this skill was installed alone, this file is the local install reference.
