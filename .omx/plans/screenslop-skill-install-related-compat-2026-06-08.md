# Screenslop Skill Installation and Related-Repo Compatibility Plan

Date: 2026-06-08  
Mode: planning only, no engine implementation yet  
Scope: Screenslop public engine repo, agent skill install UX, sibling-tool compatibility notes

## Requirements Summary

Build the next plan for making Screenslop easier for coding agents to install and use, without weakening the runtime-first Apple UI contract.

The work should answer four practical questions:

1. How should a user install the Screenslop CLI?
2. How should Codex, Claude Code, Cursor, and generic agents install or discover the Screenslop skill?
3. Which patterns should Screenslop copy from sibling tools like Pixeltamer, Pixelslop, Stitch Kit, Slopbuster, and Claude Code Skill Activator?
4. What must stay out of scope until the private real-app dogfood gate passes?

This plan is intentionally engine-only. Do not start Screenslop Studio, do not add private wrapper files, and do not claim private-app proof from sample-app smoke tests.

## Current Evidence

### Screenslop current state

- Screenslop already ships the CLI bin as `screenslop` in `package.json:6-8`.
- The npm package whitelist includes `skills/` plus the agent docs in `package.json:21-34`.
- README currently documents CLI install from GitHub and local development, but not a real multi-agent skill install flow, in `README.md:15-38`.
- README says Screenslop works with Codex, Claude Code, Cursor, terminal workflows, Baguette capture, and XcodeBuildMCP build/run support in `README.md:9-11`.
- README locks the runtime-first rule and Baguette-first priority in `README.md:105-114`.
- README keeps Studio blocked until private dogfood proves one real-app finding as `verified-fixed` and passes redaction checks in `README.md:197-206`.
- The agent playbook already defines the safe loop for agents in `docs/agent-playbook.md:50-85`.
- The playbook tells Claude Code and Cursor/generic IDE agents to use the same CLI contract in `docs/agent-playbook.md:102-124`.
- The playbook defines private real-app dogfood and the redaction check in `docs/agent-playbook.md:182-226`.
- The skill is concise and points to longer references in `skills/screenslop/SKILL.md:1-53`.
- The command docs say `.screenslop/config.json` is ignored because it can contain private paths, and config writes require explicit safe flags in `docs/commands.md:22-70`.
- The command docs say `verify` compares fresh evidence but does not capture it in `docs/commands.md:163-196`.

### Related repo findings

- Pixeltamer uses `npx skills add gabelul/pixeltamer-gpt-image-skill` as the recommended one-command skill install in `pixeltamer/README.md:17-23`.
- Pixeltamer documents manual symlink paths for Claude Code, Codex CLI, generic agents, and project-level Claude installs in `pixeltamer/README.md:28-42`.
- Pixeltamer clearly separates install-time file placement from first-invocation setup in `pixeltamer/README.md:46-67`.
- Pixeltamer documents supported agent paths in `pixeltamer/README.md:169-178`.
- Pixeltamer ships troubleshooting for the known Skills CLI executable-bit problem in `pixeltamer/README.md:193-218`.
- Pixelslop uses a purpose-built installer: `npx pixelslop install`, then `doctor`, `status`, `update`, and `uninstall`, documented in `pixelslop/README.md:16-33`.
- Pixelslop’s install is interactive by default and detects Claude Code and Codex CLI in `pixelslop/README.md:16-24`.
- Pixelslop documents project-scoped and runtime-specific install flags in `pixelslop/docs/getting-started.md:16-29`.
- Pixelslop’s installer has a manifest-backed install/update/status model and knows Claude/Codex skill paths in `pixelslop/bin/pixelslop.mjs:578-651`.
- Stitch Kit uses `npx @booplex/stitch-kit` as a richer installer that can configure agent files and MCP setup in `stitch-kit/README.md:19-35`.
- Stitch Kit documents manual Claude plugin and Codex setup, including MCP configuration, in `stitch-kit/README.md:36-85`.
- Stitch Kit’s `AGENTS.md` defines the reusable skill-directory structure and progressive-disclosure pattern in `stitch-kit/AGENTS.md:9-24`.
- Stitch Kit’s `AGENTS.md` also documents one-command install, update, and status in `stitch-kit/AGENTS.md:26-35`.
- Claude Code Skill Activator is a public repo that extracts keywords from `SKILL.md` once, writes an index, then matches prompts offline; its README describes that flow in `claude-code-skill-activator/README.md:7-14`.
- Claude Code Skill Activator is installed through an interactive `python install.py` wizard according to `claude-code-skill-activator/README.md:16-39`.

