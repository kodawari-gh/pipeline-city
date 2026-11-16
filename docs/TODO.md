# TODO

Source of truth for tasks in this repository. Restructured 2026-11-15: finished tasks are gone, related tasks are merged, every task has one ID of the form `AREA-NN`. Old IDs (`LPC7`, `ASR4`, ...) still appear in code comments and docs: the table at the end maps each one to its new ID.

## Rules for every task

- One task = one commit, touching only the paths listed in `Files`. Stage with `git add <paths>`, never `git add -A`.
- Run the tests you touched and `npm run typecheck`. Run `npm run test:q` and `npm run build` before a push. If they cannot pass, change nothing and say why in one line.
- Read the task's `Docs`, not the whole repo.
- UI code: every size is relative (rem, em, %, clamp). `src/core/ui/scaling.test.ts` must stay green.
- Use the Edit tool, never rewrite a file from a script.
- When done, delete the task's line. If a task is only part done, rewrite its `State` and keep it.

## How to read a task

Line format (the script matches `^- \[ \] <ID> `): `- [ ] ID [tag] [look: x] Title (was OLD-ID). State. Files: ... Docs: ... Done when: ...`

- **ID** `AREA-NN`. Areas: `MACH` the machine in the case, `GFX` engine-wide look and light, `LOD` levels of detail, `CITY` the view outside the window, `PHONE` speed, memory and load on phones, `ASSET` the asset standard (parts, palette, textures, models), `UI` menus and HUD, `DOC` documentation.
- **Tag** `[auto]`: an unattended session can finish and verify it with tests, the build and a shot. `[owner]`: needs a decision or an acceptance from the owner first; never run unattended.
- **`[look: x]`**: the task can change the picture (none, low, medium, high). Any task with a look needs a before and after shot.
- **State**: what is already done and measured, with the date. Newest facts only; older history is in git and `docs/render/look-per-cost.md`.

## Where things stand (2026-11-16, branch `main`, local commits not pushed)

Why the work exists: the frame is CPU bound (draw calls, materials, light uniforms), so cuts to those come before triangle cuts. A normal map cuts triangles, not draw calls. The machine's parts move, so the machine gets baked occlusion and the room probe, not lightmaps.

Decisions (2026-11-15): the owner gave the look and performance trade-offs to the agent, by tier. An `[owner]` task in an attended session needs the agent's written decision (in the task's doc) and a looked-at shot, not the owner. An unattended run still skips `[owner]` tasks. Phone cost is no longer a constraint on a decision.

Done since 2026-11-15: ASSET-01, ASSET-02, ASSET-03, ASSET-04, ASSET-05, ASSET-06, BENCH-01, CITY-01, CITY-02, CITY-03, CITY-04, CITY-05, CITY-06, CITY-07, CITY-08, DOC-01, GFX-01, GFX-02, GFX-03, GFX-04, LOD-01, LOD-02, LOD-03, LOD-05, MACH-02, MACH-03, MACH-04, MACH-05, MACH-06, PHONE-01, PHONE-03, PHONE-04, PHONE-05, PHONE-08, UI-01.

| Area | Open | Tagged `[owner]` | Next step |
|---|---|---|---|
| MACH | 1 | 1 | MACH-01, parked by decision |
| GFX | 1 | 0 | GFX-05, parked with MACH-01 |
| LOD | 1 | 1 | LOD-04, parked by decision |
| ASSET | 1 | 1 | ASSET-08, parked by decision |

Menu review (`docs/MENU_REVIEW.md`): one menu per task, shot before and after. Not yet turned into tasks.

## MACH: the machine in the case

The maxed machine at High draws 942 draws before the merges (640 now near; 135 at the overview).

- [ ] MACH-01 [owner] [look: low] One material for most machine parts (was LPC2, PERF22). Colour, roughness and metalness move to vertex attributes or one palette atlas; one shared trim sheet (normal and roughness: brushed metal, vents, screw heads, fins, solder joints) gives the small detail. Parts that share the material can merge; this cuts draw calls, which a normal map alone does not. State: `mergeSiblings` and `shareMaterials` (`Machine3D.share`) took the Low machine from 239 to 102 materials, the scene from 378 to 241 and the scene pass from 634 to 385 draws. Left: the profile check of the Low machine and its cables, program switches (see GFX-05), and moving colour to vertices (room 86 materials, machine 34). Files: src/core/render/three/materials.ts, merge.ts, src/features/board/render/three/machine3d.ts, tools/bake/. Docs: docs/render/three.md "Merges". Done when: the maxed machine at High draws with under 40 materials, `highident` is regenerated on purpose, the two uniform functions' profile share halves, and the owner accepts a close-up shot. State, update (2026-11-17): parked by decision, not started. A sandbox machine has 105 materials at High (34 painted, 71 plain in 14 groups): colour in vertices reaches about 48, not 40, and the rest needs an atlas for the painted sheets. Details in docs/render/three.md "Merges". Take it up again if a profile shows High limited by the material count.

