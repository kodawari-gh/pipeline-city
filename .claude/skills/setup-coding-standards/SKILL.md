---
name: setup-coding-standards
description: Set up pedantic, enforced coding standards for every language in the repo (lint, types, format, dead code, architecture, spelling, secrets, commits), baseline the existing violations, gate new code, and ticket the burn-down. Rerun when a language is added.
disable-model-invocation: true
---

# Setup coding standards

Agents write most of the code, so the standards can be **pedantic**: the strictest preset of each tool, errors not warnings, and no rule disabled for taste. A rule earns an exception only when it contradicts another tool (a formatter conflict) or the language's own idiom. The gate stays **green on old code and red on new violations** through a **baseline** that only shrinks.

Tool choices per language and per concern: [TOOLS.md](TOOLS.md). Read the rows for the languages you find.

Bundled scripts (this folder, used by the repo through `package.json` scripts):

- `ratchet.mjs <name> -- <command>`: a baseline for any checker that lacks one. Counts violations per file and rule in `.baseline/<name>.json`; fails on new ones and on stale counts. `RATCHET_UPDATE=1` shrinks, `RATCHET_UPDATE=init` writes. Parsers: `tsc oxlint stylelint markdownlint ruff knip cspell`; add one when a tool needs it.
- `check.mjs [--fix] [--update-baselines]`: runs every `check:*` script in parallel (after every `fix:*` with `--fix`) and prints one line per gate.

Name each gate `check:<gate>` and each fixer `fix:<name>`, then `check`, `fix` and `baseline:update` call `check.mjs`.

## Steps

### 1. Inventory

- Languages: `git ls-files | sed -n 's/.*\.\([^./]*\)$/\1/p' | sort | uniq -c | sort -rn`. Count config files (YAML, JSON, workflows, Dockerfiles) as languages too.
- Toolchains on this machine (`node`, `python`, `uv`, `go`, `cargo`, ...) and package managers in use.
- Existing standards: linter and formatter configs, type checker flags, `.editorconfig`, git hooks, CI jobs, scripts named `lint`, `format`, `check`.
- The repo's agent docs (`CLAUDE.md` / `AGENTS.md`): which commands agents already run, and any rule a tool would contradict.

Done when every tracked file type maps to a row in TOOLS.md or to "no tool" with a reason.

### 2. Plan and confirm

Show one table: concern, tool, preset, files covered, baseline mechanism. Tighten an existing tool before you replace it. Name any extra tool that needs a binary outside the package manager. Check each tool's peer dependencies against the repo's compiler version before you propose it (TOOLS.md names known gaps). Exclude vendored or imported material (design packages, generated files). Ask the user to confirm or cut rows.

### 3. Install and configure

- Pin every tool as a dev dependency of the repo's own package manager where one exists, so CI and agents get the same versions.
- Configs live at the repo root, one per tool, in the tool's preferred format.
- Add two entry points to the repo's script runner (`package.json` scripts, `Makefile`, `justfile`, ...):
  - `check`: every gate below, read-only, non-zero exit on any failure. Fast gates first.
  - `fix`: every auto-fixer and formatter, then `check`.

### 4. Format once

Run the formatter over the whole repo twice (Prettier is not idempotent on long member chains; the second pass settles them), then until `format --check` passes. Then run the full test suite, slow tiers included: tests that read source files as text break on a reformat. Fix such a test to read statements, not lines (collapse whitespace, accept either quote style), never the source back to its old layout. Commit the format alone ("format only, no behaviour change") and add its hash to `.git-blame-ignore-revs`. Formatting is never baselined.

This step changes layout only. Auto-fixers that change code (lint `--fix`) belong to the burn-down, behind the test suite.

### 5. Baseline

For each linter, record today's violations with the baseline mechanism in TOOLS.md. The baseline file is committed. The gate must fail when:

- new code adds a violation, and
- a baselined violation is gone but still recorded (the baseline must be pruned, so it only shrinks).

Type checker flags: turn on every strict flag in TOOLS.md now, and baseline the errors (`ratchet.mjs tsc` for TypeScript). Any script that ran the bare checker (`typecheck`, `build`) must call the baselined gate instead, or it fails on day one.

Inline suppressions need a reason (`-- <why>` or the tool's equivalent), enforced by a rule where the tool has one.

### 6. Enforce

- **Pre-commit hook** (lefthook): format the staged files, then the fast baselined gates (types, lint) on the whole repo, since a baseline is per file and rule, not per staged line. Commit-message rules on `commit-msg`. It must finish in seconds; the full `check` belongs in CI.
- **CI**: one job runs `check` on every push and pull request.
- **Agents**: add `check` (or the fast part of it) to the commands the repo's agent docs make agents run before a commit, and to the swarm reviewer's checks (`docs/agents/board.md` repo notes when a board exists).

### 7. Burn down

Group the baseline by rule, then by folder, into tickets small enough for one agent context. Each ticket: remove its slice from the baseline and fix the code. Plan mechanical rules on Haiku and type-level rules on Sonnet. Publish them under one parent issue with `to-tickets` conventions (when the repo has a tracker).

### 8. Document

Write `docs/agents/coding-standards.md`: what `check` and `fix` run, where each config lives, how the baseline works, how to add a reasoned suppression, and the rule exceptions with their reason. Point to it from the repo's agent docs in one line.

## Done when

- `check` passes on a clean tree.
- For each gate, a planted violation in a scratch change makes `check` fail. Plant, run, revert. Report the gates that stayed green as broken.
- The hook, the CI job, the baseline files, the docs and the burn-down tickets exist and are committed.