## Planning Principles

1. Keep Screenslop’s CLI as the stable integration seam.
2. Do not make agent install mutate private app config or dogfood artifacts.
3. Prefer a small installer/checker over long manual docs that drift.
4. Keep skill install separate from runtime target config.
5. Copy the sibling-tool patterns that reduce friction, not their whole architecture.

## Decision Drivers

1. **Agent adoption:** Codex, Claude Code, Cursor, and terminal users need a clear first-run path.
2. **Privacy:** private `.screenslop/config.json`, screenshots, bundle IDs, and reports must stay out of git and public output.
3. **Maintenance:** every install path needs a health check so docs and shipped files do not silently drift.

## Viable Options

### Option A — Docs-only skill install polish

Update README, agent playbook, and skill references with exact install paths and commands.

Pros:

- Smallest change.
- Low risk.
- Good enough for advanced users.

Cons:

- Still asks users to copy/symlink manually.
- No manifest, update, status, or uninstall path.
- More likely to drift across agent runtimes.

### Option B — Skills CLI first, with manual fallback

Adopt Pixeltamer’s model: document `npx skills add gabelul/screenslop`, then provide manual symlink fallbacks for Claude Code, Codex CLI, and generic agents.

Pros:

- Reuses a cross-agent standard already proven by Pixeltamer.
- Very little custom installer code.
- Good match for a repo that already packages `skills/`.

Cons:

- Depends on the external Skills CLI behavior.
- Needs executable-bit troubleshooting if Scripts CLI issues apply.
- May not handle Screenslop’s CLI binary install and skill install as one coherent flow.

### Option C — Screenslop-owned installer subcommand

Add `screenslop install-skill`, `screenslop skill-status`, and later `screenslop uninstall-skill`, borrowing Pixelslop’s manifest-backed model but keeping it smaller.

Pros:

- One project-owned UX.
- Can verify the CLI and skill are aligned.
- Can detect Claude/Codex paths and write a manifest for status/update.
- Can keep install separate from private target config.

Cons:

- More code than docs-only.
- Needs tests across global and project scopes.
- Must avoid becoming a general plugin manager.

### Recommended path

Use a staged hybrid:

1. Ship docs/manual install first, including Skills CLI guidance if compatible.
2. Then add a small `screenslop install-skill` helper only if the docs/manual path proves annoying or if sibling repo patterns show it will save maintenance.

Do not build a full Pixelslop-style installer in the first pass unless the simple plan reveals real friction. Screenslop is still proving the engine; the installer should not become the product.

## Implementation Steps

### 1. Add an explicit skill installation doc

Create `docs/skill-installation.md`.

Content:

- CLI install from GitHub and local checkout.
- Skill install concepts: CLI install is not the same as agent skill install.
- Supported agent targets:
  - Codex CLI: `~/.codex/skills/screenslop` or project `.codex/skills/screenslop` if supported by the user’s runtime.
  - Claude Code: `~/.claude/skills/screenslop` or project `.claude/skills/screenslop`.
  - Generic agents: `~/.agents/skills/screenslop`.
  - Cursor: use the CLI plus project instructions; skill support varies, so do not pretend one path is universal.
- Manual symlink commands from a local checkout.
- Optional Skills CLI path if validated:
  ```bash
  npx skills add gabelul/screenslop
  ```
- First-run check:
  ```bash
  screenslop doctor
  ```
- Project target setup stays separate:
  ```bash
  screenslop init --json --dry-run
  ```
- Hard privacy warning: never commit `.screenslop/config.json` or dogfood artifacts.

Acceptance criteria:

