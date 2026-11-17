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

Done: ANIM-01 (measure: `npm run bench:swap`, numbers in `docs/render/load.md` "Swap cost"), ANIM-03 (dropped: programs stay at 45 to 47 across swaps and the frame gap equals the build ms, so a compile hold gains nothing).

Cables unplug and plug in through the real plug hand (`PlugHand.pullOut`, `plugIn`). A removal keeps its blockers built (hidden, then shown): CPU out went from 8 builds (4.96 s) to 1 (0.76 s). A job's last rebuild is skipped when the machine's key is unchanged. Holds press and rock the part.

## ANIM: animation and swap cost in Build my PC

- [ ] ANIM-02 [auto] [look: none] Fit and install without a full build. State (2026-11-17): done for `remove`, every cable step and the job end. Left: `fit` builds the whole machine at the install and at each put-back (about 0.7 s each); a `Machine3D.patch` that builds only the new part (its group, merged inside) would make it one small build. Files: src/features/board/render/three/buildmode3d.ts, machine3d.ts. Done when: a RAM fit shows no frame gap over 150 ms in `npm run bench:swap` and the picture equals a fresh build.
- [ ] ANIM-04 [auto] [look: medium] Cables: remaining checks. State (2026-11-17): built and looked at on the 24-pin; a `--prod` build opens Build my PC. Left: shots of the 8-pin, a PCIe lead and the plug-in direction; a cable with no rig (LAN) still slides. Files: plughand3d.ts. Done when: those shots show the plug turning and the strands never stretching.
- [ ] ANIM-05 [auto] [look: medium] Named moving sub-parts for the holds. State (2026-11-17): every hold presses the part in and rocks it (`poseAt`, `HOLD_PRESS`, `HOLD_ROCK`, tested). Left: real latches, screws and the load lever as named sub-objects of `ram3d`, `gpu3d`, `cpu3d`, `cooler3d` that move in a hold, and a tilt for a card pulled out end first. Files: buildmotion.ts, buildmode3d.ts `step`, the part builders. Done when: a shot pair of each kind with a hold shows a moving sub-part.
- [ ] ANIM-06 [auto] [look: none] Guard the rebuild count. State (2026-11-17): docs written. Left: a test with a stage (needs a WebGL context, which the unit tests lack) that fails if a RAM remove makes more than 2 builds; for now `npm run bench:swap` is the check. Files: buildmode3d.test.ts. Done when: the test runs in `npm run test:q`.
