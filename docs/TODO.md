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
- Test runner note (2026-11-17): on this checkout `vitest run` fails on every file ("Cannot read properties of undefined (reading 'config')"); `--pool=vmThreads` works. Heavy render tests take about 43 s here: their own timeouts are now 120 to 180 s. In a full run the default 5 s test timeout can hit a loaded machine: rerun the failed files alone with `--testTimeout=200000`.

## Where things stand (2026-11-17, branch `main`)

No open tasks. The ANIM work and the radiator/clipping work are done and written up in `docs/render/load.md` ("Swap cost", "Pace of Build my PC").

Fixed: the side panel opened and shut on every action (it stays open now, the player shuts it); steps took 1.5 to 2.5 s each plus the door's 1 to 1.9 s (now about 1 s, the door overlaps the work); a long chain took 28 s (CPU out with six blockers: 6.2 s, and Space, Escape or the Skip button fast-forwards it); a fan's cable in a chain is pulled 1.8x faster again (`CABLE_QUICK`).

Clipping: the radiator and its fans come out and go back as one assembly; `npm run clip:check` lists the rest (docs/render/load.md "Clipping"). To extend: case walls and cables in the checker.

Decisions (2026-11-17, the agent's, as the attended-session rule allows):
- ANIM-08 (the 0.5 s build freezing the picture): accepted. The build runs when the part is already hidden, so the frame the player sees before and after it is the same picture: only input waits, for 0.5 s, once per job. A patch that builds one part in place would save that, but it has to keep the merged groups and the shared materials right (`docs/render/three.md` "Merges"), for a pause nobody sees. Take it up again if a profile on a real device shows the stall as a hitch.
- ANIM-09 (the lock while a job runs): kept. Queuing clicks would let a second job start from a machine that is still moving, and Undo and the log depend on one job at a time. The Skip button and the 1 s pace remove the wait. The camera stays where the player put it: they may be looking at one corner, and a camera that follows the part would take that away.