- The doc clearly distinguishes CLI install, skill install, and private app target config.
- It includes Codex, Claude Code, Cursor/generic, and terminal usage.
- It includes manual fallback commands even if Skills CLI support works.
- It does not claim private dogfood has passed.

### 2. Update README install section without bloating it

Edit `README.md`.

Add a compact “Agent skill install” subsection after CLI install.

It should link to `docs/skill-installation.md` and keep README short:

```bash
npm install -g github:gabelul/screenslop#v0.1.0
screenslop doctor
```

Then:

```bash
# Agent skill install details
open docs/skill-installation.md
```

If Skills CLI support is validated during execution, include:

```bash
npx skills add gabelul/screenslop
```

Acceptance criteria:

- README stays short.
- Existing runtime-first and Studio-block language remains intact.
- Related-project section is updated only if wording needs clarity.

### 3. Update the agent playbook with install paths

Edit `docs/agent-playbook.md`.

Add a concise section near “Agent setup”:

- Check CLI:
  ```bash
  screenslop doctor
  ```
- Check skill source:
  ```text
  skills/screenslop/SKILL.md
  ```
- If using a packaged/global skill, link to `docs/skill-installation.md`.
- For Claude/Codex prompts, tell agents to read `docs/skill-installation.md` before private dogfood.

Acceptance criteria:

- The playbook still starts with runtime evidence, not install ceremony.
- It does not turn Screenslop into a Claude-only or Codex-only workflow.
- It keeps the private dogfood stop rules.

### 4. Add a compact install contract reference for the skill

Create `skills/screenslop/reference/install.md` or extend `skills/screenslop/reference/agent-contract.md` if the new text is short.

Recommended content:

- “This skill is an instruction layer. The CLI must also be installed.”
- “If the host cannot auto-load this skill, manually point the agent at `skills/screenslop/SKILL.md` and `docs/agent-playbook.md`.”
- Exact paths for common runtimes.
- Do not put private `.screenslop/config.json` into the skill directory.

Acceptance criteria:

- `skills/screenslop/SKILL.md` stays short and links to the reference.
- The reference is included in `package.json` through the existing `skills/` whitelist.

### 5. Decide whether `screenslop install-skill` is needed now

Run a focused implementation spike, but do not commit the helper unless it earns its keep.

Investigate:

- Whether `npx skills add gabelul/screenslop` can install a repo that also ships a CLI package.
- Whether it can install only `skills/screenslop` from the repo or expects the repo root to be the skill root.
- Whether executable permissions matter for Screenslop’s skill path. Screenslop skill currently has no dispatcher script inside the skill, so Pixeltamer’s executable-bit issue may not apply.
- Whether Codex can discover project-level `.codex/skills/screenslop` reliably in this environment.
- Whether Claude Code needs plugin-style packaging or simple skills directory placement is enough.

If the spike says a helper is useful, plan a second implementation slice:

```bash
screenslop install-skill --global --codex --claude --copy|--symlink
screenslop install-skill --project --codex --claude --copy|--symlink
screenslop skill-status --json
```

Acceptance criteria for helper decision:

- Decision recorded in `docs/skill-installation.md`.
- If deferred, explain why manual/Skills CLI path is enough for v0.1.
- If accepted, write a separate implementation plan before coding the helper.

### 6. Add contract tests for docs/skill consistency

Extend `tests/contracts.test.mjs`.

Check that:

- README links to `docs/skill-installation.md`.
- The agent playbook links to the skill install doc.
- `skills/screenslop/SKILL.md` links to the install reference if added.
- The docs do not claim non-Baguette `see` fallback is shipped.
- The docs do not claim sample runtime smoke proves private app dogfood.
- The docs mention `.screenslop/config.json` must not be committed.

Acceptance criteria:

- `npm test` fails if the install docs drift away from the runtime-first contract.
- Tests remain string/contract checks, not brittle prose snapshots.

### 7. Optional related-repo compatibility note

Add a short section to `docs/agent-integrations.md` or `docs/skill-installation.md` called “Sibling tool compatibility”.

State the intended relationship:

