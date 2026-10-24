# TODO (bite-size, one commit each)

Source of truth for the automation script (`scripts/todo-runner/`). `docs/HANDOVER.md` keeps the narrative and the traps; this file keeps the work list.

## Rules for every task

- One task = one commit, touching only the paths listed in `Files`. Stage with `git add <paths>`, never `git add -A`.
- `npm test` and `npm run build` must both pass before the commit. If they cannot, change nothing and say why in one line.
- Read the task's `Docs`, not the whole repo. Do not read `legacy/`.
- UI code: every size is relative (rem, em, %, clamp). `src/ui/scaling.test.ts` must stay green.
- Use the Edit tool, never rewrite a file from a script.
- When done, flip `[ ]` to `[x]` on this task's line only, and add a one-line trap to HANDOVER.md "Traps" only if you hit a real one.

## Tags

- `[auto]` an unattended session can finish and verify it with tests and the build.
- `[human]` needs a person in a real browser or on a real device. Never run unattended.
- `[owner]` needs a decision from the owner first. Never run unattended.

Line format (the script matches `^- \[ \] <ID> `): `- [ ] ID [tag] Title. Files: ... Docs: ... Done when: ...`

## P0: clean state

- [x] T01 [auto] Delete the stray `.tmp-vite-noreload.mjs` after `grep -r "tmp-vite-noreload"` shows no use (package.json, scripts, configs). Files: `.tmp-vite-noreload.mjs`. Done when: file gone, nothing referenced it, build green.
- [~] T02 [owner] Owner said NOT YET (2026-10-24): wait until T23 is played by hand. Push the local commits (126 ahead of origin/main at last count) so GitHub Pages is current. Done when: the owner says yes and `git push` succeeds.

## P1: finish the network UI (item 4 split; an earlier run may already have done some of it, so check the code first and tick what is already there)

- [x] T10 [auto] Make `npm run build` pass: fix the 4 type errors in `src/ui/netui.ts` (`log` not on `Stat`; icons `"down"`/`"up"` missing from `IconName`) and commit the existing `netui.ts`/`netdesc.ts` plus the already-modified `PartArt.tsx`, `logic.ts`, `regions.ts`, `ui.css` as one commit. Files: `src/ui/netui.ts`, `src/ui/netdesc.ts`, `src/ui/PartArt.tsx`, `src/ui/logic.ts`, `src/ui/regions.ts`, `src/ui/ui.css`, icon definitions. Done when: build and tests green, tree clean.
- [x] T11 [auto] Shelf and picker rows for kinds `nic`, `router`, `isp`: art per tier, level locks, hardware reasons ("needs" chips). Files: `src/ui` shelf/picker components, `logic.ts`. Docs: `docs/UI.md`, `docs/NETWORK.md` "UI the picker needs". Done when: pure-logic test covers locked, unlocked, missing-hardware rows.
- [x] T12 [auto] Network panel, part 1: link state chip and effective bandwidth, with the limiting component (port, router, plan, drive `netMbps`) highlighted. Files: `src/ui/netui.ts`, `netdesc.ts`, `ui.css`. Done when: logic test picks the right limiting component for each of the four cases.
- [x] T13 [auto] Network panel, part 2: offers, transfers with progress, spooled jobs, `os.spoolFull`, USB fallback state, retired-key count. Files: same as T12. Done when: logic tests for each state.
- [x] T14 [auto] Hints: retired keys at link-up, `net.portBusyKey` ("a key is parked in the USB port"), spool full, link down, saturated. Files: hint definitions in `src/ui`. Docs: `docs/UI.md` hints section (toasts capped at 2 visible). Done when: each hint has a trigger test.
- [x] T15 [auto] HUD network chip once a router exists, and a "retired" tag on keys. Files: `src/ui/Hud.tsx` (edit, do not rewrite), key tag component. Done when: logic test for chip visibility.
- [x] T16 [auto] Tooltips for ids `router`, `wall`, `cable.lan`, `eth0`, `eth1`, ... Files: tooltip table in `src/ui`. Docs: `docs/RENDER.md` ids. Done when: test that every network render id has a tooltip.
- [x] T17 [auto] Tutorial target check: steps `reachLevel4`, `netHardware`, router and plan purchase and install, plug `lan`, `firstNetJob` highlight real ids. Files: tutorial step definitions and their test. Done when: a test fails if a step targets an id that does not exist.
- [x] T18 [auto] Add a "Network UI" section to `docs/UI.md` describing what T11 to T16 built. Files: `docs/UI.md`. Done when: section exists and matches the code.
- [x] T19 [auto] Render the network panel: a component that reads `netOpen` (toggled by the HUD chip via `toggleNet`) and shows the panel model from `netui.ts` (link state chip, bandwidth ladder with the limiting component highlighted, offers, transfers with progress, spooled jobs, spool full, USB fallback, retired-key count). Add the CSS it needs (relative sizes only). Files: `src/ui` (new component, `ui.css`, wherever panels are mounted). Docs: `docs/UI.md`. Done when: a render test (or logic test if no DOM test setup exists) shows the panel opens and closes with `netOpen`, and `scaling.test.ts` is green.

## P1: network verification

