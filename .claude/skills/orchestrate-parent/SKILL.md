---
name: orchestrate-parent
description: Run a whole parent feature on the project board. Starts the ticket-swarm runner on the parent and watches its events until every child is done or needs a person. Use when the user asks to implement a parent feature, or to keep the swarm going on a board.
---

# Orchestrate a parent feature

The runner script does the loop, the board, the ladder and the cleanup. You keep it running and answer the events it cannot.

## Steps

1. **Check the parent.** `node .claude/skills/update-gh-board/board.mjs sync <parent> --dry`. Set every missing planned model (rubric in `update-gh-board`).
2. **Make the parent branch.** If `parent/<parent>` does not exist, create it from the default branch: `git branch parent/<parent> <default>`. Do not check it out. This is the base for every ticket.
3. **Start the runner** in the background: `node .claude/skills/ticket-swarm/swarm.mjs run <parent> --base parent/<parent>`.
4. **Watch it** with the Monitor tool on `.claude/swarm/p<parent>.log`, filtered to `NEED|STOP|denial|FINISHED|DONE|failed`.
5. **Act on events** as the table in `ticket-swarm` says. A stopped ticket leaves the others running.
6. **When the runner exits**, read `swarm.mjs status p<parent>`. If tickets are still open and unblocked (a planned model was set late, a blocker was fixed), start the runner again: it resumes from its state file.
7. **Clean up.** Run `swarm.mjs gc`, then `git worktree list` and `git branch --list 'ticket/*'`. Only open tickets may still have entries.

Done when every child is Done, or each remaining child is held, blocked by a stopped ticket, or waiting on the user. Report each ticket's squash commit, rounds and cost.

## Branches and worktrees

The runner makes these. Do not make or delete them by hand while it runs.

| Branch              | Worktree                        | Made from         | Used by                        |
| ------------------- | ------------------------------- | ----------------- | ------------------------------ |
| `parent/<parent>`   | none (not checked out)          | default branch    | squash target for every ticket |
| `ticket/<n>-coder`  | `.claude/worktrees/t<n>-coder`  | `parent/<parent>` | coder agent                    |
| `ticket/<n>-tester` | `.claude/worktrees/t<n>-tester` | `parent/<parent>` | tester agent                   |
| `ticket/<n>`        | `.claude/worktrees/t<n>-merge`  | `parent/<parent>` | round merge, reviewer, merger  |

- **Create.** When a ticket starts, the runner adds the three worktrees with `git worktree add -b`, then runs the install command in each. Each parallel ticket gets its own three, so agents never share a checkout.
- **Round.** The coder and tester commit on their own branches. The runner merges base, coder and tester into `ticket/<n>`. From round 2, a rerun role starts from the `ticket/<n>` tip.
- **Done.** The runner squashes `ticket/<n>` onto the base as one commit. Then it removes the three worktrees (`git worktree remove --force`), deletes the three branches (`git branch -D`) and runs `git worktree prune`.
- **Stopped** (blocked or exhausted). The runner removes the worktrees but keeps the branches. The work stays on `ticket/<n>` for a person to read.
- **Critical.** The runner keeps worktrees and branches for diagnosis. A rerun resumes in them.
- **Leftovers.** `swarm.mjs gc` removes the worktrees and branches of every closed ticket. It keeps those of open tickets.

## Rules

- Feature code comes only from the swarm agents.
- The base is `parent/<parent>`, never the default branch. Merging it into the default branch is the user's call.
- Report a refused command as it is. Run only what the permission guard allows.
