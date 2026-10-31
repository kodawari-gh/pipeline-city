# Codebase map

High-level view of Pipeline City. Read this first, then go to one feature folder.

## Find code with CocoIndex first
Use the `cocoindex-code` MCP tool (`mcp__cocoindex-code__search`) before Grep or Glob when you do not know the file name.
- Ask in plain words: "where does the OS spool a job", "GPU warp scheduling". It finds code by meaning.
- Start with `limit: 5`. Filter with `paths: ["src/features/gpu/*"]` or `languages`.
- Use Grep only for an exact symbol, such as a `Game` method name.

## The layers
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
- `src/worker/protocol.ts` is the only code shared across the thread boundary: `ToSim` in, `Snapshot` out (once per tick).
- `render` and `ui` read the snapshot through signals in `src/app/store.ts`. They never touch sim internals.
- `src/architecture.test.ts` checks the rules. Keep folders small: split above about 10 source files.

## Shared folders
| Folder | Holds |
|---|---|
| `app/` | `main.tsx` entry, `store.ts` (owns the worker, signals, save/load), hover, interaction, scrub |
| `worker/` | worker entry, `host`, `protocol`, `crash`; `game/` is the `Game` state, snapshot, save (`SAVE.md`) |
| `core/sim/` | machine model: `machine`, `engine` base, `memmap`, `prng`; `hw/` bus, device, interrupts, timer, clock, display (`MACHINE.md`) |
| `core/render/` | Pixi helpers: camera, theme, ink, shape, `live` (snapshot to views), `interact` (drag, click); `lod/` level of detail |
| `core/ui/` | `Hud`, state, logic, `ui.css`; `panels/` log, crash, stats, toasts, new game; `kit/` icons, meter, sprite |
| `docs/` | `ARCHITECTURE`, `RENDER` (+ `render/`), `UI`, `TODO`, this file |

## Features (`src/features/<f>/`, doc at the folder root)
| Feature | What it is | Subfolders |
|---|---|---|
| `cpu` | toy ISA, assembler, reference interpreter, timed engines, cores, threads, die view (`CPU`, `ISA`, `ENGINES`, `ASSEMBLY`, `DIE`, `MULTICORE`) | `sim/{isa,asm,ref,engines/{smp,timing},multicore}` `render/{die,core}` `ui` |
| `gpu` | SIMD and warp engine, GPU ISA, kernels, card view (`GPU`, `ACCEL`) | `sim/{isa,engine}` `render/plan` `ui` |
| `npu`, `tpm` | NPU and TPM devices, kernels, card views | `sim` `render` `ui` |
| `memory` | RAM sticks, DRAM timing, MMU and MPU, paging, bit flips (`RAM`, `VM`) | `sim` `render` |
| `storage` | drives, file system, disk views | `sim` `render` |
| `network` | NIC, link, transfers, network panel (`NETWORK`, `NETSTACK`) | `sim` `render` `ui` |
| `os` | kernel in toy assembly, job table, spool, OS window (`OS`) | `sim` `ui` |
| `board` | board tiers, parts, cables, VRM, thermal, PCH, board art (`BOARD`, `VRM`) | `sim/{game,pch}` `render/{layout,wiring}` `ui` |
| `economy` | money, shop, levels, contracts, power bill, clients (`GAME`, `PROGRESSION`, `TECHTREE`) | `sim` `ui/{shop,progress}` |
| `jobs` | seeded job generator, job dex, job log, almanac (`JOBS`, `GEN`) | `sim/gen` `ui` |
| `room` | desk, wall, monitor, props, light (`room`, `shell`, `light`) | `render/{shell,desk/props}` |
| `sandbox` | sandbox tools, speed benchmark (`SANDBOX`) | `sim` `ui` |
| `tutorial` | tutorial steps, anchors, highlight | `ui` |

## How the pieces fit
1. **The player builds a machine.** Parts live in `board`. `board/sim/apply.ts` wires the board into a `core/sim` `Machine`.
2. **Jobs are real programs.** `jobs/sim/gen` builds assembly per seed. A client key carries it. The machine (or the OS kernel) runs it on a `cpu` engine. The result pays through `economy`.
3. **`Game` is the state.** `worker/game/game.ts` holds it. Its methods are plain functions in `features/*/sim` written `function x(this: Game, ...)`. Grep the method name to find the owner.
4. **Each tick** the worker posts a `Snapshot`. `app/store.ts` puts it in signals. `core/render/live.ts` feeds the Pixi views and Preact panels re-render.
5. **Player input** goes back as `ToSim` messages (`store.ts`, then `worker.ts`, then a `Game` method).

## Known debt
`core/` imports `features/` in about 80 places: `core/render/live.ts`, `interact.ts`, `core/sim/machine.ts`, `core/ui/Hud.tsx` are composition roots. `architecture.test.ts` lets the count only fall.

## Commands and tests
See `CLAUDE.md`. A test sits next to the file it covers: `npx vitest run <path>`.
