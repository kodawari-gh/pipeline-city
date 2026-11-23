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
| #39 | 3 | haiku xhigh | FAIL | coder 20cbd4b3 (phone top tab, Lens, bill card); tester b389e224; merged 503dd599. Reviewer: 2 phone speed-step tests red (test stub calls desktop path); scene coverage script not in repo |
| #39 | 4 | sonnet medium | FAIL | coder f357621c, tester 73811aa0, merged f178e044. Reviewer: innerWidth <= 768 in phoneLayout() diverges from CSS 48em; coverage script not run or called |
| #39 | 5 | sonnet high | pending | round limit lifted by owner; coder and tester on f178e044 |
| #45 | 1 | haiku medium | FAIL | non-JSON save message has no way forward; corrupt save not back to menu |
| #45 | 2 | haiku high | FAIL | offline state missing; return-to-menu untested |
| #45 | 3 | haiku xhigh | FAIL | offline test not wired; export and wrong-shape messages lack next step |
| #45 | 4 | sonnet medium | FAIL | round limit; offline test red, tester blocked by worktree guard; Backlog |
| #55 | 3 | haiku xhigh | FAIL | level-up test expected same-snapshot stinger; stinger undecoded |
| #55 | 4 | sonnet medium | PASS | squashed as 80e08cce on audio; closed Done |
| #56 | 1 | haiku medium | FAIL | test imported missing attachUiCues/cueForUi; typecheck TS2305; Hud label double-click |
| #56 | 2 | haiku high | FAIL | data-cue missing on tabs, Graphics button, sliders, OS close button |
| #56 | 3 | haiku xhigh | FAIL | keyboard choices silent (NewGame); Controls Done and Confirm Cancel lack ui_back; OS chip lacks transition; inventory bar, sandbox HUD, tutorial card lack data-cue |
| #56 | 4 | sonnet medium | FAIL | round limit; 6 tester checks red (Enter/Space; Inventory 8 of 14, sandbox 1 of 8 and 1 of 6, tutorial 2 of 9); Backlog, comment posted |
| #58 | 1 | haiku medium | FAIL | director does not call ambience; 12 tester tests red; reviewer skipped (red run was the evidence) |
| #58 | 2 | haiku high | PASS | coder landed 58e6a973; reviewer PASS after fixes; squashed 82f7ee91 |
| #56 | 5 | opus medium | PASS | retry outside round limit; merger opus; squashed 378f5391 |
| #57 | 1 | haiku medium | FAIL | panel open literal data-cue missing; no close on machine list |
| #57 | 2 | haiku high | FAIL | second close X on Build screen (duplicate) |
| #57 | 3 | haiku xhigh | FAIL | slider cues missing; Build flyout open cue wrong |
| #57 | 4 | sonnet medium | PASS | squashed as d5085f00 (tier inferred from ladder) |
| #61 | 1 | haiku medium | FAIL | no AUDIO.md music section; no look-ahead timer |
| #61 | 2 | haiku high | PASS | merged as 73c11670 on audio; closed Done |
| #59 | 1 | haiku medium | pending | coder and tester running on 80e08cce |

#33 is not recorded: no spawn records found in the transcript.
"(inferred)" means the round and tier come from transcript spawn records and the PASS verdict is inferred from the squash.
