# Swarm tier log

One row per round. Tier = model and effort of the agent set for that round (coder, tester, merger, reviewer). Result = the reviewer verdict for that round.

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
| #39 | 2 retry | haiku high | FAIL | tester fixed inset stub (d2e8dc78, 7 pass); reviewer: no browser script in four viewports, no Lens phone layout (ui.css:1892), no coverage script run, no screenshots |
| #39 | 3 | haiku xhigh | pending | coder and tester on d2e8dc78 |
| #45 | 1 | haiku medium | FAIL | non-JSON save message has no way forward; corrupt save not back to menu |
| #45 | 2 | haiku high | FAIL | offline state missing; return-to-menu untested |
| #45 | 3 | haiku xhigh | FAIL | offline test not wired; export and wrong-shape messages lack next step |
| #45 | 4 | sonnet medium | FAIL | round limit; offline test red, tester blocked by worktree guard; Backlog |
| #55 | 3 | haiku xhigh | FAIL | level-up test expected same-snapshot stinger; stinger undecoded |
| #55 | 4 | sonnet medium | PASS | squashed as 80e08cce on audio; closed Done |
| #56 | 1 | haiku medium | FAIL | test imported missing attachUiCues/cueForUi; typecheck TS2305; Hud label double-click |
| #56 | 2 | haiku high | FAIL | data-cue missing on tabs, Graphics button, sliders, OS close button |
| #56 | 3 | haiku xhigh | FAIL | keyboard choices silent (NewGame); Controls Done and Confirm Cancel lack ui_back; OS chip lacks transition; inventory bar, sandbox HUD, tutorial card lack data-cue |
| #56 | 4 | sonnet medium | pending | coder and tester running on 14596ede |
| #58 | 1 | haiku medium | FAIL | director does not call ambience; 12 tester tests red; reviewer skipped (red run was the evidence) |
| #58 | 2 | haiku high | pending | coder running on 949535ab |

#33 is not recorded: no spawn records found in the transcript.
"(inferred)" means the round and tier come from transcript spawn records and the PASS verdict is inferred from the squash.
