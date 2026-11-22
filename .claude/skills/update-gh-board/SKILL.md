---
name: update-gh-board
description: Read and update the Pipeline City GitHub project board (project 4, kodawari-gh): status, planned and winning model, swarm effort, and which tickets are unblocked. Use whenever a ticket changes stage, when deciding what is ready to start, or when recording a swarm result on the board.
---

# Update the Pipeline City board

Project 4, owner `kodawari-gh`. Repo `kodawari-gh/pipeline-city`. Use `gh` only. `jq` is not installed: use `gh ... --jq`.

## IDs (verified)

| What | Value |
| --- | --- |
| Project id | `PVT_kwHOA2XHg84BsuAo` |
| Status field | `PVTSSF_lAHOA2XHg84BsuAozhq6zYA` |
| Status: Backlog | `f75ad846` |
| Status: Ready | `61e4505c` |
| Status: In progress | `47fc9ee4` |
| Status: In review | `df73e18b` |
| Status: Done | `98236657` |
| Model (winning) field | `PVTSSF_lAHOA2XHg84BsuAozhq7y5I` |
| Model: Opus / Sonnet / Haiku / Human / Parent | `c7b8cd83` / `99edfc5c` / `fb85a23d` / `f99773a8` / `60754262` |
| Planned model field | `PVTSSF_lAHOA2XHg84BsuAozhq-R_k` |
| Planned: Opus / Sonnet / Haiku / Human / Parent | `7f4653d4` / `cde2c3a7` / `46bb0cb7` / `d285167b` / `1fc3c805` |
| Swarm effort (text) field | `PVTF_lAHOA2XHg84BsuAozhq-NMQ` |

Item ids are per ticket and per project, not the issue node id. Look them up, do not guess them.

## Read

Item id and status for one ticket:

```
gh project item-list 4 --owner kodawari-gh --limit 200 --format json --jq '.items[] | select(.content.number==38) | "\(.id) \(.status)"'
```

Count by status:

```
gh project item-list 4 --owner kodawari-gh --limit 200 --format json --jq '[.items[] | .status] | group_by(.) | map({s: .[0], n: length})'
```

## Write

Set status:

```
gh project item-edit --project-id PVT_kwHOA2XHg84BsuAo --id <item-id> --field-id PVTSSF_lAHOA2XHg84BsuAozhq6zYA --single-select-option-id <option-id>
```

Set swarm effort (text) with `--text "haiku xhigh"` and `--field-id PVTF_lAHOA2XHg84BsuAozhq-NMQ`.

Set the winning Model or Planned model with the single-select field id and option id from the table above.

## Blocked or not: read GitHub, never guess

Ticket bodies do not name blockers. The blocked-by links on GitHub do. Check them before any ticket moves to Ready:

```
gh api graphql -f query='query($n:Int!){repository(owner:"kodawari-gh",name:"pipeline-city"){issue(number:$n){state blockedBy(first:20){nodes{number state}}}}}' -F n=<n> --jq '.data.repository.issue | "\(.state) blocked-by=\([.blockedBy.nodes[] | "#\(.number)(\(.state))"] | join(","))"'
```

A ticket is unblocked when every blocker is CLOSED (or it has none). Ready means unblocked. Do not infer order from ticket numbers or from a parent's chain.

Known mistake, do not repeat: I assumed a numeric chain (#38 to #48) and put blocked tickets in Ready and unblocked ones in Backlog. Always check `blockedBy` first.

## Rules

- Ready: unblocked tickets only. Re-check blockedBy when a blocker closes; move newly unblocked tickets to Ready.
- In progress: set when the first round's agents launch. Never leave a ticket in progress after its run stops.
- In review: set when the reviewer passes and before the squash.
- Done: set after the squash lands and the issue is closed. Close the issue with a comment naming the squash commit.
- Backlog: set when a ticket hits the round limit, or when it is blocked and not yet started.
- Do not batch many board writes in one shell call that might be interrupted. Each write is idempotent: re-read the item before retrying a write that may or may not have run.
- Record the winning model and swarm effort on Done tickets. Record the planned model at the start.
- Human-gated tickets (for example #31, held for human sign-off) stay in Backlog. Never move them to Ready.

## Board writes are shared state

Other sessions may read or write the board. Re-read an item's status just before you write it. Do not move a ticket another session has in progress.
