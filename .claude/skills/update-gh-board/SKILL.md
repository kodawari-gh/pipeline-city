---
name: update-gh-board
description: Read and update the repo's GitHub Projects board: status, planned model, rounds, and which tickets are unblocked. Use whenever a ticket is created or changes stage, when choosing a ticket's model, or when deciding what is ready to start.
---

# Update the project board

The repo's board config lives in `docs/agents/board.md`: owner, project number, repo, field and option ids, swarm log path, and repo notes. Read it first. Use `gh` only.

## Setup (once per repo)

If `docs/agents/board.md` is missing, or lacks a field below, build it:

1. Ask the user for the project (`gh project list --owner <owner>`).
2. Read the ids: `gh project view <num> --owner <owner> --format json --jq .id` and `gh project field-list <num> --owner <owner> --format json`.
3. Create any missing field after the user confirms: `Status` (Backlog, Ready, In progress, In review, Done), `Planned model` (Opus, Sonnet, Haiku, Human, Parent), `Rounds` (number). Use `gh project field-create`.
4. Write the ids to `docs/agents/board.md` and commit it.

## Planned model

Every ticket gets a planned model when it is created (`to-tickets`). `ticket-swarm` starts its escalation ladder at this model. Choose by what makes the ticket hard:

| Planned | Pick when |
| --- | --- |
| Haiku | One module, logic or wiring. A test seam already exists. Each acceptance item is a unit-test assertion. |
| Sonnet | Visual layout judged by a screenshot or pixel values. Work across process, thread or service boundaries. Persistence or wire format changes. A new test seam is needed. |
| Opus | A change to an interface many modules share. The expand step of a wide refactor. A design choice the ticket leaves open. Performance diagnosis. |
| Human | Needs human sign-off, taste, credentials, or a decision only the user can make. Never swarmed. |
| Parent | The issue only groups sub-issues. Never swarmed. |

Then read the swarm log and the model hints in `board.md`. If a similar past ticket needed 3 or more rounds at a tier, plan one model higher.

## Read

Item id, status and planned model for one ticket:

```
gh project item-list <num> --owner <owner> --limit 500 --format json --jq '.items[] | select(.content.number==<n>) | "\(.id) \(.status) \(."planned model" // "-")"'
```

Count by status:

```
gh project item-list <num> --owner <owner> --limit 500 --format json --jq '[.items[] | .status] | group_by(.) | map({s: .[0], n: length})'
```

Item ids are per project, not the issue node id. Look them up.

## Write

Add an issue (returns the item id):

```
gh project item-add <num> --owner <owner> --url https://github.com/<repo>/issues/<n> --format json --jq .id
```

Set a single-select field (Status, Planned model):

```
gh project item-edit --project-id <project-id> --id <item-id> --field-id <field-id> --single-select-option-id <option-id>
```

Set rounds: `--field-id <rounds-field-id> --number <n>`.

## Blocked or not: read GitHub

The blocked-by links on GitHub hold the order, not ticket bodies or numbers:

```
gh api graphql -f query='query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){state blockedBy(first:20){nodes{number state}}}}}' -F o=<owner> -F r=<repo-name> -F n=<n> --jq '.data.repository.issue | "\(.state) blocked-by=\([.blockedBy.nodes[] | "#\(.number)(\(.state))"] | join(","))"'
```

A ticket is unblocked when every blocker is CLOSED (or it has none). Ready means unblocked.

## Status rules

- Backlog: blocked, held (Human, Parent, or named in `board.md`), or stopped (ladder exhausted, critical failure).
- Ready: unblocked tickets only. When a blocker closes, re-check its dependents and move the newly unblocked ones to Ready.
- In progress: set when round 1's agents launch. Never leave a ticket in progress after its run stops.
- In review: set when the reviewer passes, before the squash.
- Done: set after the squash lands and the issue is closed. Write `Rounds` = the number of reviewer verdicts, the PASS included. Close the issue with a comment naming the squash commit.

## Board writes are shared state

Other sessions read and write the board. Re-read an item just before you write it. Leave tickets another session has in progress alone. Make one write per shell call: each write is idempotent, so re-read and retry one that may not have run.
