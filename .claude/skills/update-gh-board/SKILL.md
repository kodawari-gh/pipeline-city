---
name: update-gh-board
description: Read and update the repo's GitHub Projects board with board.mjs: status, planned model, rounds, cost, and which tickets are unblocked. Use whenever a ticket is created or changes stage, when choosing a ticket's model, or when deciding what is ready to start.
---

# Update the project board

Use `board.mjs` (this folder) for every board read and write. It reads `docs/agents/board.json`, verifies each write by re-reading it, and takes order only from GitHub's blocked-by links.

```
B=.claude/skills/update-gh-board/board.mjs
node $B show <n>                  # status, planned, rounds, cost, open blockers, children
node $B status <n> <Status>       # Backlog | Ready | In progress | In review | Done
node $B planned <n> <Model>       # Opus | Sonnet | Haiku | Human | Parent
node $B rounds <n> <k> / cost <n> <usd>
node $B done <n> [rounds] [msg]   # close with msg, set Rounds and Done
node $B sync <parent> [--dry]     # children: closed->Done, held->Backlog, unblocked->Ready, blocked->Backlog
```

The `ticket-swarm` runner makes all writes during a swarm. Use the CLI for tickets you create, plan, or fix by hand.

## Setup (once per repo)

If `docs/agents/board.json` is missing: ask the user which project (`gh project list --owner <owner>`), then run `node $B init <owner> <number> <owner/repo>`. It creates the `Planned model`, `Rounds` and `Cost` fields if missing and writes the config. The `Status` field needs the five options above; init names any that are missing. Add the `swarm` block by hand (see this repo's `board.json` for the keys: log, install, testFile, locked, slots, permissionMode, agentTimeoutMin, coAuthor). Commit the file.

## Planned model

Every ticket gets a planned model when it is created (`to-tickets`). The swarm starts its ladder there. Choose by what makes the ticket hard:

| Planned | Pick when                                                                                                                                                               |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Haiku   | One module, logic or wiring. A test seam already exists. Each acceptance item is a unit-test assertion.                                                                 |
| Sonnet  | Visual layout judged by a screenshot or pixel values. Work across process, thread or service boundaries. Persistence or wire format changes. A new test seam is needed. |
| Opus    | A change to an interface many modules share. The expand step of a wide refactor. A design choice the ticket leaves open. Performance diagnosis.                         |
| Human   | Needs human sign-off, taste, credentials, or a decision only the user can make. Never swarmed.                                                                          |
| Parent  | The issue only groups sub-issues. Never swarmed.                                                                                                                        |

Then read the swarm log (`swarm.log` in `board.json`) and the repo notes in `docs/agents/board.md`, if present. If a similar past ticket needed 3 or more rounds at a tier, plan one model higher. A ticket is held only when its planned model is Human or Parent; the user's go-ahead covers everything else.

## Status meaning

Backlog: blocked, held, or stopped. Ready: open with every blocker closed. In progress: a swarm round is running. In review: the reviewer passed, squash pending. Done: squashed and closed, with `Rounds` (reviewer verdicts, the PASS included) and `Cost`.

Other sessions share the board. Leave tickets another session has In progress alone.
