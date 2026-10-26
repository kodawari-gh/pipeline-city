# The CPU die: floorplans, links and levels of detail

Code: `src/render/cpuplan.ts` (the data model), `src/render/cpufloor.ts` (the slicing layout and the channel router), `src/render/cpuplans.ts` (the floorplan of each architecture), `src/render/cpuplan.test.ts`. Status: **stage 1 built** (the layout data and its tests; the mock-ups were reviewed with the owner in two rounds). Not built yet: the renderer that draws it in the game (the game still draws the old fixed tiles in `layout.ts`/`devices.ts`/`pipeline.ts`), the snapshot data that lights it, the new CPU parts. Background: [`CPU.md`](CPU.md) (how the CPU runs, interrupts), [`ENGINES.md`](ENGINES.md) (the pipelines), [`RENDER.md`](RENDER.md) (the board and its buses).

## Why, and what the owner asked for

Every CPU used to share one floorplan (five stage tiles in a row plus filler blocks the sim does not model). Now each architecture has its own die, drawn from what its engine really has. Owner requirements, from the two review rounds:

- every core part visible and linked, laid out like a real processor, for every architecture and every upgrade variant;
- **maximise the use of the die**: the blocks tile it edge to edge (a gutter of 14 between blocks, nothing else);
- the parts that talk to the board sit **on the die edge their package pins are on**;
- **every grid is a full power-of-two rectangle** (never a partial row);
- the wires are **not arrows**: the die is a game component like the board, so wires are trace bundles with pads, and direction is shown by pulses.

## The data model (`cpuplan.ts`)

`cpuPlan(input) -> CpuPlan { arch, cores, die, blocks, links, tiles? }` (in `cpuplans.ts`) in die coordinates (`DIE` from `layout.ts`, 1420 x 1130, centred on the socket). `planInput(engineConfig, extra)` maps a spec's `EngineConfig` plus the feature knobs (`icacheLines`, `ways`, `l2Lines`, `predEntries`, `predBits`, `cores`) to the input, so a new CPU spec renders without drawing code. Plans are cached by input.

- **Block** `{ id, kind, label, sub?, rect, grid?, parent?, stage?, lane?, unit?, zone, core? }`. `grid` = the cells a structure shows, an exact `cols x rows` (`gridExact`: cols * rows = count, so 8 lines are 2 x 4, 16 registers 4 x 4, 64 lines 8 x 8, a prime count one row); datapath units show their 32 bit-slices (`shape [32, 1]`), the memory controller its 6 lanes, PCIe its 21 lanes (12 PCIe, 3 NVMe, 6 DMI, the board's own bus lane counts). `parent` = the stage frame (a pipeline stage's column) the block sits in; `stage` = stage index of a frame (instruction chips sit in it); `unit` = the OoO unit (`ALU0 ALU1 MUL LSU`) whose chips sit in the block; `zone` = `edge` (the board-facing ring, shared by cores) or `core`. Ids are the hover ids: `cpu.<id>` (`c<k>.<id>` on a multicore die).
- **Link** `{ id, kind, from, to, pts, lanes, label?, both? }`: an orthogonal polyline from the edge of `from` to the edge of `to` through the gutters, drawn as a bundle of `lanes` (1 to 4) parallel traces with a pad at each end. Kinds: `data`, `mem` (to RAM), `mmio` (device access that skips the cache), `control`, `forward`, `wakeup`, `flush` (mispredict squash), `irq`, `power`.

## The layout engine (`cpufloor.ts`)

- **Slicing floorplan**: a tree of `row`/`col` splits and `leaf` blocks with weights (`f`) or fixed sizes (`px`) fills a rectangle exactly (`spans`: whole pixels, the gutter exact). A split with a `frame` draws a stage column behind its children. Because it is a tree, the same floorplan can be laid out in any rectangle (the multicore tiles use this).
- **Channel router** (`routeLinks`): links are given as block pairs only; the router finds the route through the gutters on a 6 px grid (Dijkstra with a distance heuristic, a penalty per bend and for a track another link already uses), keeps 2 px clear of every block (a stage frame is a container, not an obstacle), and ends each route on the facing edges of the two blocks. Neighbours become a short straight hop across the gutter. A link with no route throws, so a floorplan that blocks a wire fails its test.

## The grammar (every architecture)

