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

- Accelerator internal views animated from sim state (NPU MAC grid with the descriptor list, TPM three stages with a lock badge; the GPU is covered by T129 to T145 below) and hover ids for each cell and stage. Files: `src/render/board/devices.ts`, `src/render/interact.ts`, `src/ui/kit/Hover.tsx`. Docs: `docs/render/interact.md` ids. Test pattern: `src/ui/logic.test.ts`. Done when: a test shows every new render id has a tooltip.

## GPU architecture (design: `docs/GPU.md`; one task = one commit; order is the ID order except R-tasks that say otherwise)

- [ ] T133 [auto] GPU kernel audit for barriers. Find kernels where a lane reads what another lane of the same launch writes (picture passes, sphere, mandel, `gpuLayerCode`), add `bar`, keep the 447-word limit. Files: `src/sim/gen/gpupicture.ts`, `src/sim/gen/gpukernels.ts`, `src/sim/gen/npukernels.ts`, `src/sim/gpu/warp.test.ts`. Docs: `docs/GPU.md` section 4. Done when: a deliberately racy kernel fails the equivalence test and every real kernel passes it on `warp` and `multi`.
- [ ] T134 [auto] {opus} Multi-SM engine (`gpu3`): lanes dealt to SMs, per-SM scheduler, banks and L1, shared L2 with one request per cycle. Files: `src/sim/gpu/multi.ts` (new), `src/sim/gpu/multi.test.ts` (new), `src/sim/gpu/index.ts`. Docs: `docs/GPU.md` sections 4, 5. Done when: equivalence to `GpuRef`, L2 sharing and serialisation tests, golden chart, and `multi` beats `warp` on the same clock.
- [ ] T135 [auto] GPU specs and balance guards. `CardSpec.gpu` becomes a `GpuConfig` (still exposes lanes, memBytes, banks for `gpuTarget`); set gpu1 simd, gpu2 warp, gpu3 multi; deliberately update the `cpuspec.test.ts` pins; check heat (full load near 70 C), the 75 W slot rule, and optionally a `gpuProfile(specId)` like `cpuprofile.ts`. Do not change prices, levels or watts (owner, T56). Files: `src/sim/board/specs.ts`, `src/sim/game/hardware.ts`, `src/sim/game/cpuspec.test.ts`, `src/sim/machine/gpu.test.ts`. Docs: `docs/GPU.md` section 4. Done when: "GPU tiers", `gpujob`, `npujob`, `gpu.game.test.ts` pass and a seeded Game gives the same job output text on gpu1, gpu2 and gpu3.
- [ ] T136 [owner] GPU floorplan mock-ups. One HTML page with the gpu1, gpu2 and gpu3 die plans (blocks and wires of `docs/GPU.md` section 7) and a decision on card geometry: card height or a separate die rectangle, slot pitch (360), memory chips. Art mock-ups come before code. Files: a scratch artifact only. Done when: the owner approves the page.
- [ ] T137 [auto] Generalise the die layout machinery for non-CPU plans: `place` and `routeLinks` generic over `{id, rect, parent?}` (drop the `kind === 'stage'` skip and the `cpuplan:` prefix leaks), and extract `PlanView`'s `pulse`, `send`, `drawPackets`, `drawTrails` and `CellTexts` into a shared module. Files: `src/render/die/cpufloor.ts`, `src/render/die/dieview.ts`, `src/render/die/diepulse.ts` (new). Docs: `docs/DIE.md`. Done when: `cpuplan.test.ts`, `dieart.test.ts`, `diemotion.test.ts` pass with no snapshot change.
- [ ] T138 [auto] {opus} `gpuplan`: blocks, routed links and per-tier variants from the `GpuConfig` (after T136). Files: `src/render/gpu/gpuplan.ts` (new), `src/render/gpu/gpuplans.ts` (new), `src/render/gpu/gpuplan.test.ts` (new). Docs: `docs/GPU.md` section 7, `docs/DIE.md`. Test pattern: `src/render/die/cpuplan.test.ts` `check()`. Done when: every gpu spec plans, no overlap, every link ends on an edge or pin, grids exact, tiers differ, a walled-in plan throws.
- [ ] T139 [auto] Card geometry and static art (after T138): apply the T136 decision to `GPU_LEN`/`GPU_H`, `accelart.ts`, the slot pitch and thumbs; draw the plan once (cells, pads, wires, names) like `dieNear`; rescale the LOD (wires about 0.12, cells 0.18, text 0.4) and move the shroud fade earlier; keep the fans. Files: `src/render/board/accelart.ts`, `src/render/board/gpuview.ts`, `src/render/board/layout.ts`, `src/render/board/thumbs.ts`, `src/render/gpu/gpuart.ts` (new). Docs: `docs/render/live.md`, `docs/render/board.md`. Done when: `accelart.test.ts`, `gpuview.test.ts`, `boardlayout.test.ts` pass and the card reads at each zoom.
- [ ] T140 [auto] GPU block symbols: lane ALU column, warp scheduler with scoreboard and warp cards, coalescer, bank arbiter (conflict red), mask and stack strips, cache lines with tags; pins and docking like `glyphgeom.ts`. Files: `src/render/gpu/gpuglyph.ts` (new), `src/render/gpu/gpuglyph.test.ts` (new). Docs: `docs/DIE.md` "Inside the blocks". Test pattern: `src/render/die/blockart.test.ts`. Done when: every plan block kind has a symbol and a test.
- [ ] T141 [auto] {opus} Card player: history of windows with `seek`, pulses along the routed links, the instruction shown inside the block that holds it, per-warp masks, warp chips, per-SM replay, conflict rounds; replaces `gpumotion.ts`. Files: `src/render/gpu/gpuplayer.ts` (new), `src/render/gpu/gpuplayer.test.ts` (new), `src/render/board/gpumotion.ts`, `src/render/board/gpuview.ts`. Docs: `docs/render/live.md`. Test pattern: `src/render/die/diemotion.test.ts`. Done when: the `gpumotion.test.ts` cases (window, hold, newest replaces, new launch replaces) pass ported, and seek returns the machine at a given cycle.
- [ ] T142 [auto] GPU hover ids from the plan (`pcie<k>.<part>` with an index suffix), descriptions for every new part, and the closed regexes updated in one commit. Files: `src/ui/panels/gpudesc.ts`, `src/render/interact.ts`, `src/render/board/gpulayout.ts`, `src/ui/logic.test.ts`. Docs: `docs/render/interact.md` ids. Test pattern: `src/ui/logic.test.ts` L249-262. Done when: a test shows every plan id has a tooltip and opens its card.
- [ ] T143 [auto] GPU stepping and Trace panel: a scrub target (`cpu` or `gpu:<slot>`), a `stepGpu` message and a 64-step window in `snapshotAfterStep`, a card section in the Trace panel (filters LAUNCH, MASK, MEM, REG, SCHED) and a card selector. Files: `src/game/scrub.ts`, `src/sim/game/machine.ts`, `src/sim/game/snapshot.ts`, `src/ui/panels/TracePanel.tsx`, `src/ui/panels/trace.ts`. Docs: `docs/UI.md` Trace panel, `docs/DIE.md` "Stepping". Done when: a test steps a paused card by 1 and 10 cycles and the scrubber shows the earlier cycle.
- [ ] T144 [auto] Shop, picker and shelf: compare SMs, warps, lanes, L2, memory, clock and power; thumbs match the new art; a tooltip per stat. Files: `src/ui/shop/picker.ts`, `src/render/board/thumbs.ts`, `src/ui/panels/gpudesc.ts`. Docs: `docs/UI.md`. Done when: `logic.test.ts` covers every new stat.
- [ ] T145 [auto] GPU docs sweep: ACCEL.md GPU section down to a pointer plus the tiers table, JOBS.md accelerator table, GEN.md GPU rows, PROGRESSION.md class rows, `render/{live,board,case,interact}.md`, UI.md, DIE.md cross-link; delete the done lines here. Files: the docs listed. Done when: no doc contradicts `docs/GPU.md`.

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
