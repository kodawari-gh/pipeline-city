---
name: orchestrate-parent
description: Run a whole parent feature on the Pipeline City board as orchestrator. Keeps every unblocked ticket moving through the ticket-swarm loop, in parallel where branches allow, until the parent is done or a critical failure stops it. Use when the user asks to implement a parent feature, or to keep the swarm going on a board.
---

# Orchestrate a parent feature

You run the board for one parent issue. You start agents, read their short reports, move the board, and keep the queue full. Feature code comes only from the swarm agents.

## Inputs

- Parent issue number (required).
- Base branch (default: `git branch --show-current`). Confirm it before the first launch.
- Concurrency: up to two tickets in flight per base.

## Read the state first

1. Children of the parent: its sub-issues (`gh issue view <parent> --json body` as fallback).
2. Each child's status and planned model on the board, and its `blockedBy` (`update-gh-board`).
3. Ready = open, every blocker CLOSED, planned model not Human or Parent, not named by the user as held.

## Loop

Repeat until every child is Done or a critical failure stops the run:

1. **Fill the queue.** Move every ready child to Ready. Blocked and held children stay in Backlog.
2. **Start up to two tickets per base**, each through the `ticket-swarm` loop. That skill owns the escalation ladder, the board writes per stage, and the swarm log.
3. **After each squash**, re-read blockers. Move newly unblocked children to Ready and start them while a slot is free.

A free slot with a ready ticket waiting is the signal to start that ticket now.

## Stops

- **Critical failure** (a conflict the merge rule cannot settle, a squash refused by a permission guard, an unsafe branch or worktree state): stop that ticket. Set Backlog, comment the findings on the issue, and keep the rest of the parent running.
- **Ladder exhausted**: same as a critical failure.
- **Agent returns a blocker**: not a failure. Log it, leave the ticket in Backlog, move on.
- **Human decision needed**: ask the question with the options. Keep the other tickets moving while you wait.
- **Parent done**: every child is Done. Report the squash commits and each ticket's rounds.

## Rules

- Report a refused git command as it is. Run only what the permission guard allows.
- The base is the parent's branch. Never merge into `main`.

## Starter prompt for a new orchestrator

```
Orchestrate parent #<N> on the Pipeline City board. Use the orchestrate-parent skill.
Base branch: <branch>. Up to two tickets in flight.
```