The die edge is a ring (`EDGE`): **north** the power block (vcore: one stub per VRM phase) and SVID/thermal; **east** the memory controller (the DIMM bus); **south** the clock and PLL (the crystal) and PCIe/NVMe/DMI; **west** USB, the display and the interrupt controller. Bond-pad rows on the die border show where each bus leaves. These are the sides the board's buses use (`RENDER.md` "Routing": `mem` east, `nvme`/`dmi`/`pcie`/`clk` south, `usb`/`video` west, `vcore` north). The **system bus** strip under the core joins the caches, the device path and the edge blocks (the memory controller at its east end). The core fills the middle: the pipeline stages in a row, the register file, the I-cache (when there is one) and the D-cache under them, an optional L2 strip above the system bus. Without an I-cache, fetch goes out through the system bus (no invented port).

## The floorplans

| CPU | What is drawn |
|---|---|
| cpu0 unpipelined | A sequencer along the top (five phase cells over the five phase columns); IF (next-PC mux, PC+4, PC, fetch), ID (immediate, decoder), EX (branch, ALU), MEM (device check, load/store), WB; the register file under IF to EX, the D-cache under MEM and WB. No latches, predictor or forwarding. |
| cpu1 five-stage | The same stage columns with the four pipeline registers as thin columns between them; the predictor inside fetch; a hazard unit that stalls until write-back; the redirect/squash wire from the branch unit to fetch. |
| cpu2 forwarding | cpu1 plus the forwarding unit in execute, fed from the EX/MEM and MEM/WB registers. |
| cpu3 two-wide | A pair/issue unit above two decoders, two ALUs, a register file with 4 read and 2 write ports, one load/store unit. |
| cpu4 out of order | Fetch queue (ring), decode (one decoder per lane of width), rename table + dispatch, scheduler, ALU 0, ALU 1, multiplier, load/store, the result bus (wakes the scheduler, fills the ROB, resolves branches), the reorder buffer (ring) committing into the register file under decode. |
| Variants | An I-cache takes the south-west; cache and predictor tables scale their grids; ways are columns; an L2 strip joins both L1s to the system bus; a bigger ROB, scheduler or queue grows its grid; width adds decoders (the frame grows). |
| Multicore (`cores: n`) | n core tiles in the middle (each laid out for its tile's shape, so a tile fills its cell), one shared L2 at their east end, one system bus under them; the edge ring is shared and every tile's PC gets an interrupt line. Server style = many small tiles, HPC style = one big out-of-order tile. Nothing multicore is simulated yet. |

## Tests (`cpuplan.test.ts`)

For fourteen configurations (every architecture, with and without the optional parts, wide and scalar OoO, 2, 4 and 8 cores): everything inside the die, no overlaps, unique ids, every grid an exact rectangle (power-of-two counts have power-of-two sides), **the blocks cover at least 78% of the die** (55% on a multicore die), the board-facing blocks on the right edge relative to the core, every link's ends on the block edges it names, every segment square and non-zero, **no link through a block it does not connect**, grid counts equal to the configuration, exactly the structures the architecture has, the catalog CPUs plan cleanly, five different floorplans; plus `gridExact`, the slicing layout and the router on small cases.

## The look (not built yet)

A die is drawn like the board's parts, not as a diagram: macro blocks with coloured rim lines and a faint tinted fill; cells as dense arrays; labels small in capitals; traces as bundles of thin parallel lines ending in solder pads, with pulses travelling along them for traffic (speed by clock, density by use); bond pads along the die border. The review mock-ups (the artifact of 2026-10-27) show this look.

## Levels of detail and live state (stage 2, planned)

Drawn in its own layer (not in the device bake): blocks and names from zoom 0.45; the cells inside them (registers, ROB entries, cache lines, predictor table, bit-slices) from about 0.9; labels on every cell, mnemonics and wire detail from about 1.8; the camera's maximum zoom rises from 3 to 6. Live: instruction chips in their block (per lane and per unit), ROB and scheduler cells coloured by state with head and tail, register cells flashing on write, cache lines valid/hit/miss, links pulsing by event counts, stall/flush/forward highlights, the interrupt controller lighting on an interrupt. The snapshot needs the engine view's lanes, the OoO structures and an event window (`protocol.ts`); a snapshot is a sampled instant (36 or more CPU cycles apart), so the animation is state-based.

## Stages

1. **Layout data, router, tests, mock-ups** (built).
2. **Snapshot data and the new renderer** for the five existing CPUs (replaces `pipeline.ts`, the `cpuArt` die, `BLOCKS`/`STAGES`; hover ids and `regions.ts` descriptions come from the plan).
3. **Sim features** (I-cache, 2-bit and bigger predictor, set-associative D-cache, shared L2; default off so existing timings do not move), **new CPU parts** and the branching tree, the picker's branching ladder with measured speed numbers.
4. Later: the multicore simulation (`cores > 1`) and the CPU gallery.
