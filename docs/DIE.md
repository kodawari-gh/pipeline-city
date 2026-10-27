# The CPU die: floorplans, links and levels of detail

Code: `src/render/cpuplan.ts` (the data model), `src/render/cpufloor.ts` (the slicing layout and the channel router), `src/render/cpuplans.ts` (the floorplan of each architecture), `src/render/cpuplan.test.ts`. Status: **stages 1 and 2 built** (the layout data and its tests; the snapshot data and the die view that draw it in the game, `src/render/dieart.ts`, `src/render/dieview.ts`, `src/sim/game/pipesnap.ts`). Not built yet: the new CPU parts and their sim features (stage 3). Background: [`CPU.md`](CPU.md) (how the CPU runs, interrupts), [`ENGINES.md`](ENGINES.md) (the pipelines), [`RENDER.md`](RENDER.md) (the board and its buses).

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

## The look (built)

A die is drawn like the board's parts, not as a diagram: macro blocks with coloured rim lines and a faint tinted fill; cells as dense arrays; names small in capitals; traces as bundles of thin parallel lines (3.2 apart) ending in solder pads, dashed for the links that carry an event (flush, forward, wakeup, interrupt); bond pads along the die border. The accent of a block is by kind (`KIND_COLOR`: data cyan, memory amber, control magenta, registers green, multiply and reorder violet), of a link by kind (`LINK_COLOR`).

- `cpuArt` (devices.ts, baked with the device, also used by the shop thumbnails) draws the package, the die and `dieFar`: stage frames, blocks, bond pads. That is all the far view shows.
- `DieView` (dieview.ts) draws `dieNear` on top, faded in by zoom: wires from about zoom 0.7, cell arrays from 0.8, the second line of a block from 1.2; names fade by their own size on screen (`label()`); the camera's maximum zoom is 6.
- A **tall, narrow block** (a queue, a latch) carries its name rotated in a 22-wide strip on its left; its cells sit beside it (`isTall`, `cellRects`).

## Live state (built)