- [ ] T20 [human] Check upload pulses and the amber link-down LED against a real upload (a 120 s run never reached one).
- [ ] T21 [human] The ethernet cable to a NIC jack crosses the video cable sleeve once; decide whether to reroute.
- [ ] T22 [human] Burnt NIC dimming and touch on the network parts.
- [ ] T23 [human] Play the whole campaign by hand from a clean save. Watch for the tutorial card covering the board, step pacing (`reachLevel3` uses 592 of 660 ticks), wording that no longer matches the UI.

## P2: finish what exists

- [x] T30 [auto] Add CPU spec entries for `inorder2` (engine config only). Files: CPU specs in `src/sim/game`, spec test. Docs: `docs/ARCHITECTURE.md`. Done when: a spec test builds a machine with it and runs a job.
- [x] T31 [auto] Owner decision 2026-10-24: ship ONE ooo CPU only, `cpu4` = ooo ROB 8, 4-wide commit, at its existing level-11 unlock slot (remove it from PLANNED_ITEMS). ROB 16 and 32 are deferred (no unlock slots). Same files as T30. Done when: spec tests pass for all three.
- [x] T32 [auto] Board and VRM demand data for the new CPUs, and save handling (additive, no version bump unless the format breaks). Files: board/VRM specs, save code and test.
- [x] T33 [auto] Picker art and shelf row for the new CPU tiers. Files: `src/ui/PartArt.tsx`, picker logic. Done when: logic test lists them in tier order.
- [x] T34 [auto] Pacing re-check: CPI drops from about 1.3 to 0.9, so jobs finish about 1.4x faster at the same clock. Re-run the level bots and report the new level 1 to 3 times in `docs/PROGRESSION.md`. Do not change any balance number.
- [~] T35 [owner] DEFERRED to the balance pass (owner 2026-10-24). Level-4 pacing: the bot never reached level 4 in 4,000 s on cpu1 + HDD, and level 5 (70) is now a big step after thresholds were lowered to 14 and 12. Decide: rebalance or add an easier route.
- [x] T36 [auto] Give the heavy tests (`levels.test`, the tutorial bot) explicit timeouts so full-suite load does not flake them. Files: those test files only.
- [ ] T37 [human] Unverified UI paths: decline on an OS queue row, the OS-flow remove cue, the VRM crash flash, locked-tile and needs-chip screenshots on the shelf and OS rows, the HDD power lead crossing the SSD data run on two-SATA boards.
- [ ] T38 [owner] Owner picked (2026-10-24): fix NO SIGNAL on trip/burnt (T39), overview framing sides (T40), text softness above 2x (T41). Leave the 0.5x monitor-text gap. Original note: visual gaps (text softens above 2x zoom, monitor text readable only down to about 0.5x of fit zoom, a tripped or burnt part shows a blank monitor instead of NO SIGNAL, empty sides on the SATA/overview framing): decide which are worth fixing.

- [x] T39 [auto] Show NO SIGNAL (not a blank monitor) when a PSU trip or a burnt part blanks the display. Files: monitor rendering in `src/render`. Docs: `docs/RENDER.md`. Done when: a render/logic test covers trip and burnt.
- [~] T40 [owner] BLOCKED (T40 run, 2026-10-24): the overview scene is a fixed 1.7:1 box (`WORLD` in `src/render/layout.ts`); on a wider canvas the sides can only be filled by cropping the router shelf or the monitor column. Owner picks what to crop, or accepts the empty sides. Original: re-frame the SATA/overview camera so the height-limited scene does not leave empty sides. Files: camera framing in `src/render`. Done when: a framing test asserts the fit for the overview and SATA views.
- [x] T41 [auto] Reduce text softening above 2x zoom (render text at a resolution that follows zoom). Files: start at `src/render/ink.ts` (line 50: `new Text({... resolution: 2})` is fixed), `src/render/camera.ts` for the zoom value, test pattern `src/render/camera.test.ts`. {sonnet} Done when: a test or documented check shows the resolution scales with zoom, with no frame-time regression noted in `docs/RENDER.md`.

## P3: later features (do not start without the owner)

- [ ] T50 [owner] Owner priority (2026-10-24): `web` jobs first; needs a design note in `docs/NETWORK.md` before automation. Job classes that never run yet: `web` (needs the network), `secure`/TPM, `gpu`, `npu`, `hpc`. Build the devices, then make the classes runnable.
- [ ] T51 [owner] GPU with its own ISA (the `pcie` cable type is reserved), NPU, TPM as a header slot on Mainstream and up.
- [ ] T52 [owner] OS tiers 2 and 3 (cooperative multitasking, preemptive concurrency) as locked "later" entries; the program-slot count is a data field the kernel respects.
- [ ] T53 [owner] Multicore (shared caches, coherence rule, scheduling).
- [ ] T54 [owner] Fast model and offline catch-up (`docs/SAVE.md`).
- [ ] T55 [owner] World map, many datacenters, a second machine, Wi-Fi, a router UPS. Not designed.
- [ ] T56 [owner] Balance pass on the whole game (`economy.ts`, `levels.ts`, device specs, VRM). The owner said much later.
- [ ] T57 [human] Real-device checks: touch on a phone or tablet, frame times on a real GPU, the client side at 64x.