- Pixeltamer is for image generation and can help with Screenslop README/banner assets, but not runtime UI proof.
- Pixelslop is the web/browser visual QA sibling; Screenslop is the Apple runtime sibling.
- Stitch Kit is for design generation and conversion, including SwiftUI ideas, but Screenslop verifies real rendered Apple UI.
- Slopbuster is for prose/comment/doc cleanup.
- Claude Code Skill Activator can index the Screenslop skill after install; it should not replace the runtime evidence loop.

Acceptance criteria:

- The section prevents tool confusion.
- It does not turn Screenslop into a meta-tool launcher.
- It links only to public sibling repos.

### 8. Verify package and install surface

Run after docs/test changes:

```bash
npm run cleanup:macos:dry
node bin/screenslop.mjs doctor
npm test
npm pack --dry-run
npm run --silent smoke:package
```

If an install helper is added later, add targeted helper tests and include them in `npm test`.

### 9. Commit and push

Use a narrow conventional commit:

```bash
git add README.md docs/agent-playbook.md docs/skill-installation.md docs/agent-integrations.md skills/screenslop/SKILL.md skills/screenslop/reference/ tests/contracts.test.mjs package.json
git commit -m "docs: document Screenslop skill installation"
git push origin main
```

Adjust the file list to actual changes.

## Acceptance Criteria

- `docs/skill-installation.md` exists and explains CLI install, skill install, and private app config as separate things.
- README links to the install doc without becoming a giant install manual.
- Agent playbook tells Codex, Claude Code, Cursor/generic agents, and terminal users how to start.
- Screenslop skill stays compact and points to references instead of duplicating all docs.
- Package whitelist continues to include shipped skill/docs surfaces.
- Contract tests guard the install doc and runtime-first claims.
- No Studio files are added.
- No private app config, dogfood report, screenshot, bundle ID, or local app path is committed.
- Verification passes locally: cleanup dry-run, doctor, npm test, npm pack dry-run, smoke package.
- CI passes after push.

## Risks and Mitigations

- **Risk: Skills CLI expects the repo root to be a skill root.**  
  Mitigation: validate before documenting `npx skills add`; otherwise keep manual symlink docs.

- **Risk: We build a full installer too early.**  
  Mitigation: default to docs/manual install first; only add `screenslop install-skill` if the spike proves real friction.

- **Risk: Agent skill install gets confused with private app target config.**  
  Mitigation: docs must say skill install teaches agents; `.screenslop/config.json` connects a private app and stays ignored.

- **Risk: Sibling tools blur product scope.**  
  Mitigation: position each sibling by domain and keep Screenslop focused on Apple runtime UI evidence.

- **Risk: Runtime claims drift while editing install docs.**  
  Mitigation: extend contract tests to assert Baguette/fresh-bundle/private-dogfood language.

## Verification Steps

Planning verification:

```bash
git diff --check .omx/plans/screenslop-skill-install-related-compat-2026-06-08.md
```

Implementation verification:

```bash
npm run cleanup:macos:dry
node bin/screenslop.mjs doctor
npm test
npm pack --dry-run
npm run --silent smoke:package
```

If the Skills CLI path is documented, also verify the command in a temp directory or disposable agent-skill root before committing the claim.

## Suggested Execution Path

Use `$oh-my-codex:ultragoal` for durable execution because this touches docs, package surface, tests, and maybe an install-spike decision.

Recommended next command:

```text
$oh-my-codex:ultragoal Execute .omx/plans/screenslop-skill-install-related-compat-2026-06-08.md
```

If execution wants parallel review, use Team + Ultragoal:

- `explorer`: validate Skills CLI behavior and current agent skill paths.
- `docs`: update README, agent playbook, and install docs.
- `tester`: add contract tests.
- `reviewer`: check install claim accuracy and package surface.
- `security`: check private path/config/report leak risks.

Ultragoal remains the durable ledger owner. Team workers return evidence; the leader checkpoints completion.

## Stop Rules

Stop and report instead of committing if:

- Skills CLI behavior cannot be validated but docs would claim it works.
- Any generated install docs include private local paths or private bundle IDs.
- Any change suggests Screenslop Studio work before private dogfood proof.
- Verification fails.
- CI fails after push.
