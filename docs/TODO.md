# TODO

Source of truth for tasks in this repository. Rewritten 2026-11-17 for one theme: the animations of Build my PC (swapping parts, unplugging cables) and what a swap costs. The earlier list (MACH-01, GFX-05, LOD-04, ASSET-08, all parked by decision, and the old-ID table) stays in git: `git show 5f1f3034:docs/TODO.md`.

## Rules for every task

- One task = one commit, touching only the paths listed in `Files`. Stage with `git add <paths>`, never `git add -A`.
- Run the tests you touched and `npm run typecheck`. Run `npm run test:q` and `npm run build` before a push. If they cannot pass, change nothing and say why in one line.
- Read the task's `Docs`, not the whole repo.
- UI code: every size is relative (rem, em, %, clamp). `src/core/ui/scaling.test.ts` must stay green.
- Use the Edit tool, never rewrite a file from a script.
- Any task with a look needs a before and after shot (`npm run shot`), and a `--prod` shot before a push.
- When done, delete the task's line. If a task is only part done, rewrite its `State` and keep it.
- Test runner note (2026-11-17): on this checkout `vitest run` fails on every file ("Cannot read properties of undefined (reading 'config')"); `--pool=vmThreads` works. Heavy render tests take about 43 s here: their own timeouts are now 120 to 180 s, and the full set passes with `--pool=vmThreads`.

## Where things stand (2026-11-17, branch `main`)

Done and removed: ANIM-01 (`npm run bench:swap`, numbers in `docs/render/load.md` "Swap cost"), ANIM-02 (a removal or a fit builds the machine once: CPU out 8 builds to 1, CPU swap 1 build, no frame gap over 0.8 s; the single build itself is the rest), ANIM-03 (dropped: programs stay at 45 to 47 across swaps), ANIM-04 (cables pull out and plug in through the real plug hand; looked at on the 24-pin, out and in), ANIM-06 (`buildmode3d.test.ts` guards the `machineKey` the skip relies on; `bench:swap` counts builds).

## ANIM: animation and swap cost in Build my PC

No open tasks. ANIM-05 is done: every hold presses and rocks the part; DIMM latches and the CPU load lever move (`latchOpen`; a PCIe slot latch was tried and dropped: its hinge group added 4 draws at High); a card tips out of its slot (`Pose.tilt`). Decided 2026-11-17: no separate screw objects. The screws are part of the fused part meshes, and the press-and-rock of the hold stands for turning them; a real screw would add draws and a build step for a detail below the zoom where it shows. Take it up again if a close-up asks for it.

## Gaps in the flow, assessed 2026-11-17 (after the pace change)

Fixed: the side panel opened and shut on every action (now it stays open); steps took 1.5 to 2.5 s each plus the door's 1 to 1.9 s (now about 1 s, the door overlaps the work); a long chain took 28 s (now 8.7 s, and it can be skipped).

- [ ] ANIM-07 [auto] [look: low] Fan cables come out one by one: removing a radiator unplugs and replugs each case fan's cable as its own 1 s step. Play consecutive cable steps of one kind together (the hand holds one plug now; the others can use the old group lift at 2.5x) or as one beat with a count. Files: buildmode3d.ts `removeSteps`, plughand3d.ts. Done when: a CPU removal with six fans takes under 6 s.
- [ ] ANIM-08 [auto] [look: none] The 0.5 s build at the end of a permanent change freezes the picture (the frame gap in `bench:swap`). Patch the new part in place (ANIM-02's left half), or build it on the frame before the part lands and show it hidden. Done when: the gap is under 100 ms for a RAM swap.
- [ ] ANIM-09 [owner] [look: low] Everything is locked while a job runs (shelf tiles dim, buttons disabled). Queue the next click instead? It changes how the screen feels: the owner chooses. Also: the camera does not follow the part; a long lift can leave the frame.
