# Pipeline City: handover

A browser toy: a motherboard you can pan and zoom, with a CPU on it that you can watch execute a looping program, one clock cycle at a time. Four architectures can be switched live. It is plain HTML + Canvas 2D + vanilla JS, no framework, no build tooling beyond `cat`.

Status: working prototype, published once as a **private Claude artifact** (the artifact copy is `dist/artifact.html`). Everything below was verified in headless Chromium only (1360x800, dark and light). Nothing has been tested on a real phone or on real GPU hardware.

## 1. Quick start

```bash
./build.sh                 # src/* -> dist/index.html (local page) and dist/artifact.html
open dist/index.html       # or serve the folder; only the Google Fonts request needs a network
node tools/test-sim.js     # correctness: every engine/config vs a reference interpreter
python3 tools/screenshot.py dark    # needs: pip install playwright && playwright install chromium
python3 tools/profile.py            # per-layer render timings + sim cost
```

Controls: drag = pan, wheel/pinch = zoom, `Space` = play/pause, `→` = step one cycle, `F` = fly to the CPU die, `B` = fly out to the whole board. Hover a chip or block for an explanation, click a chip to pin its card.

## 2. What the user asked for (preserve these)

Original brief: a pipeline CPU animation that is readable and fun for a total layperson, but still interesting and "amazing" for someone who knows computer architecture. Minimal, slightly cutesy style. Runs in a browser.

