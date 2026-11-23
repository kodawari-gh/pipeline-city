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
| #37 | 2 | haiku high | FAIL | warn meta inside WB button; WB label not red; pl-facts x 96 not 165; pl-strip offset; Back closes menu |
| #53 | 1 | haiku medium | PASS | merged as 8f9ba3a7 (round count not confirmed) |
| #54 | 1 | haiku medium | FAIL | tests fed speed, crash, hold through onSnapshot |
| #54 | 2 | haiku high | FAIL | boot test stale; posted rule untested |
| #54 | 3 | haiku xhigh | FAIL | reviewer compared against ui-rework, the wrong base |
| #54 | 3 re-review | haiku xhigh | FAIL | against ticket/50-audio: boot_ready on every idle-os entry |
| #54 | 4 | sonnet medium | PASS | squashed as 311a054e on ticket/50-audio |
| #30 | 6 | sonnet medium | PASS (inferred) | from transcript spawn records; squash 91a94f97 |
| #32 | 4 | sonnet medium | PASS (inferred) | from transcript spawn records; squash 2fe92a7d |
| #34 | 3 | haiku xhigh | PASS (inferred) | from transcript spawn records; closed |
| #35 | 2 | haiku high | PASS (inferred) | from transcript spawn records; closed |
| #50 | 2 | haiku high | PASS (inferred) | from transcript spawn records; squash f4de5d09 |
| #51 | 4 | sonnet medium | PASS (inferred) | from transcript spawn records; squash dcb05cec |
| #52 | 2 | haiku high | PASS (inferred) | from transcript spawn records; squash 1c6c54c9 |
| #39 | 1 | haiku medium | FAIL | inset test stubs old .hud selector; branch ticket/39 380e9062 |
| #39 | 2 | haiku high | BLOCKED | tester refused by worktree guard; stopped, Backlog |
| #42 | 1 | haiku medium | FAIL | first round |
| #42 | 2 | haiku high | FAIL | no --prod path |
| #42 | 3 | sonnet medium | PASS | prod matrix via tools/menu-matrix.mjs --prod; squashed ed504e0b |
| #43 | 1 | sonnet medium | PASS | framed in free window; navy 23.30 % failed the 2 % limit; limit raised to 6 % by user; squashed (see git log on ui-rework) |
| #44 | 1 | haiku medium | FAIL | first round (tier inferred; see rounds 2-3 in git history) |
| #44 | 2 | haiku high | FAIL | first round retry (tier inferred) |
| #44 | 3 | haiku xhigh | FAIL | (tier inferred) |
| #44 | 6 | sonnet medium | FAIL | merge 061729f3; browser test stall; desktop first frame camera; no prod shot |
| #44 | 7 | sonnet max | FAIL | merge c0e14646; devhook test stale; browser run hung |
| #44 | 8 | sonnet max | PASS | merge 7a1746ef; squashed ae59127a on ui-rework; closed Done |
| #45 | 1 | haiku medium | FAIL | non-JSON save message has no way forward; corrupt save not back to menu |
| #45 | 2 | haiku high | FAIL | offline state missing; return-to-menu untested |
| #45 | 3 | haiku xhigh | FAIL | offline test not wired; export and wrong-shape messages lack next step |
| #45 | 4 | sonnet medium | FAIL | round limit; offline test red, tester blocked by worktree guard; Backlog |

#33 is not recorded: no spawn records found in the transcript.
"(inferred)" means the round and tier come from transcript spawn records and the PASS verdict is inferred from the squash.
