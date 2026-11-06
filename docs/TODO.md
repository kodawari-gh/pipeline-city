# TODO

Source of truth for tasks in this repository.

## Rules for every task

- One task = one commit, touching only the paths listed in `Files`. Stage with `git add <paths>`, never `git add -A`.
- `npm test` and `npm run build` must both pass before the commit. If they cannot, change nothing and say why in one line.
- Read the task's `Docs`, not the whole repo.
- UI code: every size is relative (rem, em, %, clamp). `src/core/ui/scaling.test.ts` must stay green.
- Use the Edit tool, never rewrite a file from a script.
- When done, delete the task's line.

## Tags

- `[auto]` an unattended session can finish and verify it with tests and the build.
- `[owner]` needs a decision from the owner first. Never run unattended.
- `[~]` instead of `[ ]`: waiting on the owner.

Line format (the script matches `^- \[ \] <ID> `): `- [ ] ID [tag] Title. Files: ... Docs: ... Done when: ...`

## Open now

## 3D render: one light, one palette, one level of detail

From the 2026-11-05 survey of the `?3d` room. The owner's goal: uniformity above all (one palette, one level of detail, one light across the room, its props and the view out). Run the tasks in this order. Shoot with `npm run shot -- <png> --3d --size 1920x1080 --hour h --look x,y,z,yaw,pitch,height` (or `--view room`); the rects below assume 1920x1080. L is the mean linear luminance that `node tools/lum.mjs <png> x,y,w,h` prints. Look at each shot before you call a task done.
- [~] T158 [auto] (Waits on the owner, 2026-11-06: the band is the stone sill under our window, `outside/street.ts:141-143`, on `k.stone` with the stucco map, `outside/kit.ts:36`, 2 m from the eye and in full sun; it is not in `towers.ts`. Allow `street.ts` and `kit.ts`?) The white band at the foot of the glass. At 14:00 a mottled white band at the bottom of the window (`--look -12000,13000,2000,0.1,0.15,16000`, rect 400,765,700,25, L .36) is brighter than all things in the room. It has a grain like snow, and nothing else has that grain. Find which outside mesh it is (the gravel of the nearest roof, `outside/towers.ts:785` and after, or the street side of our own block). Give it the scale, colour and brightness of the roofs beside it. If the mesh is in a file that is not listed, stop and say which file. Files: `src/features/room/render/three/outside/towers.ts`. Docs: the header of `outside/towers.ts`. Done when: in that view the band is not brighter than the roof across the street, and it has no mottle.

## Design notes (no code)

- [ ] T87 [auto] {opus} Fast model and offline catch-up design note. Cover what is calibrated and how it is keyed (including installed accelerators and their clocks), when a cache entry is invalidated, how offline catch-up is computed and capped, and a task split. Files: `src/worker/SAVE.md` (new section). Docs: `src/worker/SAVE.md`, `src/features/gpu/ACCEL.md`. Done when: a "Fast model" section exists, covers those points and ends with a task split for the owner to approve.

## Deferred until the UI pass is done (owner)

- [ ] T96 [auto] Portrait phone: the scene is small because the world is wide. Frame the case first and let the player pan to the monitor, or stack the monitor above the case. Files: `src/core/render/camera.ts`, `src/features/board/render/layout/layout.ts`. Done when: a framing test covers a 9:19 viewport.
- [ ] T109 [auto] Run `npm run e2e:tutorial` for the case steps (not run since they were added; the owner paused e2e) and read the screenshots.
- [ ] T110 [auto] Camera: recheck the guided "medium" window and the tutorial rings in the small cases (Mini tower) and with the bigger monitor.
- [ ] T113 [auto] The new slots are untested in the e2e and the tutorial text still says "the drive bay": run `npm run e2e:tutorial` and read the screenshots.
- [ ] T123 [auto] Tutorial hints `buyBoard` / `buyCase` say "power the machine off, then buy"; buying works with the machine on (only the install needs it off).
- [ ] T99 [owner] Tutorial lessons still missing: workloads (scan and db arrive at level 5), memory overclocking. Cancel for a queued part swap.

## Balance (last, after the UI review)

- [ ] T56 [owner] Balance pass on the whole game (`economy.ts`, `levels.ts`, device specs, VRM, the $10 spare floor). Includes level 4 pacing (the bot never reached level 4 in 4,000 s on cpu1 + HDD, and level 5 is a big step): rebalance or add an easier route.

## Later features (do not start without the owner)

- [ ] T54 [owner] Fast model and offline catch-up (after T87).
- [ ] T55 [owner] World map, many datacenters, a second machine, Wi-Fi, a router UPS. Not designed.
