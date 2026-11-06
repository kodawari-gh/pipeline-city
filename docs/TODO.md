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
- [ ] T162 [auto] Plaster with a fine, even finish. No lit material in the room has a normal map (only the floor and the rug have a bump map). The plaster on the walls reads as mottled stains, not modern-minimal (`--look -38000,0,54000,1.1,0.05,26000` and `--look 24000,4000,12000,-1.1,0.12,30000`). Give the plaster a fine, even generated normal and roughness map, and remove the mottle. Files: `src/features/room/render/three/room3d.ts`, `src/features/room/render/three/furniture3d.ts`, `src/features/room/render/three/palette.ts`. Docs: the header of `room3d.ts`. Done when: in both views the walls read as one even finish under raking light, with no stains.
- [ ] T163 [auto] One oak. The palette has one smoked oak, but the floor reads orange-red (`--look 8000,14000,26000,-0.4,0.75,24000`), the desk top reads grey-pink with broad bands (`--look -11000,1500,7000,0,0.55,4000`), and the back of the bookcase is a warm pegboard against the blue-black wall. Make the floor (`room3d.ts:240`), the desk top and the bookcase (`furniture3d.ts:331`) take the palette's oak through `oak()` (`furniture3d.ts:43`), with its grain in a normal map. Files: `src/features/room/render/three/room3d.ts`, `src/features/room/render/three/furniture3d.ts`, `src/features/room/render/three/furniture3d.test.ts`, `src/features/room/render/three/palette.ts`. Docs: the header of `palette.ts`. Done when: a test checks that the three take the palette's oak, and at 14:00 they read as one wood in the overview.
- [ ] T164 [auto] Soft pillows and fabric with a weave. The pillows have hard wedge corners and box flanges (`--look 30000,8000,9000,-0.5,0.25,12000`). Round their corners and remove the flanges (`furniture3d.ts:73`, `bedding3d.ts:171`). Give the bed's fabrics a weave normal map (`weave()`, `furniture3d.ts:26`). Files: `src/features/room/render/three/furniture3d.ts`, `src/features/room/render/three/bedding3d.ts`, `src/features/room/render/three/furniture3d.test.ts`. Docs: the header of `bedding3d.ts`. Done when: in that view the pillows have soft sewn edges and the fabric shows its weave.
- [ ] T165 [auto] Books like real books. The books are boxes, and their spines look like barcodes (`--look -37000,-6000,16000,1.05,0.05,12000`). Round the spines, add a small lean and some gaps, and put two or three quiet bands on each spine, not many stripes. Files: `src/features/room/render/three/furniture3d.ts`, `src/features/room/render/three/furniture3d.test.ts`. Docs: the header of `furniture3d.ts`. Done when: in that view the spines are round and no row reads as a barcode.
- [ ] T166 [auto] Quiet leaves. The leaves of the plants have bright painted veins (`--look -34000,8000,31000,0.9,0.1,14000`). Make the veins a faint relief or a small change of colour. Files: `src/features/room/render/three/plants3d.ts`. Docs: the header of `plants3d.ts`. Done when: in that view no bright vein line shows.
- [ ] T167 [auto] One level of detail for the furniture. The whole bookcase has 2,712 triangles, and one power cable has 19,488. The bookcase, the desk, the drawer unit and the bed frame have hard box edges. Bevel their edges as the machine's case does, so that the edges catch the light. Files: `src/features/room/render/three/furniture3d.ts`, `src/features/room/render/three/room3d.ts`, `src/features/room/render/three/furniture3d.test.ts`. Docs: the header of `furniture3d.ts`. Done when: in the 14:00 overview those pieces show round edges with a highlight.
- [ ] T168 [auto] Tidy the monitor's cable. A monitor cable makes a loop across the desk in front of the stand (`--view room` and `--look -12000,-3000,3400,0.2,0.05,7000`). Route it behind the stand and down through the grommet (`room3d.ts:339`). First find which lead it is (`cable.video` or `cable.monmains`, made in `machine3d.ts`). Files: `src/features/board/render/three/machine3d.ts`. Docs: the header of `machine3d.ts`. Done when: in both views no cable crosses the desk in front of the stand.
- [ ] T169 [auto] A quieter rug. The rug's hex chain pattern and its bright border line (`rugTex`, `room3d.ts:142`) are louder than all things near them (`--look 8000,14000,26000,-0.4,0.75,24000`). Lower the contrast of the pattern and make the border thinner. Files: `src/features/room/render/three/room3d.ts`. Docs: `docs/LOWPOLY_STYLE.md`. Done when: in that view at 14:00 the rug reads as one quiet field.
- [ ] T170 [owner] Accents outside the palette: the violet case and cooler (`0x8b5cff`, `machine3d.ts:112-121`, `case3d.ts`), the green and blue RAM, and the light-blue router cable (the brightest cable). The palette's accents are terracotta, cyan and amber. The owner kept the board's style. Decide if the machine's accents join the room's palette.
- [ ] T171 [owner] The overview's framing: the hoodie and the chair fill about a fifth of the frame's centre (`--view room`). Move the chair, move the camera, or keep it.

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
