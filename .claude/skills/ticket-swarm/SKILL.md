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

The base is whatever branch the parent work is on. Take it from the current session, never hardcode it: `BASE=$(git branch --show-current)`. Run every git command from the session's own worktree, not from a different checkout. The coder and tester never share a branch or worktree, so neither sees the other's work before the merge. One pair per ticket, reused across rounds. At the start of each round, reset both branches to the round's start point: `$BASE` in round 1, the tip of the integration branch `ticket/<n>` in round 2 and later (it holds the last merged fixes).

```
git worktree add .claude/worktrees/t<n>-coder -b ticket/<n>-coder "$BASE"   # round 1
git worktree add .claude/worktrees/t<n>-tester -b ticket/<n>-tester "$BASE" # round 1
git branch -f ticket/<n>-coder ticket/<n>                                    # round 2+, before the agent starts
git branch -f ticket/<n>-tester ticket/<n>                                   # round 2+, before the agent starts
```

Create the integration worktree once, in round 1, with the same base: `git worktree add .claude/worktrees/t<n>-merge -b ticket/<n> "$BASE"`. Reuse it in every round. Do not create or remove worktrees per round.

Reset a branch only when its worktree is clean and not checked out by an agent. Remove all three worktrees after the ticket merges.

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
   - **Coder** (worktree `t<n>-coder`): implements the ticket's "What to build" and acceptance list. Writes source and docs only. Commits once per round to `ticket/<n>-coder` (amend, do not add commits). Does not run the full suite.
   - **Tester** (worktree `t<n>-tester`): writes the tests the ticket names, from the acceptance list, before the code exists. Uses the repo's test seams (see the ticket). Commits to `ticket/<n>-tester`. Only test files. Commits once per round, same rule.
   - Both report the commit hash and up to 3 lines.
   - Round 1 tester prompt includes the seam facts the orchestrator already knows: module paths, exported function names, and the test helpers the ticket names. The tester then does not need to re-explore the code.
   - Round 2 and later: relaunch only the agent whose branch has a finding. A test-only finding relaunches the tester alone; the coder is skipped. Each relaunched agent gets the findings and fixes them on its branch, starting from the branch tip.

2. **Merge step** (no agent; the orchestrator runs it with literal-path git in `t<n>-merge`): `git -C .claude/worktrees/t<n>-merge merge --no-commit --no-ff ticket/<n>-coder ticket/<n>-tester`. Test files come from the tester, source from the coder. On a conflict, resolve only in favour of the coder for source and the tester for tests. Stage explicit paths. Commit once, as the round squash. If a conflict cannot be resolved, stop the round and report the files. A round that skipped one agent merges only the branch that changed, with `git -C .claude/worktrees/t<n>-merge merge ticket/<n>-<role>`.

3. **Reviewer** (one Haiku agent, read-only): reviews the diff of `ticket/<n>` against `$BASE` against the ticket. It runs the checks the ticket names (tests, typecheck, the relative-units test) and reads the output. It does not edit files. It reports one of:
   - `PASS` with the commands it ran and their results, or
   - `FAIL` with a numbered list. Each item: file, line, what is wrong, which acceptance item it breaks.

4. **Decide**:
   - `PASS`: a merge agent (`swarm-merger`, Haiku, same effort row) squash-merges `ticket/<n>` into `$BASE` as exactly one commit (`git merge --squash`, then one commit, explicit paths only). The orchestrator does not run this step itself. Set the board to `in-review`, then close the ticket with a comment that lists the reviewer's commands. Remove the round's worktrees.
   - `FAIL` and round < limit: start the next round with the findings.
   - `FAIL` at the limit: stop. Board to `backlog`. Comment the findings on the issue.

## Model and effort rule

Every agent call sets both `model` and `effort`. Use the `effort` parameter of the Agent tool; the user asked for it on every spawn.

Count failures per ticket: each round whose reviewer returns `FAIL` is one failure. Raise effort before you change model:

| Failures so far | Model | Effort |
| --- | --- | --- |
| 0 (round 1) | `haiku` | `medium` |
| 1 | `haiku` | `high` |
| 2 | `haiku` | `xhigh` |
| 3 or more | `sonnet` | `medium` |

Apply the row to every agent in the round (coder, tester, merger, reviewer). When the model switches, effort resets to `medium`; do not start Sonnet at `xhigh`. Once a ticket moves to Sonnet, keep it there for the rest of that ticket, and raise its effort one step per further FAIL (`medium`, `high`, `xhigh`). Do not step back down. If a round fails twice on the same finding, add the finding to the next round's prompt as a required test, not as a hint.

## Rules

- The coder and tester never see each other's branch until the merge.
- Keep each prompt self-contained: the ticket number, the branch, the worktree path, the commit rule, and the 3-line report limit.
- Nothing merges into any branch other than `$BASE`. Never merge into `main` from this skill.
- The orchestrator (main session) does not run tests or read diffs itself. It reads only the reviewer's verdict and the merge result.
- Round merges (coder + tester into `ticket/<n>`) are run by the orchestrator with literal-path git. The final squash onto `$BASE` on PASS is run by the `swarm-merger` agent, which makes exactly one commit per ticket.
- Agents do not share worktrees. The three worktrees and their branches are the only layout; they are not recreated per round.
- Commit subject <= 72 chars, body <= 3 lines. End each commit with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>`.
- Stage explicit paths only.
- Squash: each ticket lands on $BASE as exactly one commit. Agents commit at most once per round.
