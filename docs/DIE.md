# The CPU die: floorplans, links and levels of detail

Code: `src/render/cpuplan.ts` (the data model and helpers), `src/render/cpuplans.ts` (the floorplan of each architecture), `src/render/cpuplan.test.ts`. Status: **stage 1 built** (the layout data and its tests; mock-ups reviewed by the owner). Not built yet: the renderer that draws it in the game (it still draws the old fixed tiles in `layout.ts`/`devices.ts`/`pipeline.ts`), the snapshot data that lights it, the new CPU parts. Plan and order: below ("Stages"). Background: [`CPU.md`](CPU.md) (how the CPU runs, interrupts), [`ENGINES.md`](ENGINES.md) (the pipelines), [`RENDER.md`](RENDER.md) (the board).

## Why

Every CPU used to share one floorplan (five stage tiles in a row plus filler blocks the sim does not model). Now each architecture has its own die, drawn from what its engine really has, with every part visible and linked, like a block diagram of a real processor. Nothing is decoration: a block is there because the sim has it (or, for the clock and interrupt controller, because the machine has it).

## The data model (`cpuplan.ts`)

`cpuPlan(input) -> CpuPlan { arch, cores, die, blocks, links, tiles? }` in die coordinates (the die is `DIE` in `layout.ts`, 1420 x 1130, centred on the socket). `planInput(engineConfig, extra)` maps a spec's `EngineConfig` (plus the feature knobs: `icacheLines`, `ways`, `l2Lines`, `predEntries`, `predBits`, `cores`) to the input, so a new CPU spec renders without drawing code.

- **Block** `{ id, kind, label, sub?, rect, grid?, parent?, stage?, lane?, unit?, core? }`. `grid` = the cells a structure shows (`count` cells in `cols` x `rows`; `ring` for queues): registers (16), ROB entries, scheduler entries, fetch queue slots, cache lines, predictor entries. `parent` = the stage frame a sub-block sits in. `stage` = pipeline stage index of a frame (instruction chips sit in it). `unit` = the OoO functional unit (`ALU0 ALU1 MUL LSU`) whose chips sit in the block. Ids are the hover ids: `cpu.<id>` (`c<k>.<id>` on a multicore die).
- **Link** `{ id, kind, from, to, pts, width, label?, both? }`: an orthogonal polyline from the edge of `from` to the edge of `to`. Kinds: `data`, `mem` (bus to memory), `mmio` (device access that skips the cache), `control`, `forward`, `wakeup`, `flush` (mispredict squash), `irq` (interrupt vector). Width 1 control, 2 data word, 3 wide bus.
- **Routing helpers**: `edgePoint`, `ortho` (square routes, a Z when both ends face the same way, collinear points dropped), the `Builder` with `frame`, `add`, `link`, `ty`/`tx` (fraction along an edge for an absolute y/x).

## The grammar (all architectures)

Instruction flow runs **west to east**. The **clock** and the **interrupt controller** are in the north-west corner (the interrupt controller's vector link goes to the PC). The **branch predictor** (or, on the unpipelined CPU, the **sequencer**) runs along the north. The **register file** is under decode and execute, its read ports fed from decode and its write port from write-back (commit on the OoO core). The **I-cache** (when the CPU has one) is south-west under fetch, the **D-cache** south-east under the load/store unit, an **L2** (when present) a strip across the bottom, and the **bus interface** is the east column facing the package pins and the memory bus. Long wires travel in lanes between the north band and the stage row (device access, the two forwarding paths, the mispredict redirect, the predicted target) and in a lane along the bottom.

## The floorplans

| CPU | What is drawn |
|---|---|
| cpu0 unpipelined | A **sequencer** with five phase cells; five phase frames with PC, PC+4, next-PC mux, fetch; immediate generator, decoder; branch unit, ALU; device check, load/store unit; write-back mux; register file (2 read, 1 write); D-cache; no latches, no predictor, no forwarding, fetch straight to the bus interface. |
| cpu1 five-stage | Five stage frames joined by four pipeline registers (IF/ID, ID/EX, EX/MEM, MEM/WB); a hazard unit that stalls until write-back; predictor learning from the branch unit; the mispredict redirect/squash wire. |
| cpu2 five-stage + forwarding | cpu1 plus the forwarding unit fed from EX/MEM and MEM/WB through the stage's east margin. Hazard unit becomes load-use only. |
| cpu3 two-wide | Fetch x2, a pair/issue unit above two decoders, two ALUs, one load/store unit (one memory operation a cycle), register file with 4 read and 2 write ports. |
| cpu4 out of order | IF frame, fetch queue (ring), decode (one decoder per lane of width), rename table (16 cells) + dispatch, scheduler (entries), ALU 0, ALU 1, multiplier, load/store unit, one **result bus** that wakes the scheduler, fills the reorder buffer (ring of `robSize` cells with head and tail) and resolves branches; the ROB commits into the register file; the load/store unit has the D-cache and the device path. |
| Variants | An I-cache fills the south-west; D-cache and predictor tables scale their cells; ways show as columns; an L2 strip joins both L1s to the bus interface; a bigger ROB/scheduler/queue grows cells inside the same frames; width adds decoders (the frame grows). |
| Multicore (`cores: n`) | n complete core tiles scaled into the die (each with its own clock, interrupt input, predictor, registers, D-cache); a **coherence ring** bar above each row of tiles and a trunk joining the bars to a shared column: the memory controller and one **shared L2**. Server style = many small tiles, HPC style = one big OoO tile. Nothing multicore is simulated yet. |

## Tests (`cpuplan.test.ts`)

For fourteen configurations (every architecture, with and without the optional parts, wide and scalar OoO, 2, 4, 16 cores): every block inside the die, no overlaps (a child inside its frame), unique ids, every link's ends on the edge of the blocks it names, every segment square and non-zero and inside the die, **no link runs through a block it does not connect**, grid counts equal the configuration (ROB cells = `robSize`, D-cache lines = `cacheLines`, registers 16...), exactly the structures the architecture has, the five catalog CPUs plan cleanly, five different floorplans, and the routing helper.

## Levels of detail and live state (stage 2, planned)

Drawn in its own layer (not in the device bake): blocks and names from zoom 0.45; the cells inside them (registers, ROB entries, cache lines, predictor table) from about 0.9; labels on every cell, mnemonics and wire detail from about 1.8; the camera's maximum zoom rises from 3 to 6. Live: instruction chips in their block (per lane and per unit), ROB and scheduler cells coloured by state with head and tail, register cells flashing on write, cache lines valid/hit/miss, links pulsing by event counts and speed by clock, stall/flush/forward highlights, the interrupt controller lighting on an interrupt. The snapshot needs the engine view's lanes, the OoO structures and an event window (`protocol.ts`); a snapshot is a sampled instant (36 or more CPU cycles apart), so the animation is state-based.

## Stages

1. **Layout data, tests, mock-ups** (built).
2. **Snapshot data and the new renderer** for the five existing CPUs (replaces `pipeline.ts`, the `cpuArt` die, `BLOCKS`/`STAGES`; hover ids and `regions.ts` descriptions come from the plan).
3. **Sim features** (I-cache, 2-bit and bigger predictor, set-associative D-cache, shared L2; default off so existing timings do not move), **new CPU parts** and the branching tree (front-end branch, memory branch, wider OoO), the picker's branching ladder with measured speed numbers.
4. Later: the multicore simulation (`cores > 1`) and the CPU gallery.
