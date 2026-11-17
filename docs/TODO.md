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
- Test runner note (2026-11-17): on this checkout `vitest run` fails on every file ("Cannot read properties of undefined (reading 'config')"); `--pool=vmThreads` works. `highident.test.ts` times out at 20 s with and without changes.

## Where things stand (2026-11-17, branch `main`)

Done and removed: ANIM-01 (`npm run bench:swap`, numbers in `docs/render/load.md` "Swap cost"), ANIM-02 (a removal or a fit builds the machine once: CPU out 8 builds to 1, CPU swap 1 build, no frame gap over 0.8 s; the single build itself is the rest), ANIM-03 (dropped: programs stay at 45 to 47 across swaps), ANIM-04 (cables pull out and plug in through the real plug hand; looked at on the 24-pin, out and in), ANIM-06 (`buildmode3d.test.ts` guards the `machineKey` the skip relies on; `bench:swap` counts builds).

## ANIM: animation and swap cost in Build my PC

No open tasks. ANIM-05 is done: every hold presses and rocks the part; DIMM latches and the CPU load lever move (`latchOpen`; a PCIe slot latch was tried and dropped: its hinge group added 4 draws at High); a card tips out of its slot (`Pose.tilt`). Decided 2026-11-17: no separate screw objects. The screws are part of the fused part meshes, and the press-and-rock of the hold stands for turning them; a real screw would add draws and a build step for a detail below the zoom where it shows. Take it up again if a close-up asks for it.
