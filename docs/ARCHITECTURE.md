# Architecture

Pipeline City is an incremental game (think Universal Paperclips) about building computing hardware. Money comes from running customer workloads, and money buys better or more hardware. A cycle-accurate CPU simulation is the economy and the show.

Status: POC. Decisions below are current, not final. The old prototype lives in `legacy/` (see `legacy/HANDOVER.md`) and is the reference for the engines and board visuals until they are ported.

## Stack

| Concern | Choice |
|---|---|
| Language / build | TypeScript + Vite, npm |
| Board rendering | PixiJS (WebGL) |
| Panels / HUD | Preact + `@preact/signals` |
| Simulation | Web Worker, from day one |
| Tests | Vitest |
| Hosting | Static site (no backend) |
| Saves | Versioned JSON, exported/imported as local files |

## Layers

```
src/sim      pure TS, runs in the worker. No DOM, no Pixi, no Preact imports.
src/game     main-thread state: owns the worker, signals, save/load, upgrades
src/render   Pixi board; reads snapshots, never touches sim internals
src/ui       Preact panels; reads signals from src/game
```

Data flows one way: the worker posts `Snapshot`s (see `src/sim/protocol.ts`), `src/game` puts them in signals, and render/ui read the signals. Player actions go back as `ToSim` messages. The protocol file is the only thing shared across the thread boundary.

## Simulation

- **Toy ISA, toy hardware that "kinda makes sense".** No real ISA or emulator. The ISA grows as programs need it.
- **Every job is a real program** run on the simulated machine. Workload types: CPU-heavy, memory-bound, GPU-bound, IO-bound, NPU/TPU-bound, needs a secure environment / TPM.
- **Devices on a bus, memory-mapped I/O.** Programs reach a CLI monitor, a GPU-driven display and disk through loads and stores to device address ranges. Bus traffic and contention are visible on the board. Tiered memory comes later.
- **Engines** (ported from legacy): unpipelined, 5-stage in-order, 2-wide in-order, out-of-order.
- **Deterministic.** Same save + seed gives the same run. Tests rely on this.

### Fidelity tiers

1. **Detailed**: cycle-accurate sim, for machines the player is looking at.
2. **Fast model**: for off-screen machines and offline catch-up. Predicts runtime from per-program stats (CPI, miss rates, I/O wait) measured by actually running the program in tier 1 once, cached per hardware config. It is calibrated from the real sim, not hand-tuned, so the two tiers cannot drift apart.

Scale is unbounded (one chip, then rack, datacenter, beyond), so tiers must be designed in, not bolted on. Only the focused machine runs tier 1.

## Game model

- Currency: dollars (placeholder). Earned per processed request, spent on hardware improvements or new hardware.
- Demand depends on how fast requests are served.
- Offline progress: on load, elapsed time x steady-state income from the fast model.

## Saves

Config only, never micro-state: `{ version, seed, money, unlocked upgrades, board layout, ... }`. Pipeline contents are rebuilt by replay on load. Every save has a `version`; add a migration when the shape changes.

## Progression

A tech tree **per device**, not one global tree. Start with CPU and RAM, then buy other devices (IO, screens, GPU, ...) when demand requires them. Each device needs good visuals and must connect to the motherboard realistically (slots, buses, traces). A machine must be fully decked out before the player may buy another one.

Early game is a guided tour (unpipelined CPU running a CLI program, then pipeline, cache, superscalar, OoO), with branching opening up as devices unlock.

## Demand

Latency-driven. Requests arrive at a rate that rises with reputation, and reputation follows recent turnaround time. Slow service shrinks demand and fast service grows it. Under-provisioned machines build visible queues.

## Power and cooling

Macro board level, and currently missing from the prototype. The PSU has a wattage budget, each device draws power under load, and cooling removes heat. A hot chip throttles its clock, which feeds back into throughput and so into the economy. A few numbers and simple feedback, not a physics sim. Devices therefore need power and thermal properties from the start.

## Programs

Authored as text `.asm` for the toy ISA, assembled by a tiny in-repo assembler (`src/sim/asm`). Programs are **generated and composable**: a library of small kernels (loop, memcpy, hash, parse, matmul, poll a device, ...) is combined by scenario templates ("web request", "GPU render / HPC", "multiprocessor simulation", "secure execution") with seeded parameters such as size, memory footprint and device calls. Output is real assembly, deterministic per seed, and must make sense: it should visibly do something on the devices it touches.

## Snapshots and threading

- One sim worker. Machines share nothing except a message bus, so sharding to a worker pool later is a scheduling change.
- The renderer tells the worker which machine is focused. That machine streams detailed state, and others send a few summary numbers per tick, so cost stays bounded as the fleet grows.
- No SharedArrayBuffer for now (needs cross-origin isolation headers, awkward on static hosting).

## Open questions

- Numbers: demand curve, reputation function, prices, upgrade costs (needs a balance pass).
- Toy ISA extensions needed for device I/O, GPU/NPU offload and secure execution.
- Calibration cache: keying (program seed + hardware config) and invalidation.
- Save file: how generated program seeds and per-machine device layouts are stored.

## Commands

```
npm run dev        # dev server
npm run build      # typecheck + production build into dist/
npm test           # vitest
```
