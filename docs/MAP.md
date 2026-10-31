# Codebase map

High-level view of Pipeline City. Read this first, then go to one feature folder.

## Find code with CocoIndex first
Use the `cocoindex-code` MCP tool (`mcp__cocoindex-code__search`) before Grep or Glob when you do not know the file name.
- Ask in plain words: "where does the OS spool a job", "GPU warp scheduling". It finds code by meaning.
- Start with `limit: 5`. Filter with `paths: ["src/features/gpu/*"]` or `languages`.
- Use Grep only for an exact symbol, such as a `Game` method name.

## The three layers
```
 main thread                                   web worker
 ┌─────────────────────────────────────┐       ┌───────────────────────────────┐
 │ features/*/ui     Preact panels     │ ToSim │ worker/worker.ts  message loop │
 │ features/*/render Pixi views        │ ────► │ worker/game/game.ts  Game      │
 │ app/store.ts      signals, saves    │       │ features/*/sim   Game methods, │
 │ app/main.tsx      mounts the app    │ ◄──── │   machine, CPU/GPU, OS, jobs   │
 └─────────────────────────────────────┘Snapshot└───────────────────────────────┘
```
- `sim` code is pure TypeScript with no DOM, Pixi or Preact. It runs only in the worker.
- `src/worker/protocol.ts` is the only code shared across the thread boundary: `ToSim` (actions in), `Snapshot` (state out, once per tick).
- `render` and `ui` read the snapshot through signals in `src/app/store.ts`. They never touch sim internals.
- Rules are checked by `src/architecture.test.ts`.

## Top-level folders
| Folder | Holds |
|---|---|
| `src/app` | `main.tsx` entry, `store.ts` (owns the worker, signals, save/load), `hover`, `interaction`, `scrub` |
| `src/worker` | worker entry, `host.ts`, `protocol.ts`, `crash.ts`; `game/` is the `Game` state, snapshot and save/restore (`SAVE.md`) |
| `src/core/sim` | the machine model every feature shares: `Machine`, bus, clock, interrupts (`intc`), timer, PRNG, display, `Engine` base (`MACHINE.md`) |
| `src/core/render` | Pixi helpers: camera, theme, `ink` (text), shape, LOD, `live.ts` (per-frame binding of snapshot to views), `interact.ts` (drag and click) |
| `src/core/ui` | `Hud`, toasts, `ui.css`, `kit/` (icons, meter, sprite), shared UI state |
| `src/features/<f>` | one folder per feature, see below |
| `docs/` | cross-cutting docs: `ARCHITECTURE.md`, `RENDER.md` (+ `render/`), `UI.md`, `TODO.md` |

## Features
Each has `sim/`, `render/`, `ui/` as needed, and its doc at the folder root.

| Feature | What it is | Doc |
|---|---|---|
| `cpu` | toy ISA, assembler, reference interpreter, 4 timed engines (unpipelined, in-order, out-of-order), cores and threads, die view, trace panel | `CPU.md`, `ISA.md`, `ENGINES.md`, `ASSEMBLY.md`, `DIE.md`, `MULTICORE.md` |
| `gpu` | SIMD/warp engine, GPU ISA and kernels, card view | `GPU.md`, `ACCEL.md` |
| `npu`, `tpm` | NPU and TPM devices, kernels, card views | (see `GPU.md`, `ACCEL.md`) |
| `memory` | RAM sticks, DRAM timing, MMU/MPU, paging, bit flips, RAM view | `RAM.md`, `VM.md` |
| `storage` | drives, file system, disk views | |
| `network` | NIC, link, transfers, network panel, wall cords | `NETWORK.md`, `NETSTACK.md` |
| `os` | kernel (toy assembly), job table, spool, OS window | `OS.md` |
| `board` | board tiers, parts, cables, VRM, thermal, PCH, board art and routing | `BOARD.md`, `VRM.md` |
| `economy` | money, shop, prices, levels, contracts, power bill, clients, reputation | `GAME.md`, `PROGRESSION.md`, `TECHTREE.md` |
| `jobs` | job generator (kernels + templates, seeded), job dex, job log, almanac | `JOBS.md`, `GEN.md` |
| `room` | desk, wall, monitor, props, light, time of day | `room.md`, `shell.md`, `light.md` |
| `sandbox` | sandbox tools and the speed benchmark | `SANDBOX.md` |
| `tutorial` | tutorial steps, anchors, highlight | |

## How the pieces fit
1. **The player builds a machine.** Parts live in `board`. `board/sim/apply.ts` wires the board into a `core/sim` `Machine`.
2. **Jobs are real programs.** `jobs/sim/gen` builds assembly per seed. A client key carries it. The machine (or the OS kernel) runs it on the chosen `cpu` engine, and the result pays through `economy`.
3. **`Game` is the state.** `worker/game/game.ts` holds it. Its methods are plain functions in `features/*/sim` written `function x(this: Game, ...)`, mixed in at the bottom of `game.ts`. Grep the method name to find the owner.
4. **Each tick** the worker posts a `Snapshot`. `app/store.ts` puts it in signals. `core/render/live.ts` feeds the Pixi views, and Preact panels re-render.
5. **Player input** goes back as `ToSim` messages (`store.ts` to `worker.ts` to a `Game` method).

## Known debt
`core/` still imports `features/` in about 82 places, mainly `core/render/live.ts`, `core/render/interact.ts`, `core/sim/machine.ts` and `core/ui/Hud.tsx`. They are composition roots. `architecture.test.ts` lets the count only fall.

## Commands and tests
See `CLAUDE.md`. A test sits next to the file it covers; run `npx vitest run <path>`.
