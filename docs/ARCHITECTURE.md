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

## Open questions

- Demand curve and upgrade tree (needs game design pass).
- Snapshot size and rate once many machines exist (diffing vs full snapshots).
- Where the assembler for toy-ISA programs lives (`src/sim/asm`?) and what the program format is.
- Multi-machine scheduling in the worker (one worker, or one per machine group).

## Commands

```
npm run dev        # dev server
npm run build      # typecheck + production build into dist/
npm test           # vitest
```