Decisions from the interview (the user's answers; do not relitigate without asking):

- Classic **5-stage RISC** pipeline (IF ID EX MEM WB) as the showpiece.
- **Not** a copy of Mini Metro / Mini Motorways. Instead: cyberpunk, computer-chip themed, still minimal. Instructions are **colored chips with a mnemonic** (ADD, LW, ...).
- Hazards to show, all four: **data hazard + forwarding, branch misprediction flush, cache miss, structural hazard**. The user can **trigger** them with buttons.
- Nerd layer: stats (CPI/IPC, stalls, flushes), hover/click hazard detail, register file + memory view, cycle-by-cycle timeline.
- **Dark/light toggle.**
- **Minimal text** for normies (no running captions; explanations on hover).
- Architecture toggle: **unpipelined baseline, 5-stage in-order, 2-wide superscalar in-order, out-of-order** (Tomasulo/ROB style). **Dual core was dropped** at the user's request (they chose "skip").
- **Fixed looping program only** (no presets, no editor).
- Layout evolved: a "game scene", pannable by dragging, city-builder vibe.
- Later asks: (a) it must look like a real CPU, especially zoomed out; (b) zoomed out it should look like a **motherboard**, "feel free to overdo it a bit" with traces and cyberpunk patterns; the board, CPU package, RAM and eventually a GPU are components in their own right. (c) Performance and scalability to **many out-of-order CPUs** is now a priority.

## 3. Repo map

```
build.sh                 concatenates src/ -> dist/
src/a.html               <title>, CSS tokens + styles, all DOM (HUD, drawer), opens <script>
src/b1.js                ISA, machine state, cache, unpipelined engine, in-order engine (W=1 or 2)
src/b2.js                out-of-order engine
src/c1.js                theme reader, camera math, tile descriptions, layouts (pipe/wide/ooo), centering, fit targets
src/c2.js                chip/tile/district/arc drawing, chip tweening (syncChips), package + die + floorplan decor, draw()
src/c3a.js               motherboard: regions, no-go zones, seeded random trace/SMD/hex/QR generation, tooltip components
src/c3b.js               motherboard: bus lanes, drawBoard(), drawSocket()
src/d.js                 app wiring: modes, controls, camera flights, pointer/wheel, tooltips, drawer panels, timeline, frame loop
tools/                   test-sim.js, screenshot.py, profile.py
dist/                    build output
```

Files are concatenated into **one classic script**, so they share one global scope. Order matters (see `build.sh`). There are no modules.

## 4. Simulation (src/b1.js, b2.js)

Cycle-accurate-ish, deterministic, tiny (6 to 10 microseconds per simulated cycle on one core).

**Program** (`PROG`, 10 instructions, loops forever, wraps at the end):
```
0 LW   x1, 0(x2)        4 SW   x5, 0(x2)        8 ADDI x8, x0, 3   (reset loop counter)
1 ADD  x3, x1, x4       5 ADDI x2, x2, 16       9 ADDI x2, x0, 0   (reset pointer)
2 MUL  x5, x3, x6       6 ADDI x8, x8, -1
3 ADD  x7, x4, x6       7 BNE  x8, x0, 0
```
Initial regs: x4=5, x6=3, x8=3. Memory `{0:10,16:20,32:30,48:40}`. Values are masked to 16 bits. Instruction 1 is a load-use hazard, 2 depends on 1 (forwarding), 3 is independent (lets out-of-order overtake), 6 to 7 is a forwarding case into a branch.

**Machine** (`newMachine()`): `regs[16]`, `mem{addr:value}`, direct-mapped data `cache[4]` (16-byte lines, `lineOf=(a>>4)&3`, `tagOf=a>>6`), `bp{pc:bool}` 1-bit predictor (initially not-taken; target known at fetch), `pc`, `cycle`, `recent[]` (last 24 instructions, for the timeline), `touch` (last memory access, for highlights), `stat{...}`. `MISS = 4` cycles. Stores are write-through, no-allocate.

**Dynamic instruction** fields: `id, pc, op, rd, rs1, rs2, imm, target, cls ('alu'|'mul'|'ld'|'st'|'br'), vstate ('ok'|'stall'|'flushed'|'retired'), why, fwdInfo, cells{cycle:code}`, plus `a,b,res,addr,data,actualT,predT`. Out-of-order adds `srcA/srcB {ready,val,tag}`, `slot`, `state ('wait'|'issued'|'done')`, `missed`. **Bubbles** are `{bubble:true,id:'b#',cause}` objects that travel through the pipe like instructions (causes: `load, data, flush, struct`).

**Engine interface** (all four engines): `E.reset()`, `E.step(opts)` with `opts={fwd,shared}`, `E.items()` returning `[{i, zone, idx, left?, tot?}]` for everything to draw, `E.gone` (instructions that retired or were flushed this step, so the renderer can animate them out), `E.ev` (events this step: `wb{reg}`, `fwd{reg,id,src}`, `miss`, `stall{cause,stage}`, `flush{id,n}`, `struct`, `full`), `E.m` (machine). Timeline codes: in-order `F D X M W`; out-of-order `F D S X R C`; flushed `x`.

**Engines**
- `EngUnpipe`: one instruction at a time through five stages, no prediction (branches resolve in EX, no penalty).
- `EngInorder(W)`: five latches, each an array of up to W entries. Reverse-order evaluation per cycle: WB, MEM (cache; a miss **freezes** everything behind it), EX (forwarding from the MEM latch; branches resolve here; a mispredict flushes ID/IF and injects two flush bubbles), then ID issue (hazard detection) and fetch. `fwd` on: only load-use stalls (1 bubble). `fwd` off: stall until the producer is in WB (up to 2 bubbles). `shared` on: a single memory port, so fetch loses to a load/store in MEM and a struct bubble appears in IF. W=2 adds pairing rules: no RAW/WAW inside a bundle, one memory op per bundle, a branch ends the bundle.
- `EngOoO`: width 2. Fetch queue (4) to rename (2) to reorder buffer (8) + scheduler (6) to units ALU0, ALU1 (1 cycle), MUL (3), LSU (2 on a hit, 2+MISS on a miss, 2 for store-to-load forwarding) to in-order commit (2 per cycle). RAT-based rename. Loads wait until all older stores have completed (conservative disambiguation). Stores write memory at commit. A mispredicted branch squashes everything younger at completion and rebuilds the RAT from the ROB.

**Triggers** (buttons): "Cache miss" invalidates all cache lines. "Mispredict" flips `bp[7]` (the loop branch). "Forwarding" and "1 mem port" are the `opts` toggles (disabled where meaningless: unpipelined has none, out-of-order ignores both).

**Test**: `tools/test-sim.js` runs 7 configs for 3000 cycles each and compares architectural registers to a reference interpreter every 250 cycles while randomly invalidating the cache and flipping the predictor. It passed (ALL OK). Run it after any engine change. It checks registers only; memory is not compared for in-order engines (stores happen in MEM, before retirement).

## 5. Rendering (src/c1.js, c2.js, d.js)

- **World units** are arbitrary pixels at zoom 1. The camera is `cam {x,y,z}` (world point at screen centre, zoom). Transform: `setTransform(DPR*z,0,0,DPR*z, DPR*(VW/2-cam.x*z), DPR*(VH/2-cam.y*z))`.
- **Layouts** (`layoutPipe(W)`, `layoutOoO()`) return `{tiles, decor, links, slot(zone,idx)}`. `centerLayout()` shifts each so the **die centre is the world origin**; the motherboard is built around that origin. `dieRect = bbox ± 90`, `pkgRect = die ± 190`. `slot()` must be computed from tile positions (not absolute numbers) so centering works.
- **Chips are tweened per step**: `syncChips()` runs after every `E.step`, builds/updates an `fx` map keyed by instruction id (`x0→x1`, alpha, scale), and `draw()` interpolates with `ease(elapsed/(0.72*cycleMs))`. Items in `E.gone` animate out (retired: slide right; flushed: drop, shrink, red burst).
- **Draw order**: background dot grid, `drawBoard`, `drawSocket`, `drawPackage` (substrate, pins, caps, silkscreen, die), `drawDecor` (L2 array, uncore, I/O, clock), `drawLinks`, tiles, `drawDistricts` (register file, caches, RAM, predictor lamp, program strip), OoO extras (ROB markers, unit progress), arcs (forwarding path, flush redirect), chips, particles.
- **Signals**: `sig[tileId]` (`stall|miss|flush|struct`) from `E.ev`, drawn as a badge + glow on the tile.
- **Interaction** (`d.js`): `pick()` hit-tests chips (`hits[]`), tiles, decor, then `BCOMP` (board components). Hover shows `#tip`; click pins a chip into `#pin`. Mouse-only hover; touch only gets click-to-pin.
- **Camera flights**: `flyTo(target, dur, delay)` (exponential zoom, linear pan). The page opens on the whole board and flies into the die. Any pointer/wheel input cancels the flight.
- **Theming**: CSS custom properties with the required three-state pattern (`:root` light, `@media (prefers-color-scheme:dark) :root:not([data-theme="light"])`, `:root[data-theme="dark"]`). `readTheme()` copies them into `T` for canvas use. Add new colors as tokens in `a.html` in **all three** places and in `readTheme()`.
- **Drawer** (DOM, updated once per step in `updatePanels()`): KPIs, lost-cycles bars, timeline canvas, register/cache/RAM grids.

## 6. Motherboard (src/c3a.js, c3b.js)

- Board rect `BD` (6800 x 5200). Component regions in `BR`, with the CPU socket at the origin. Positions are **hard-coded for a package half-width up to about 1085** (the out-of-order package is the widest). If you enlarge a CPU layout, re-check collisions with VRM (left/top), DIMMs (right) and the PCIe/GPU band (bottom).
- `FILL` holds static, **seeded** (`rng(1337)`) random traces, vias, 700 SMD parts, a hex field and a QR sticker. Generated once at load, avoiding `NOGO` rects.
- `BUS.lanes` (memory, PCIe, chipset link) depend on `pkgRect`, so `rebuildBuses()` runs in `setMode()`.
- Live coupling to the sim: only `memPulse` (set in `syncChips` on any miss/cache-stall) lights the DIMM chips and speeds up amber pulses on the memory bus. Everything else (fans, RGB, data dots, hex flicker) is time-based decoration.
- `BCOMP` entries provide hover text. The **GPU is decor only** ("not simulated yet").

## 7. Performance: the next job

Measured (software-rendered headless Chromium, so absolute numbers are pessimistic; proportions are the point):

| View | Frame | Breakdown |
|---|---|---|
| Board zoomed out | about 44 to 49 ms | background dot grid about 23 ms (about 18k rects hidden under the board), board about 14 to 20 ms, of which SMD parts about 24 ms in an earlier measurement (700 separate rect fills with style switches) |
| Zoomed into the die | about 5 to 9 ms | package/pin pads dominate (thousands of rects per frame) |
| Sim | 6 to 10 µs per cycle | negligible, even for 100 CPUs |

Conclusion: the simulation is not the bottleneck, so **Web Workers for the sim are not needed**. The cost is redrawing static geometry every frame. Canvas 2D is GPU-accelerated in real browsers; a WebGL/WebGPU rewrite is a possible phase 2, not the first move.

Recommended order:
1. **Delete the dot grid** (or use a CSS background / a cached pattern). Biggest single win.
2. **Bake static layers** to offscreen canvases or bitmaps: the board (traces, SMD, hex, connectors) and each CPU package+pins, re-rendered only on theme/mode change; blit each frame. Identical CPUs share one baked package. Use a few resolution levels (mip-style) so zoom-in stays sharp, or fall back to live vector drawing above a zoom threshold.
3. **Per-CPU level of detail**: when a CPU is small on screen, draw a baked sprite with one live indicator (for example an activity glow driven by IPC or stalls). Only CPUs above a screen-size threshold get full tiles, chips and text. Add viewport culling per CPU.
4. **Separate animated layer**: moving parts (data dots, fans, glowing lanes, chips) on a transparent canvas above the cached static layers.
5. Only if a big multi-CPU scene still stutters: instanced WebGL (for example Pixi from cdnjs) with SDF text. Move rendering to an `OffscreenCanvas` worker for input responsiveness, not for raw speed.

To scale to many CPUs the code needs refactoring first: engines and layouts are currently singletons (`ENG`, `LAY`, one global `eng`/`L`, one `fx`, one `hits`). Make a `Cpu` instance own `{engine, layout transform, fx, signals}`, give layouts a world offset instead of being centred at the origin, and have the board own a list of sockets.

## 8. Known issues and debt

- **Performance** as above.
- **RAM appears twice**: a "RAM" tile inside the die view and DIMMs on the board. Decide on one story (probably show RAM only as DIMMs and make the die view's RAM tile a memory-controller view).
- **1-bit predictor** mispredicts about two of every three loop branches. Good for drama, unrealistic. A 2-bit counter is a small change in `m.bp` handling (b1.js and b2.js, both fetch and resolve).
- Touch devices have no hover tooltips (click-to-pin only). Mobile layout, drawer-as-bottom-sheet and pinch zoom are untested on real devices.
- Canvas animations ignore `prefers-reduced-motion`.
- `src/a.html` carries `<title>`, `<meta>` and `<link>` inside the artifact body. `build.sh` wraps it for local use, which browsers tolerate; tidy if you restructure.
- Visual checks were done at default timings only. Out-of-order and 2-wide were screenshotted but not exercised under every hazard combination (the simulation itself is covered by the test).
- Fonts (Chakra Petch, JetBrains Mono) load from Google Fonts. Canvas text uses fallbacks until loaded, then corrects itself on the next frame.
- No automated visual regression tests.

## 9. Roadmap ideas (none started)

- Multi-CPU scenes: **multi-socket board vs. a rack of boards** (zoom chip, board, rack, server room). Open question to ask the user; the rack idea fits the city-builder feel and suits cached sprites.
- Dual core / shared-memory contention (dropped earlier; revisit with the multi-CPU work).
- A simulated GPU (SIMT lanes) replacing the decor card.
- Make the board's data flow reflect real traffic (PCIe/chipset activity) instead of ambient animation.
- Better onboarding for laypeople without adding captions (the user wants minimal text).

## 10. If you republish as a Claude artifact

`dist/artifact.html` is exactly what was published. Constraints of that environment: no `<!doctype>`/`<html>`/`<head>` in the file; external scripts only from a short CDN allowlist (cdnjs, jsDelivr/npm, unpkg, Tailwind, jQuery) and styles only from Google Fonts; no downloads, `alert/confirm/prompt`, `window.print`; page must work at phone width with no horizontal scroll; the three-state theme pattern is required; include a `<title>` in the first 8 KB. Keep `<meta name="claude:viewport-fit-sides" content="cover">` only together with the `max(16px, env(safe-area-inset-*))` side paddings (present on `#hud`).

## 11. Gotchas

- Everything is one global script; a stray `let` collision breaks the page. Run `./build.sh` (it runs `node --check`).
- A thrown error inside `draw()` kills the animation loop silently (the board appears but the CPU and sim freeze). It happened once (missing `seg` array on flow dots). Check the console first when something freezes.
- `ctx.roundRect` is polyfilled in `c1.js` for older browsers.
- `shadowBlur` is in screen pixels, not world units, so glows do not scale with zoom (intended).
- `centerLayout()` mutates layouts at load. Do not call it twice.
