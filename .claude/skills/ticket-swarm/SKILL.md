---
name: ticket-swarm
description: Build one tracker ticket with a loop of subagents: coder and tester in parallel, a round merge, then a reviewer; repeat until the reviewer passes, escalating model and effort from the ticket's planned model. Updates the project board at each stage. Use when the user asks to implement a ticket with a swarm of subagents.
---

# Ticket swarm

Builds one ticket. The loop repeats until the reviewer passes or the ladder is exhausted.

## Inputs

- Ticket number (required). Read it: `gh issue view <n> --json title,body`.
- Planned model: read it from the board (`update-gh-board`). If it is empty, choose it with that skill's rubric and write it before round 1. A Human or Parent ticket is not swarmed: stop and report.

## Escalation ladder

This table is the single source for model and effort. Every Agent call sets both `model` and `effort` from it.

Start at the planned model, effort `medium`. Each reviewer FAIL moves one step:

1. Raise effort: `medium` → `high` → `xhigh`.
2. After a FAIL at `xhigh`, move to the next model (`haiku` → `sonnet` → `opus`) at `medium`.
3. After a FAIL at `opus xhigh`, stop: set Backlog, comment the open findings on the issue, report to the user.

Apply the round's tier to every agent in it (coder, tester, merger, reviewer). Never step down. If a round fails twice on the same finding, put the finding in the next prompt as a required test, not a hint.

## Board and log

Board writes go through `update-gh-board`:

| Event | Board |
| --- | --- |
| Round 1 launches | In progress |
| Reviewer passes | In review |
| Squash lands, issue closed | Done, `Rounds` = reviewer verdicts including the PASS |
| Any other stop | Backlog, open findings commented on the issue |

After each reviewer verdict, append one row to the swarm log named in `docs/agents/board.md` (ticket, round, tier, result, notes) and commit it with its explicit path.

## Layout

The base is the session's branch: `BASE=$(git branch --show-current)`. Run git from the session's own worktree. One coder/tester pair per ticket, reused across rounds. The coder and tester never share a branch or worktree, so neither sees the other's work before the merge.

Round 1 creates three worktrees from `$BASE`:

```
git worktree add .claude/worktrees/t<n>-coder -b ticket/<n>-coder "$BASE"
git worktree add .claude/worktrees/t<n>-tester -b ticket/<n>-tester "$BASE"
git worktree add .claude/worktrees/t<n>-merge -b ticket/<n> "$BASE"
```

Round 2 and later reset the relaunched agent's branch to the integration tip, while its worktree is clean and no agent runs in it: `git branch -f ticket/<n>-<role> ticket/<n>`.

Install dependencies in a worktree as the repo notes in `docs/agents/board.md` say. Remove all three worktrees and branches after the squash.

## Agents

Each role is a subagent in `.claude/agents/`. The prompt gives only per-run facts: ticket number, worktree path, branch names, base branch, round findings, and the co-author line naming the round's model (`Co-Authored-By: Claude <model name> <noreply@anthropic.com>`). The rules live in the agent files.

| Role | `subagent_type` |
| --- | --- |
| Coder | `swarm-coder` |
| Tester | `swarm-tester` |
| Reviewer (read-only) | `swarm-reviewer` |
| Final squash on PASS | `swarm-merger` |

## Round

1. **Coder and tester in parallel** (one message, two Agent calls).
   - Round 1 tester prompt includes the seam facts from the ticket's "Test seam" section and any you already know, so the tester does not re-explore.
   - Round 2 and later: relaunch only the agent whose branch has a finding, with the findings. A test-only finding relaunches the tester alone.
2. **Round merge** (the orchestrator, literal-path git in `t<n>-merge`): `git -C .claude/worktrees/t<n>-merge merge --no-commit --no-ff ticket/<n>-coder ticket/<n>-tester`, or only the branch that changed. On a conflict, take the coder's side for source and the tester's for tests. Stage explicit paths, commit once. A conflict that rule cannot settle stops the round: report the files.
3. **Reviewer**: checks `ticket/<n>` against `$BASE` and the ticket, runs the ticket's "Checks", and returns `PASS` with the commands run, or `FAIL` with a numbered list.
4. **Decide**:
   - `PASS`: set In review. `swarm-merger` squashes `ticket/<n>` onto `$BASE` as one commit. Close the issue with a comment naming the commit and the reviewer's commands. Set Done with `Rounds`. Remove the worktrees.
   - `FAIL`: next round, one step up the ladder.

## Rules

- The orchestrator reads only agent reports, verdicts and merge results. It does not run tests or read diffs.
- Everything merges into `$BASE` only, never into `main`.
- Each ticket lands on `$BASE` as exactly one commit. Agents commit at most once per round.
- Commit subject <= 72 chars, body <= 3 lines, ending with the round's co-author line. Stage explicit paths only.
