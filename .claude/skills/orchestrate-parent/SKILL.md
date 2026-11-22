---
name: orchestrate-parent
description: Run a whole parent feature on the Pipeline City board as orchestrator. Keeps every unblocked ticket moving through the ticket-swarm loop, in parallel where branches allow, until the parent is done or a critical failure stops it. Use when the user asks to implement a parent feature, or to keep the swarm going on a board.
---

# Orchestrate a parent feature

You run the board for one parent issue (for example #29 or #49). You do not write feature code yourself. You start agents, read their short reports, move the board, and keep the queue full.

## Inputs

- Parent issue number (required). Example: 29.
- Base branch for the parent's work (default: the current branch, `git branch --show-current`). Audio work goes on its own base (the audio branch), UI work on the UI base. Confirm the base before the first launch.
- Round limit per ticket: 4.
- Concurrency: up to two tickets at a time per base, so at most two integration branches are in flight.

## Read the state first

1. Children of the parent: the ticket list, from the parent's body or its sub-issues. Read `gh issue view <parent> --json body`.
2. Status of every child on the board: see `update-gh-board`.
3. Blockers of every open child: `blockedBy` through GraphQL, as `update-gh-board` shows. A child is ready when it is open and every blocker is CLOSED.
4. Ready tickets = open, unblocked, not held. Held: human sign-off tickets, and anything the user named.

## Loop

Repeat until every child is Done, or a critical failure stops the run:

1. **Fill the queue.** Move every ready ticket to Ready on the board. Keep Backlog for blocked and held tickets.
2. **Start up to two tickets per base.** For each started ticket, run the `ticket-swarm` round loop: coder and tester in parallel, round merge, reviewer, then squash on PASS. Set In progress when round 1 launches.
3. **Escalate per failure count**, exactly as the `ticket-swarm` skill's table: 0 failures haiku medium; 1 haiku high; 2 haiku xhigh; 3 or more sonnet medium, raising effort one step per further FAIL without stepping down. Effort resets to medium on a model change. Set `model` and `effort` on every agent call.
4. **Record every round** in `docs/agents/swarm-log.md`: ticket, round, tier, result, notes. Commit the log with explicit paths.
5. **On PASS**: the merger squashes the ticket onto the base as one commit, closes the issue with a comment naming the commit, sets Done with the winning model and swarm effort, and removes the ticket's three worktrees and branches.
6. **After each squash**: re-read blockers. Move every newly unblocked ticket to Ready and start it. Do not wait for the whole batch.
7. **Never idle while a ready ticket exists.** If a slot is free and a ready ticket is waiting, start it.

## Stops

- **Critical failure**: the same ticket fails at the round limit, a merge conflict cannot be settled by the rule, a squash is refused by a permission guard, or a branch or worktree state is unsafe. Stop that ticket. Set it to Backlog, comment the findings on the issue, and keep the rest of the parent running.
- **Blocker found by an agent**: an agent that returns early with a blocker is not a failure. Record it in the log, leave the ticket in Backlog, and move on.
- **Human decision needed** (for example an unclear merge): surface the question with the options. Do not stall the other tickets while you wait.
- **Parent done**: every child is Done. Report the list of squash commits.

## Rules

- You do not run tests or read diffs. You read agent reports and verdicts only.
- You do not bypass a permission guard. If a git command is refused for a worktree, report it. Never run a substitute that routes around the refusal.
- You do not merge into `main`. The base is the parent's branch.
- Every agent call sets `model` and `effort`.
- Board writes go through `update-gh-board`. Re-read before each write.
- Commit subject <= 72 chars, body <= 3 lines, with `Co-Authored-By: Claude Haiku 5.5 <noreply@anthropic.com>` for Haiku-run work. Stage explicit paths only.

## Starter prompt for a new orchestrator

Paste this to start a fresh session on a parent feature:

```
Orchestrate parent #<N> on the Pipeline City board. Use the orchestrate-parent skill.
Base branch: <branch>. Round limit 4. Up to two tickets in flight.
First: read the parent, list its children, read each child's board status and blockedBy (GitHub, not ticket numbers). Move every unblocked open child to Ready. Start the ready tickets through the ticket-swarm loop, escalating per failure count. Keep the queue full after each squash. Stop only when every child is Done or a critical failure stops it. Report the squash commits at the end.
```