## GFX: engine-wide look and light

- [ ] GFX-05 [auto] [look: low] Programs and precision (was PERF26). State (real GPU, ANGLE D3D11, RTX 5080, 2026-11-16, powered on): `renderer.info.programs.length` after the room view is Low 201, High 198 (`PORT=5233 npm run shot -- <png> --view room --preset Low|High --eval "return window.__board?.renderer?.info?.programs?.length"`). GFX-04 cut Low's lights from 6 to 4 but not the count of programs. The menu count is not measured (the tool cannot stop at the menu). Target is under 60. Every program is `highp`. MACH-01 cuts most; then try `mediump` for the post passes and the city. Files: src/core/render/three/post.ts, init.ts. Docs: docs/render/load.md. Done when: the menu links under 60 programs and a shot shows no banding. State, update (2026-11-17): parked by decision, not started. The menu links 123 programs (65 physical, 35 shader, 12 basic, 7 depth, 4 others); a sandbox game 124 at High and 102 at Low. Under 60 needs MACH-01's material work first, and `mediump` gains only on phone ALUs with a banding risk in the HDR chain. Details in docs/render/load.md "Programs and precision". Take it up again with MACH-01.

## LOD: levels of detail

- [ ] LOD-04 [owner] Far city and skyline as flat PNG cards rendered from High, plus a separate live night-window layer (was LODD3, ASR2's "cards past 300 m"). Cards only where parallax is under 1 px. Split 1,800–3,600 m and ∞ into 4–5 depth slices. Hide the seam behind a building row or in haze, with matched fog and mipmaps. Night layer: a second linear grey mask per slice; the shader adds mask × lamp colour × night, with a per-column onset. Beacons, crowns and signs stay a small real mesh. Decide before the bake: the owner asked for the same tone mapping as High; the audit recommends storing linear (before ACES) so ACES runs once. Tree cards past 300 m belong here. Files: new src/features/room/render/three/outside/cards.ts, tools/cards.mjs, public/cards/; view.ts, haze.ts. Docs: docs/render/three.md "Not on main". Done when: the storage decision is written here, a card matches a High shot at the nominal window, and the night layer lights the windows at dusk. State (2026-11-17): parked by decision, not started. The city's pass is 40 draws and 468k triangles at High (18 and 302k at Low), drawn each 3rd or 6th tick; a card needs one bake for each hour step and slice, and it moves High's far pixels (`highident`). Details in docs/render/lod.md "The card". Take it up again only if the far rings are measured as a frame's cost on a real device, and then for Low only.

## CITY: the view outside the window

State of the Low city: #23 and #28 are merged to main (b0da132, 3c516b8), so main has the Low city with the defects below. The expected look is origin/main `03fe0bc`. High must stay byte-identical (`highident`). On this branch every wall at night draws High's window grid and room model (CITY-01, CITY-03, `lowRibCover`, `lowRibLight`), and a far pane mirrors the sky by its tint (CITY-02). A building within 600 m is whole, a sign's face is High's glyph board and the window's avenue keeps its full traffic (CITY-04). Firefox Low takes the same cuts as Chrome Low (CITY-05; measured on the dev desktop). The night target is High's look at the same framing, not base Low's warm cast (decision in lod.md "The city at Low").


## PHONE: speed, memory and load on phones

Target: a high-end phone. Priority by screen: P1 main menu, P2 gallery, P3 Build my PC. Measure with `npm run bench:modes -- out.json --phone` (412x915 at dpr 2.6, CPU slowed 4x, Low and High; it counts draw calls, triangles and pixels per WebGL context) and `npm run bench:3d -- out.json --size 412x915 --dpr 2.6 --preset Low`. A desktop GPU hides the phone GPU's cost: read draw calls and triangles as GPU load, frame time as CPU load. The 4x slowdown is an estimate (no real phone has run it).
Findings (phone profile, Low, CPU/4, 2026-11-09, old): menu 31 fps; gallery 18 fps; Build my PC 5 fps. The room keeps drawing behind Gallery and Build my PC. Zoomed in on the CPU die the game costs 0.3 M triangles and 2.7 ms: the zoomed-out room and board views are the cost. Done already: the first start picks a tier (`pickTier`, `src/app/graphics.ts`); Low draws at 0.75 scale, shadows Off, 60 fps and 4 lamps; Auto mode steps one tier after the first seconds and remembers a step down. Open owner question: whether Auto should adjust the tier on phones (was PERF8; its task text is lost).
Common mobile budgets: 100–200 draw calls on low-end, under 500 on most phones; 1–2 M triangles; baked light plus one real-time light; few render-target switches. Over budget: draw calls, triangles, lights.

Phone tasks dropped by the owner, 2026-11-17: PHONE-02 (real devices), PHONE-06 (draw on demand, the rest) and PHONE-07 (one context). Their decisions and numbers stay in `docs/render/load.md` ("The sway's frames", "One context for all screens").

## ASSET: the asset standard

The standard is approved (docs/3D_STYLE.md "Asset standard"). Each task below needs the owner to accept its shot. Source of the numbers: `budget.test.ts` (High: 942 draws, vertices 2,216,520 to 1,172,752; city triangles 3,643,156 to 2,103,386).

- [ ] ASSET-08 [owner] [look: low] Build-time bake for parts, and the first glTF part model (was LPC6, 3D1). A headless page builds each part at LOD0 and at its lower levels, bakes LOD0's normals and occlusion onto the lower level's UVs (xatlas, as the room atlas does), and writes glb plus KTX2. Start with one part. The loader works (`MODEL_FILES` in `models3d.ts`) and two room models ship (`public/models/hoodie.glb`, `mouse.glb`), but no part model: every part is still primitives. Runs after LOD-01 decides the lower levels. Files: tools/bake/, src/features/board/render/three/models3d.ts, public/models/. Docs: docs/render/three.md "Known gaps", docs/3D_STYLE.md "Asset Export Checklist". Done when: one part's LOD1 ships as a baked glb, the bake reruns from one command, a shot at the switch distance matches LOD0, and the owner accepts a shot of it beside the primitive build. State (2026-11-16): parked by decision, not started. Its three blockers are gone: LOD-01 is decided, the size rule is accepted and both room models ship as meshopt (`npm run bake:models`), and a KTX2 encoder is in the repo (`ktx2-encoder`, `npm run bake:tex`). But the lower levels now come from the builders (`fanPart`, LOD-05) at no download cost, and a level 1 is drawn at 120 px or less, where baked normals do not show. A baked part glb adds download, a loader path and a bake step for no visible gain. Take it up again only for a part that needs hand-made art.

## Old ID to new ID

Done and removed: LPC1, LPC12, ASR11, ASR8, ASR1–ASR7 and ASR9 (shots) (ASSET-01), ASK3 (ASSET-05), ASR10 (ASSET-03), ASK1 (ASSET-06), ASR9 (left) and LPC11 (ASSET-04), ASR1 (left) (ASSET-02), LOD1 (LOD-03), DOC6 (DOC-01), KTX1, PERF11 (PHONE-03), PERF27 (MACH-05), LPC13 (MACH-04), LPC5 (left list) (MACH-06), LPC7 (MACH-03), LPC3 (MACH-02), PERF23 (PHONE-08), PERF17 (GFX-04), LPC8 (GFX-01), LPC9 (GFX-02), LPC10 (GFX-03), LOOK30 (CITY-03), LOOK29 (CITY-02), LOOK28 and LOOK33 (CITY-01), LOOK31 (CITY-04), LOOK32 (CITY-05), PERF28 (CITY-06), LODD2 and DOC8 (CITY-07), PARK1 (CITY-08), PERF2 and PERF6 (PHONE-01), PERF13 and PERF25 (PHONE-05), PERF12 (PHONE-04), LEFT23-2 (BENCH-01), LEFT25-2 (BENCH-02, dropped), PERF9, PERF15 and 3D2 (PHONE-02, dropped), PERF14 (PHONE-06, dropped), PERF24 (PHONE-07, dropped), DOC5, DOC9, DOC12, LEFT25-1.

| Old | New | Old | New |
|---|---|---|---|
| LPC2, PERF22 | MACH-01 | PERF2, PERF6 | PHONE-01 |
| LPC3 | MACH-02 | PERF9, PERF15, 3D2 | PHONE-02 |
| LPC7 | MACH-03 | PERF11 | PHONE-03 |
| LPC13 | MACH-04 | PERF12 | PHONE-04 |
| PERF27 | MACH-05 | PERF13, PERF25 | PHONE-05 |
| LPC5 (left list) | MACH-06 | PERF14 | PHONE-06 |
| LPC8 | GFX-01 | PERF24 | PHONE-07 |
| LPC9 | GFX-02 | PERF23 (left) | PHONE-08 |
| LPC10 | GFX-03 | ASR1, 2, 3, 4, 5, 6, 7 (shots), ASR9 (shots) | ASSET-01 |
| PERF17 | GFX-04 | ASR1 (left) | ASSET-02 |
| PERF26 | GFX-05 | ASR10 | ASSET-03 |
| LPC4, LODD1 | LOD-01 | ASR9 (left), LPC11 | ASSET-04 |
| LPC5 | LOD-02 | | |
| LOD1 | LOD-03 | ASK1 | ASSET-06 |
| LODD3, ASR2 (cards) | LOD-04 | ASK2 | ASSET-07 |
| LOOK28, LOOK33 | CITY-01 | LPC6, 3D1 | ASSET-08 |
| LOOK29 | CITY-02 | THEME1 | UI-01 |
| LOOK30 | CITY-03 | DOC6 | DOC-01 |
| LOOK31 | CITY-04 | LEFT23-2 | BENCH-01 |
| LOOK32 | CITY-05 | LEFT25-2 | BENCH-02 |
| PERF28 | CITY-06 | | |
| LODD2, DOC8 | CITY-07 | | |
| PARK1 | CITY-08 | | |
