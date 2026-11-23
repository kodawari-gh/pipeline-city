---
name: update-gh-board
description: Read and update the Pipeline City GitHub project board (project 4, kodawari-gh): status, planned model, rounds, and which tickets are unblocked. Use whenever a ticket is created or changes stage, when choosing a ticket's model, or when deciding what is ready to start.
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
| Planned model field | `PVTSSF_lAHOA2XHg84BsuAozhq-R_k` |
| Planned: Opus / Sonnet / Haiku / Human / Parent | `7f4653d4` / `cde2c3a7` / `46bb0cb7` / `d285167b` / `1fc3c805` |
| Rounds field (number) | `PVTF_lAHOA2XHg84BsuAozhrHypY` |

The `Model` and `Swarm effort` fields are legacy. Read them for old tickets; write `Rounds` instead.

Item ids are per ticket and per project, not the issue node id. Look them up.

## Planned model

Every ticket gets a planned model when it is created (`to-tickets`). `ticket-swarm` starts its escalation ladder at this model. Choose by what makes the ticket hard:

| Planned | Pick when |
| --- | --- |
| Haiku | One feature, sim or logic or wiring. A test seam already exists. Each acceptance item is a unit-test assertion. |
| Sonnet | UI or render layout judged by a screenshot or pixel values. Cross-layer work (worker, protocol, main thread). Save format changes. A new test seam is needed. |
| Opus | A change to an interface many features share. The expand step of a wide refactor. A design choice the ticket leaves open. Performance diagnosis. |
| Human | Needs human sign-off, taste, credentials, or a decision only the user can make. Never swarmed. |
| Parent | The issue only groups sub-issues. Never swarmed. |

Check `docs/agents/swarm-log.md` for similar past tickets. If one needed 3 or more rounds at a tier, plan one model higher.

## Read

Item id, status, planned model for one ticket:

```
gh project item-list 4 --owner kodawari-gh --limit 200 --format json --jq '.items[] | select(.content.number==38) | "\(.id) \(.status) \(."planned model" // "-")"'
```

Count by status:

```
gh project item-list 4 --owner kodawari-gh --limit 200 --format json --jq '[.items[] | .status] | group_by(.) | map({s: .[0], n: length})'
```

## Write

Add a new issue to the board (returns the item id):

```
gh project item-add 4 --owner kodawari-gh --url https://github.com/kodawari-gh/pipeline-city/issues/<n> --format json --jq .id
```

Set a single-select field (Status, Planned model):

```
gh project item-edit --project-id PVT_kwHOA2XHg84BsuAo --id <item-id> --field-id <field-id> --single-select-option-id <option-id>
```

Set rounds: `--field-id PVTF_lAHOA2XHg84BsuAozhrHypY --number <n>`.

## Blocked or not: read GitHub

Ticket bodies do not name blockers. The blocked-by links on GitHub do. Check them before any ticket moves to Ready:

```
gh api graphql -f query='query($n:Int!){repository(owner:"kodawari-gh",name:"pipeline-city"){issue(number:$n){state blockedBy(first:20){nodes{number state}}}}}' -F n=<n> --jq '.data.repository.issue | "\(.state) blocked-by=\([.blockedBy.nodes[] | "#\(.number)(\(.state))"] | join(","))"'
```

A ticket is unblocked when every blocker is CLOSED (or it has none). Ready means unblocked. Take order only from `blockedBy`, never from ticket numbers or a parent's list.

## Status rules

- Backlog: blocked, held (Human, Parent), or stopped (ladder exhausted, critical failure).
- Ready: unblocked tickets only. When a blocker closes, re-check its dependents and move the newly unblocked ones to Ready.
- In progress: set when round 1's agents launch. Never leave a ticket in progress after its run stops.
- In review: set when the reviewer passes, before the squash.
- Done: set after the squash lands and the issue is closed. Write `Rounds` = the number of reviewer verdicts, the PASS included. Close the issue with a comment naming the squash commit.

## Board writes are shared state

Other sessions read and write the board. Re-read an item just before you write it. Leave tickets another session has in progress alone. Make one write per shell call: each write is idempotent, so re-read and retry one that may not have run.
