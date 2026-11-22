# Swarm tier log

One row per round. Tier = model and effort of the agent set for that round (coder, tester, merger, reviewer). Result = the reviewer verdict for that round.

Escalation table: see `.claude/skills/ticket-swarm/SKILL.md`.

| Ticket | Round | Tier | Result | Notes |
| --- | --- | --- | --- | --- |
| #36 | 1 | haiku medium | FAIL | menu layout off |
| #36 | 2 | haiku high | FAIL | menu layout off |
| #36 | 3 | haiku xhigh | FAIL | matrix hung |
| #36 | 4 | sonnet medium | PASS | merged as 437acabb |
| #37 | 1 | haiku medium | FAIL | NewGameDialog export missing; Load rows 1-3 px off |
| #37 | 2 | haiku high | pending | coder and tester running |
| #53 | 1 | haiku medium | PASS | merged as 8f9ba3a7 (round count not confirmed) |
| #54 | 1 | haiku medium | FAIL | tests fed speed, crash, hold through onSnapshot |
| #54 | 2 | haiku high | FAIL | boot test stale; posted rule untested |
| #54 | 3 | haiku xhigh | FAIL | reviewer compared against ui-rework, the wrong base |
| #54 | 3 re-review | haiku xhigh | FAIL | against ticket/50-audio: boot_ready on every idle-os entry |
| #54 | 4 | sonnet medium | PASS | squashed as 311a054e on ticket/50-audio |

Earlier tickets (#30, #32, #33, #34, #35, #50, #51, #52) are not logged: their tier and round count were not recorded in this session.
