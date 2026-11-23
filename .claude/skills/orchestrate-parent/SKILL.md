---
name: orchestrate-parent
description: Run a whole parent feature on the project board. Starts the ticket-swarm runner on the parent and watches its events until every child is done or needs a person. Use when the user asks to implement a parent feature, or to keep the swarm going on a board.
---

# Orchestrate a parent feature

The runner script does the loop, the board, the ladder and the cleanup. You keep it running and answer the events it cannot.

## Steps

1. **Check the parent.** `node .claude/skills/update-gh-board/board.mjs sync <parent> --dry`. Set every missing planned model (rubric in `update-gh-board`). Confirm the base branch with the user.
2. **Start the runner** in the background: `node .claude/skills/ticket-swarm/swarm.mjs run <parent> --base <branch>`.
3. **Watch it** with the Monitor tool on `.claude/swarm/p<parent>.log`, filtered to `NEED|STOP|denial|FINISHED|DONE|failed`.
4. **Act on events** as the table in `ticket-swarm` says. A stopped ticket leaves the others running.
5. **When the runner exits**, read `swarm.mjs status p<parent>`. If tickets are still open and unblocked (a planned model was set late, a blocker was fixed), start the runner again: it resumes from its state file.

Done when every child is Done, or each remaining child is held, blocked by a stopped ticket, or waiting on the user. Report each ticket's squash commit, rounds and cost.

## Rules

- Feature code comes only from the swarm agents.
- The base is the parent's branch. Merging into `main` is the user's call.
- Report a refused command as it is. Run only what the permission guard allows.
