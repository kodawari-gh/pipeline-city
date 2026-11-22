---
name: ticket-swarm
description: Build one tracker ticket with a loop of Haiku agents: coder and tester in parallel, a merge step, then a reviewer; repeat until the reviewer passes. Updates the Pipeline city board at each stage. Use when the user asks to implement a ticket or parent feature with a swarm of subagents.
---

# Ticket swarm

Builds one ticket. Every agent is Haiku (`model: "haiku"`). The loop repeats until the reviewer passes or the round limit is hit.

## Inputs

- Ticket number (required). Read it: `gh issue view <n> --json title,body`.
- Round limit: 4 unless the user sets another.

## Board updates

Use the `board-status` skill for every change. Map events:

| Stage | Status |
| --- | --- |
| Start of round 1 (coder and tester launched) | `in-progress` |
| Reviewer passes, commit on branch | `in-review` |
| Ticket closed after merge | `done` (ticket flow closes it) |

Never leave a ticket in `in-progress` after the run stops. On a stop at the round limit, set `backlog` and comment the open findings on the issue.

## Layout

The base is whatever branch the parent work is on. Take it from the current session, never hardcode it: `BASE=$(git branch --show-current)`. Run every git command from the session's own worktree, not from a different checkout. Each round uses its own branch and worktree, created from `$BASE`:

```
git worktree add .claude/worktrees/t<n>-coder -b ticket/<n>-coder "$BASE"
git worktree add .claude/worktrees/t<n>-tester -b ticket/<n>-tester "$BASE"
```

Do not junction `node_modules` into a worktree. A worker that needs packages runs `npm ci` in its own worktree. Remove each worktree after its branch is merged.

## Agent files

Each role is a subagent file in this project's `.claude/agents/`. Launch each with its `subagent_type` and pass `model: "haiku"`:

| Role | `subagent_type` |
| --- | --- |
| Coder | `swarm-coder` |
| Tester | `swarm-tester` |
| Merge step | `swarm-merger` |
| Reviewer (read-only) | `swarm-reviewer` |

The prompt you send gives only the per-run facts: ticket number, worktree path, branch names, base branch, and round findings. The rules live in the agent files.

## Round

1. **Launch coder and tester in parallel** (one message, two Agent calls, both `model: "haiku"`).
   - **Coder** (worktree `t<n>-coder`): implements the ticket's "What to build" and acceptance list. Writes source and docs only. Commits to `ticket/<n>-coder`. Does not run the full suite.
   - **Tester** (worktree `t<n>-tester`): writes the tests the ticket names, from the acceptance list, before the code exists. Uses the repo's test seams (see the ticket). Commits to `ticket/<n>-tester`. Only test files.
   - Both report the commit hash and up to 3 lines.
   - Round 2 and later: the coder and tester get the reviewer's findings from the last round, and fix them on their branches. Each round starts from the branch tip.

2. **Merge step** (one Haiku agent, in the session's worktree on `$BASE`): merge both branches into one integration branch `ticket/<n>`. Test files come from the tester, source from the coder. On a conflict, resolve only in favour of the coder for source and the tester for tests. Stage explicit paths. Commit. If a conflict cannot be resolved, stop the round and report the files.

3. **Reviewer** (one Haiku agent, read-only): reviews the diff of `ticket/<n>` against `$BASE` against the ticket. It runs the checks the ticket names (tests, typecheck, the relative-units test) and reads the output. It does not edit files. It reports one of:
   - `PASS` with the commands it ran and their results, or
   - `FAIL` with a numbered list. Each item: file, line, what is wrong, which acceptance item it breaks.

4. **Decide**:
   - `PASS`: merge `ticket/<n>` into `$BASE` (merge commit, explicit commit only). Set the board to `in-review`, then close the ticket with a comment that lists the reviewer's commands. Remove the round's worktrees.
   - `FAIL` and round < limit: start the next round with the findings.
   - `FAIL` at the limit: stop. Board to `backlog`. Comment the findings on the issue.

## Model rule

Start every agent on Haiku (`model: "haiku"`). Count failures per ticket: each round whose reviewer returns `FAIL` is one failure. After the second Haiku failure on a ticket, escalate that ticket's coder, tester, merger and reviewer to `model: "sonnet"` for every later round. Do not go back to Haiku for that ticket. If a round fails twice on the same finding, add the finding to the next round's prompt as a required test, not as a hint.

## Rules

- The coder and tester never see each other's branch until the merge.
- Keep each prompt self-contained: the ticket number, the branch, the worktree path, the commit rule, and the 3-line report limit.
- Nothing merges into any branch other than `$BASE`. Never merge into `main` from this skill.
- The orchestrator (main session) does not run tests or read diffs itself. It reads only the reviewer's verdict and the merge result.
- Commit subject <= 72 chars, body <= 3 lines. End each commit with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- Stage explicit paths only.
