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

Open: BOOT-05 (the menu review, 2026-11-18, below). The ANIM work and the radiator/clipping work are done and written up in `docs/render/load.md` ("Swap cost", "Pace of Build my PC").

Fixed: the side panel opened and shut on every action (it stays open now, the player shuts it); steps took 1.5 to 2.5 s each plus the door's 1 to 1.9 s (now about 1 s, the door overlaps the work); a long chain took 28 s (CPU out with six blockers: 6.2 s, and Space, Escape or the Skip button fast-forwards it); a fan's cable in a chain is pulled 1.8x faster again (`CABLE_QUICK`).

Clipping: the radiator and its fans come out and go back as one assembly; `npm run clip:check` lists the rest (docs/render/load.md "Clipping"). To extend: case walls and cables in the checker.

Decisions (2026-11-17, the agent's, as the attended-session rule allows):
- ANIM-08 (the 0.5 s build freezing the picture): accepted. The build runs when the part is already hidden, so the frame the player sees before and after it is the same picture: only input waits, for 0.5 s, once per job. A patch that builds one part in place would save that, but it has to keep the merged groups and the shared materials right (`docs/render/three.md` "Merges"), for a pause nobody sees. Take it up again if a profile on a real device shows the stall as a hitch.
- ANIM-09 (the lock while a job runs): kept. Queuing clicks would let a second job start from a machine that is still moving, and Undo and the log depend on one job at a time. The Skip button and the 1 s pace remove the wait. The camera stays where the player put it: they may be looking at one corner, and a camera that follows the part would take that away.

## BOOT and UX: load time and the menu (2026-11-18, from the menu review)

Done: the menu stands over the boot screen, a game chosen early waits, the way back to the menu, the save warnings, `Starting…` and the WebGL failure screen, the city builds a step at a time, the city's environment and the models start before the programs link (boot 9.8 s to 7.2 s cold, 3.8 s warm; `docs/render/load.md` "Boot, 2026-11-18"), Build my PC's first picture waits for its programs and uses each once (first open 3.5 s to 1.8 s) and its machine builds in slices (the longest task 1.15 s to 0.25 s), the Gallery's part does the same (longest task 381 ms to 192 ms), the shadows' depth programs, the bake's mix and the probe's pass start with the batch (no program links after it), the room builds in slices (the longest task in its step 1.45 s to 0.28 s), the street merge is 2x faster, the room's occlusion runs on workers (`Shading the corners` 1.1 s to 0.43 s), the buildings' massing runs while the baked maps load (the first three parts of BOOT-05), a model that joins late (a slow network) links its programs while hidden (a 419 ms task to none), a preset change no longer leaks 230 MB of heap, `npm run bench:boot` prints the boot table (cold and warm, the stages, the late programs).

- [ ] BOOT-05 [auto] [look: none] Part done: the stretch from `Building the world` to `Assembling the machine` fell from 3.4 s to 2.7 s cold (3.1 s to 2.5 s warm; boot done 7.9 s to 7.0 s cold, 4.6 s to 4.0 s warm). The street merge is 2x faster, the room's occlusion runs on a pool of workers (`Shading the corners` 1.1 s to 0.43 s) and the buildings' massing runs while the baked maps load (docs/render/load.md "The city's heavy steps"). Left, by gain: massing in a worker (0.27 s); `plantTrees` (0.32 s; `taperTube` builds a 200-point length table for each limb, the top Three cost in its profile); the first machine (0.25 s) built while the occlusion workers run; `sweptMerge` with the matrix maths inline (0.05 s). A baked occlusion was rejected: the room's plants take a running seed, so a bake does not match, and the file would change with every art edit. Files: outside/view.ts, outside/towers.ts, outside/trees.ts, loft.ts, room3d.ts. Done when: `Building the world` to `Assembling the machine` takes under 1.5 s cold (`npm run bench:boot` prints it: 2.7 s at `037c5ec4`).