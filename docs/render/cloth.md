# Cloth bakes

Soft cloth in the 3D room (the hoodie on the desk chair; later bedding, curtains) is not shaped by hand. It is cut as flat pattern pieces, sewn and dropped onto stand-in solids by a cloth solver, once and offline. The cloth as it lies is written to a glTF model in `public/models/`. The game only loads that model: no cloth is simulated in a frame.

Code: `src/core/render/three/cloth/` (pure TypeScript, no DOM, no Three; a test next to each file) and `tools/bake-cloth.mjs`.

| File | Role |
|---|---|
| `pattern.ts` | pieces (an outline of named edges in mm, `place` puts each flat point in 3D), seams (two edges sewn point to point, `flip` when they run opposite ways), `assemble`: meshes each piece (a jittered triangle lattice, Delaunay), gives both edges of a seam the same points, welds sewn points, winds the faces one way, sets rest lengths from the flat pieces. Helpers: `curve`, `curve3`, `resample`, `pointAt`, `polyLength` |
| `solid.ts` | the colliders as signed distances in mm: `sphere`, `capsule`, `slab` / `slabAt` (rounded slabs), `floor`, `union`, `gradient` |
| `solver.ts` | `Cloth`: extended position-based dynamics in small steps (`rate` steps a second, one pass a step): seams pull shut, stretch (compliance `stretch`), soft bending (`bend`), self-collision on a hash grid with friction between layers, the solids with friction. `run(phase)`, `stats()` |
| `bake.ts` | `ClothBake` and `bakeCloth`: runs the phases, logs a line each, welds the seams, smooths, adds a rolled rim along every free edge (hems, cuffs, the hood's opening), writes one primitive per material |
| `glb.ts` | a minimal GLB writer: one node and one mesh named by the bake, materials that carry only a name |

## Make a bake

1. Write a module that exports `bake: ClothBake` (example: `src/features/room/render/three/hoodiecloth.ts`). Units are mm in the frame of the piece of furniture the cloth lies on.
2. Run `npm run bake:cloth -- <module.ts>`. It writes `public/models/<name>.glb` and logs each phase: the widest open seam, the most stretched side, the fastest point. A settled bake ends with the seams near 0 mm open and the fastest point well under 1,000 mm/s. The hoodie (6,700 points) takes about 30 s.
3. In the game, `loadModel` the file, put the game's own materials on the meshes by material name, and scale it by `MM` (see `hoodie` in `chair3d.ts`). The uvs are the flat cloth in mm over `tile`, so a knit texture keeps its size over every piece.
4. Commit the module and the `.glb`. Bake again after a change to the pattern, the phases or the furniture's sizes: the model does not follow them by itself.

The phases: first `sew` with no gravity (`sew: Infinity, keep: 0`), then gravity phases that let the cloth down (a low `keep` is a slow, damped fall), then a short `settle` with `keep` near 0.

## What makes a bake go wrong

- **Shiver.** Constraints that cannot all be met make the cloth shiver and never settle. A seam whose two edges differ in length, or a band cut narrower than the cloth sewn to it (an in-plane gather), is such a case. Keep every seam's two edges the same length (derive one from the other with `polyLength`). Keep `stretch` above 0 (the hoodie uses 1e-7).
- **A violent sew.** Pieces placed far from their seams snap together and pump up speed. Place each piece near where it is sewn (`place`), and sew with `keep: 0` so the cloth moves only as it is pulled.
- **A flat piece that never stills.** A flat piece pushed together along its own plane cannot buckle. The solver starts every point `JITTER` (1 mm) off its place so that it does.
- **Spikes at the seams.** Welded points where many pieces meet (an armpit) poke out. `smooth` (Taubin passes; the hoodie uses 3) takes them off, and the points then go back `thickness` off the last phase's solid.
- **Cloth through the furniture.** The solids are stand-ins: make them a little rounder and fuller than the meshes they stand for, and check from close up.

## Look at it

Bake, then screenshot the room (`npm run shot -- <out.png> --3d`). For a close view, run `node tools/shot.mjs` directly with `--eval`: on Windows `npm run` passes through cmd.exe, which breaks code that holds `<`, `>` or `|`. In dev, `window.__board.lookAt(x, y, z, yaw, pitch, height)` aims the 3D camera (world y is `-y`) and `window.__board.scene` is the scene.
