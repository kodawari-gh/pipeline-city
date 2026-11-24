---
name: ticket-swarm
description: Build tracker tickets with a swarm of headless subagents (coder and tester in parallel, round merge, reviewer; repeat until PASS), escalating model and effort from each ticket's planned model, with the board, cost and swarm log kept by a script. Use when the user asks to implement a ticket with a swarm.
---

# Ticket swarm

`swarm.mjs` (this folder) runs the whole loop. You start it, watch its events, and act only on the events listed below. Config: `docs/agents/board.json` (see `update-gh-board`).

```
node .claude/skills/ticket-swarm/swarm.mjs ticket <n>[,<n>...] [--base <branch>]
node .claude/skills/ticket-swarm/swarm.mjs run <parent> [--base <branch>] [--from <ref>] [--slots <k>]
node .claude/skills/ticket-swarm/swarm.mjs status | gc | deps | lock -- <cmd>
```

`run` base defaults to `parent/<parent>`, which the script makes from `--from` (default: the current branch) when missing. At the end of a run it removes the worktrees and branches of closed tickets. `ticket` base defaults to the current branch: confirm it with the user before the first run.

## Before a run

Every ticket needs a planned model on the board (Haiku, Sonnet or Opus). Set a missing one with the rubric in `update-gh-board`: `node .claude/skills/update-gh-board/board.mjs planned <n> <Model>`.

## What the script does

Per ticket, per round:

1. Coder and tester run in parallel, each a headless `claude -p` with the `swarm-*` agent from `.claude/agents/`, in its own worktree and branch (`ticket/<n>-coder`, `ticket/<n>-tester`). The prompt holds the ticket text. From round 2, only the role named in the findings reruns, from the integration tip. A ticket whose body has the line `Tests: none` gets no tester: the coder takes every finding, and its branch is the integration branch (no merge worktree).
2. Round merge into `ticket/<n>`: base first, then coder, then tester. On a conflict, the coder wins source files and the tester wins test files. A conflict with the base, or a commit hook refusal, goes to `swarm-merger` once.
3. The runner runs the repo gates (`swarm.checks`) on the integration branch. A failure is a FAIL round: the output goes back to the workers and no reviewer runs.
4. The reviewer runs the ticket's other checks, judges the diff against the acceptance items and the scope, and returns PASS or FAIL with findings tagged by role.
5. PASS: In review, then one squash commit on the base (swarm log rows included), issue closed, Done with `Rounds` and `Cost`, worktrees and branches removed. FAIL: next round one step up the ladder.

**Ladder**: start at the planned model, effort `medium`. Each FAIL raises effort (`medium` → `high` → `xhigh`), then the model (`haiku` → `sonnet` → `opus`) at `medium`. A FAIL at `opus xhigh` stops the ticket.

**Cost**: the sum of `total_cost_usd` of every agent run on the ticket (API-equivalent USD), written to the board on Done or stop.

**Dependencies**: `swarm.install` runs in new worktrees. With `swarm.shareDeps` (`keys`: the lockfiles; `dirs`: the install folders), it runs once per hash of the key files, in a detached worktree `.claude/worktrees/deps-<hash>`, and each ticket worktree links its `dirs` there. A ticket that changes a key file gets its own shared install on the next round. An agent that must change dependencies runs `swarm.mjs deps` first: it swaps the links for a private install. `gc` removes shared installs that nothing links to. Tool caches that live in an install folder must move to a per-worktree path in the repo's config.

**Lock**: agents wrap the commands in `swarm.locked` with `swarm.mjs lock`, so only one runs on the machine at a time. The runner does the same for its gates.

**Permissions**: every agent gets git rules for its own worktree (status, diff, add, commit, restore, and so on) plus `swarm.allow` (the repo's build, test and lint commands). Push, rebase, branch and worktree changes, and issue, project and PR writes are denied. An agent that needs a refused command stops and names it in `permission`: the ticket stops with `NEED permission`, keeps its worktrees, and a rerun resumes it.

**Stops**: before a stop, the runner saves each worktree's uncommitted work as a commit under `refs/swarm/wip/<n>-<role>` (no hooks run). `gc` deletes these refs when the ticket is closed.

State and events live in `.claude/swarm/<key>.{json,log}`. A rerun of the same command resumes from the state file.

## Events to act on

| Event line               | Action                                                                                    |
| ------------------------ | ----------------------------------------------------------------------------------------- |
| `NEED planned model`     | Set the planned model. The run picks it up within 2 minutes.                              |
| `NEED permission: ...`   | Ask the user to allow the command. Add the rule to `swarm.allow`, then rerun to resume.   |
| `STOP blocked: ...`      | The ticket cannot be built as written. Fix the ticket with the user, set it Ready, rerun. |
| `uncommitted work saved` | Read the ref named in the issue comment before you rerun.                                 |
| `STOP exhausted`         | Every tier failed. Report the findings (on the issue) to the user.                        |
| `STOP critical: ...`     | A git or tool failure. Worktrees are kept. Diagnose, fix, rerun to resume.                |
| `permission denial(s)`   | An agent was refused a tool. If it repeats, report it to the user.                        |
| `FINISHED`               | Report each ticket's result, rounds and cost.                                             |
