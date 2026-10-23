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
- **Instructions are encoded words in memory.** The assembler emits binary, the CPU fetches through the I-cache and decodes in ID, so fetch traffic, I-cache misses and shared-memory-port structural hazards are real.
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

Config only, never micro-state: `{ version, per-machine seed + PRNG state, money, board tier, installed devices and their tier / clock settings, queued requests (as program seeds), ... }`. Every save has a `version`; add a migration when the shape changes. Saves are exported and imported as local files.

On load, **in-flight requests restart from their first instruction** with cold caches and pipelines. There is no action log and no micro-state snapshot.

## Time and clocks

The detail view is slowed so it can be appreciated: the default is **1 tick per second**, and the player can pause or speed up (1x, 4x, 16x, ...) like a city-builder. Money per tick is scaled so income feels right at 1x.

Each device has its own clock (CPU, RAM, GPU, ...), set by a divider/multiplier off the base tick. The scheduler advances in fine sub-ticks and a device steps when its accumulated phase crosses a tick, which is deterministic and lets rates change at runtime. Transfers across clock domains have explicit latency.

Players can overclock or underclock each supported device. The ladder is: more clock means more power and heat, then throttling, then instability (errors, retries, crashes), then sustained excess can burn out a part that must be replaced. Instability draws from a **seeded PRNG per machine, with its state in the save**, so behaviour is reproducible in tests and across load.

## Devices and the board

- **Devices are declarative specs** (data, not classes): slot and bus type, power draw, heat, clock range, per-tier stats, and visual hooks. The sim and the renderer read the same record, so adding a device is mostly adding data.
- **The board is fixed with typed slots and ports that fill up** (DIMM, PCIe, SATA, USB, power connectors). A device only fits a matching free slot, and the PSU needs a matching connector and enough watts. Board and PSU tiers are part of the tree.
- **Each device has a stylised-but-recognisable internal view** showing its real structure in simplified form (pipeline, DRAM banks and rows, GPU SMs, disk platter or flash channels), animated from sim state.
- **Multicore:** cores have private L1 and share L2/RAM through a simplified invalidate-on-write coherence rule. Sharing causes visible contention. Programs can be single-threaded or split by a template.
- **Security:** secure workloads need a TPM or secure enclave device to be accepted, and run in a protected mode with real, visible cycle costs (attestation steps, encrypted memory traffic, extra latency).

## Progression

A tech tree **per device**, not one global tree. Start with CPU and RAM, then buy other devices (IO, screens, GPU, ...) when demand requires them. Each device needs good visuals and must connect to the motherboard realistically (slots, buses, traces). A machine must be fully decked out before the player may buy another one.

The game is an open-ended sandbox in the spirit of SimCity, not a Paperclips-style ending. At the far end, many datacenters appear on a world map.

Early game is a guided tour (unpipelined CPU running a CLI program, then pipeline, cache, superscalar, OoO), with branching opening up as devices unlock.

## Demand

Latency-driven. Requests arrive at a rate that rises with reputation, and reputation follows recent turnaround time. Slow service shrinks demand and fast service grows it. Under-provisioned machines build visible queues.

## Power and cooling

Macro board level, and currently missing from the prototype. The PSU has a wattage budget, each device draws power under load, and cooling removes heat. A hot chip throttles its clock, which feeds back into throughput and so into the economy. A few numbers and simple feedback, not a physics sim. Devices therefore need power and thermal properties from the start.

## Programs

Authored as text `.asm` for the toy ISA, assembled by a tiny in-repo assembler (`src/sim/asm`). Programs are **generated and composable**: a library of small kernels (loop, memcpy, hash, parse, matmul, poll a device, ...) is combined by scenario templates ("web request", "GPU render / HPC", "multiprocessor simulation", "secure execution") with seeded parameters such as size, memory footprint and device calls. Output is real assembly, deterministic per seed, and must make sense: it should visibly do something on the devices it touches.

## Sim internals

State lives in **typed arrays (structure-of-arrays) from the start**, not per-instruction objects. This is a deliberate choice for the unbounded-scale goal and cheap worker transfer. The legacy prototype used plain objects and ran 6 to 10 microseconds per cycle, so the cost is development friction (harder to write and debug while the design moves), not a need for speed at the default 1 Hz. Keep engine code behind interfaces so layouts can change per engine.

## Snapshots and threading

- One sim worker. Machines share nothing except a message bus, so sharding to a worker pool later is a scheduling change.
- The renderer tells the worker which machine is focused. That machine streams detailed state, and others send a few summary numbers per tick, so cost stays bounded as the fleet grows.
- No SharedArrayBuffer for now (needs cross-origin isolation headers, awkward on static hosting).

## Pacing and first decision

At 1 tick/s the first request should take **about 20 to 40 seconds** on the starting unpipelined CPU, roughly 20 to 40 instructions of generated CLI program. Faster hardware shrinks that sharply. The first purchase is a visible **CPU vs RAM trade-off**: with limited money the player picks a faster clock or more RAM/cache, and the first workload's profile makes each pay off differently.

## Devices as seen by programs

The CLI monitor is a memory-mapped framebuffer. Generated programs write real strings (status lines, job ids, progress) with store instructions, so what the player reads is produced by the program and slow device writes are visible on the bus.

## Calibration cache

Fast-model entries are keyed by **program seed + hardware-config hash**, measured lazily on first run and **persisted in the save**, so offline catch-up works on load. Changing a part invalidates only affected entries.

## Verification

Every engine configuration must match a trivial reference interpreter on generated programs with random hazards (as in `legacy/tools/test-sim.js`). On top of that: golden cycle traces for a few programs to catch accidental timing changes (timing drives the economy), and a determinism test per seed.

## Look and feel

Cyberpunk-minimal with a dark/light toggle, as in the prototype. Theme tokens drive both Pixi and Preact. Minimal text, with explanations on hover and a few contextual hints on first occurrence of something (first stall, overheat, queue). No tutorial. No audio for the POC.

## Milestone 1

One PC: CPU + RAM + PSU + cooling, one generated CLI workload, the money loop (spend on a CPU or RAM tier), clock domains with heat and throttling, board with typed slots, and export/import of a save. Thin but complete, to prove the architecture end to end before adding devices. The old prototype's engines get ported as the CPU needs them.

## Platforms and delivery

Desktop first. Pointer events stay generic so touch pan/pinch works on the board, but panels are not optimised for phones. CI (GitHub Actions) runs typecheck, tests and build on every push, and deploys to GitHub Pages from `main`.

## Open questions

- Typed-array layout per engine (see Sim internals) and the shared conventions for it.
- Numbers: demand curve, reputation function, prices, upgrade costs (needs a balance pass).
- Toy ISA extensions needed for device I/O, GPU/NPU offload and secure execution.
- Exact shape of the world-map / datacenter layer (far future, not designed).

## Commands

```
npm run dev        # dev server
npm run build      # typecheck + production build into dist/
npm test           # vitest
```