Chips are the old pipeline chips (an instruction's mnemonic and operands, coloured by class), in the **host block** of their stage: IF the fetch block, ID the decoder of their lane, EX the ALU of their lane, MEM the load/store unit, WB the write-back block; on the out-of-order die, the decode lanes and the four execution units (a unit chip shows its progress, `2/3`). A stalled instruction rings its block, a flush bubble tints it red, a retiring chip slides out east, a squashed one drops. The out-of-order **structures** are cells: the reorder buffer (a ring: empty entries are the free space, live entries coloured waiting / executing / done, the head ringed, the tail marked), the scheduler (coloured by why an entry did not issue: operands, memory, unit, head), the fetch queue; each cell shows its mnemonic. **Event flashes** come from the counter changes since the last snapshot: a cache miss lights the D-cache, a retire the register file, an issue the result bus, a flush the fetch stage. **Pulses** run along the data, control and memory links while the machine runs, along the flush link on a flush. A snapshot is a sampled instant, so all of it is state or an event count, never a per-cycle stream.

Hover ids are **one per kind of block** (`cpu.<kind>`, the lanes of a unit share one; the stage frames are not targets); the descriptions are in `src/ui/regions.ts`, and `logic.test.ts` checks that every kind every floorplan writes has one.

Not live yet (the snapshot does not carry them): the cache lines (valid, hit, miss), the register writes, the interrupt controller's pending lines, the rename table.

## Motion and what is stored (built)

A snapshot is a sampled instant (100+ CPU cycles apart), so the die plays back a **slow-motion replay** (`diemotion.ts`, 4.5 cycles a second): the snapshot carries the last 24 cycles of every instruction (`TraceSnap`: stage code per cycle, pc, disassembly) and the writes of those cycles (`StoredSnap.events`: register writes, cache hits and fills with the evicted line, predictor updates, loads and stores). The replay rewinds the snapshot's state by those writes to the window's start and applies them cycle by cycle (`StoreReplay`, tested against the engine cycle by cycle), so the register file, the cache lines (address and first word; mnemonic in the I-cache) and the predictor counters show what they hold and change when written. The newest window starts when the current one ends (the old one fades); pausing freezes it.

Instructions are traceable: chips, packets and the wire left lit behind them (1.5 s) are in the colour of the instruction's class; a fetch sends its address out through the system bus and memory controller and the word comes back through the L2 and I-cache when there are any; a load asks the D-cache, and on a miss the line comes from RAM; a store writes through. A colour key sits under the die.

**Memory** (`ramview.ts`, `ramlayout.ts`, `src/sim/game/ramregions.ts`): the snapshot carries `ram` = a copy of the memory (`image`) and the **regions** that say what lives where (`ramRegionsOf`): the boot ROM (4 KiB, shadowed at address 0), when the OS is up its header, kernel and job table (about 1.9 KiB for OS 1.0: the kernel's 276 words, one header block and the 8-slot job table), and the program the CPU has loaded at `USER_BASE` (named `#07 calc`, its code up to its last return, its data after it). A program **claims memory by using it**: every store sets a dirty flag for its 256-byte page (`Bus.dirty`), and each base tick the pages the running program has written outside the OS and its own image become its `work` regions (`#07 scan data`, its colour, duller); they are released when it ends. The OS memory is the ROM, header, kernel and job table (`protectedPage`); a store there is refused by the memory protection unit and the OS kills the job (docs/OS.md "Memory protection"). The sim's RAM is 64 KiB whatever is installed; the sticks are the physical memory, ascending by slot number (more installed than that shows as free, less spreads the 64 KiB over the chips there are).

Each DRAM chip is a window onto an address range, cut into **pages** of 256 bytes (a block of the drive), and a page is one square cell: the colour is its owner (the ROM grey, the OS pale, a program by its job type, so one kind of program always looks the same), the strength is how full the page is. Cells are redrawn only when the memory changes. Outlines surround each region; a stick is **not aware of how full it is or how many programs run**: it shows only what the OS has put where, a key of colour and name per owner (`ROM 4K`, `OS 1.9K`, `#07 scan 2768`) and a READ / WRITE key. Usage, the process table and per-process memory belong to the OS and are on the CLI monitor (`memoryTable`: `MEM 64K  SYS 5.9K  FREE 58K`, and the running process as `RUN #07 scan  276B+1.5K`, its image plus what it claimed). The page the CPU reads (a fetch or a load: cyan) or writes (a store: magenta) outlines in that colour for 0.7 s, with a READ / WRITE key on each stick (`DieView.onMemory` -> `Live.touchRam`); the bytes themselves are only in the magnifier.

At the CPU die's zoom levels (cells 0.8x, keys 0.85x, details 1.2x; below 0.7x the traces are the picture) a **magnifier** reads the memory around the address touched last (or the program's start): nine words as address, hex and, where it is code (the ROM, the kernel, a program's code), the instruction, else the characters; each instruction has a coloured pill for its class (ALU, load, store, multiply, branch, system; a key under the magnifier), so a code area reads at a glance; the touched word is highlighted in the instruction's colour, a thread joins it to the line it reads, and the footer says what the region is for. It is sized so its text stays readable at any zoom. Not yet: RAM clock ticks as such, and bytes drawn inside a cell (deliberately: the square is the unit).

## Stages

1. **Layout data, router, tests, mock-ups** (built).
2. **Snapshot data and the new renderer** for the five existing CPUs (built: `pipeline.ts`, `BLOCKS`/`STAGES` and the fixed tiles are gone; hover ids and descriptions come from the plan; the thumbnails keep the far die).
3. **Sim features** (I-cache, 2-bit and bigger predictor, set-associative D-cache, shared L2; default off so existing timings do not move), **new CPU parts** and the branching tree, the picker's branching ladder with measured speed numbers.
4. Later: the multicore simulation (`cores > 1`) and the CPU gallery.

## The TLB
A CPU with an MMU (docs/VM.md) has a `tlb` block between the register file and the D-cache: one cell per entry, showing the virtual page and the frame it maps to (state at the snapshot), with links `fetch-tlb` and `lsu-tlb` (translate) and `tlb-walk` to the L2 or the system bus. `PlanInput.tlbEntries` (from `CpuSpec.mmu.tlb`) switches it on; the unpipelined CPU has none.
