# TODO

Source of truth for the task runner in the separate `prompt-system` repo.

## Rules for every task

- One task = one commit, touching only the paths listed in `Files`. Stage with `git add <paths>`, never `git add -A`.
- `npm test` and `npm run build` must both pass before the commit. If they cannot, change nothing and say why in one line.
- Read the task's `Docs`, not the whole repo. Do not read `legacy/`.
- UI code: every size is relative (rem, em, %, clamp). `src/ui/scaling.test.ts` must stay green.
- Use the Edit tool, never rewrite a file from a script.
- When done, delete the task's line.

## Tags

- `[auto]` an unattended session can finish and verify it with tests and the build.
- `[owner]` needs a decision from the owner first. Never run unattended.
- `[~]` instead of `[ ]`: waiting on the owner.

Line format (the script matches `^- \[ \] <ID> `): `- [ ] ID [tag] Title. Files: ... Docs: ... Done when: ...`

## Open now

- [ ] T83 [auto] {sonnet} Accelerator internal views animated from sim state (GPU lanes with mask and banks, NPU MAC grid with the descriptor list, TPM three stages with a lock badge) and hover ids for each lane, bank, cell and stage. Files: `src/render/board/devices.ts`, `src/render/interact.ts`, `src/ui/kit/Hover.tsx`. Docs: `docs/render/interact.md` ids. Test pattern: `src/ui/logic.test.ts`. Done when: a test shows every new render id has a tooltip.
- [ ] T84 [auto] {sonnet} Accelerator graphics overhault, including GPU fans at the top, and intern detailed view for the GPUS up to par with what we have for CPU and RAM high LOD

## Design notes (no code)

- [ ] T86 [auto] {opus} OS tiers 2 and 3 design note. Cover cooperative multitasking (`os2`, level 8) and preemptive concurrency (`os3`, level 13), the program-slot count as a data field the kernel respects, the tick cost of a context switch, kernel changes, and a task split. Files: `docs/OS.md` (new section). Docs: `docs/OS.md`, `docs/PROGRESSION.md`. Done when: an "OS tiers 2 and 3" section exists, covers those points and ends with a task split for the owner to approve.
- [ ] T87 [auto] {opus} Fast model and offline catch-up design note. Cover what is calibrated and how it is keyed (including installed accelerators and their clocks), when a cache entry is invalidated, how offline catch-up is computed and capped, and a task split. Files: `docs/SAVE.md` (new section). Docs: `docs/SAVE.md`, `docs/ACCEL.md`. Done when: a "Fast model" section exists, covers those points and ends with a task split for the owner to approve.

## Deferred until the UI pass is done (owner)

- [ ] T96 [auto] Portrait phone: the scene is small because the world is wide. Frame the case first and let the player pan to the monitor, or stack the monitor above the case. Files: `src/render/camera.ts`, `src/render/board/layout.ts`. Done when: a framing test covers a 9:19 viewport.
- [ ] T109 [auto] Run `npm run e2e:tutorial` for the case steps (not run since they were added; the owner paused e2e) and read the screenshots.
- [ ] T110 [auto] Camera: recheck the guided "medium" window and the tutorial rings in the small cases (Mini tower) and with the bigger monitor.
- [ ] T113 [auto] The new slots are untested in the e2e and the tutorial text still says "the drive bay": run `npm run e2e:tutorial` and read the screenshots.
- [ ] T123 [auto] Tutorial hints `buyBoard` / `buyCase` say "power the machine off, then buy"; buying works with the machine on (only the install needs it off).
- [ ] T99 [owner] Tutorial lessons still missing: workloads (scan and db arrive at level 5), memory overclocking. Cancel for a queued part swap.

## Balance (last, after the UI review)

- [ ] T56 [owner] Balance pass on the whole game (`economy.ts`, `levels.ts`, device specs, VRM, the $10 spare floor). Includes level 4 pacing (the bot never reached level 4 in 4,000 s on cpu1 + HDD, and level 5 is a big step): rebalance or add an easier route.

## Later features (do not start without the owner)

- [ ] T50 [owner] Make the `hpc` job class runnable (needs multicore, T53).
- [ ] T52 [owner] OS tiers 2 and 3 (after T86).
- [ ] T53 [owner] Multicore (after T85).
- [ ] T54 [owner] Fast model and offline catch-up (after T87).
- [ ] T55 [owner] World map, many datacenters, a second machine, Wi-Fi, a router UPS. Not designed.
