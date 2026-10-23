# Handover

For the next model (or person) picking this up. Read this file, then `docs/ARCHITECTURE.md`. `legacy/HANDOVER.md` describes the earlier prototype, which is the reference for the engines and board visuals until they are ported.

## What this is

Pipeline City is an incremental game (Universal Paperclips / SimCity vibe) about building a computer. Customers send requests (small generated programs). The machine runs them on a simulated toy CPU, and money comes in as they finish. Money buys better or more hardware. Demand depends on turnaround time. The sim is the economy and the show: you watch instructions move through a pipeline at 1 tick per second.

It is a **POC**. Keep things simple, iterate bit by bit, and do not build for scale you have not needed yet. Scale is "unbounded" in the long run, so leave seams for it (interfaces, fidelity tiers) but do not build the machinery early.

## State of the repo (updated after steps 1 to 10 plus the follow-up pass)

Milestone 1 is built end to end and playable in the browser: `npm run dev`. Steps 2 to 10 of the order below are DONE and committed. Check `git log` and `git status` to see what has been pushed; the owner pushes (or asks for it).

- `src/sim/`: isa, asm, ref (reference interpreter), machine (bus, clocks, PRNG), engines (unpipelined, 5-stage in-order), board (specs, slots, power/thermal), gen (program generator), game (Game, economy, save), worker + host + protocol. Docs for each: `docs/ISA.md`, `MACHINE.md`, `ENGINES.md`, `BOARD.md`, `GEN.md`, `GAME.md`, `SAVE.md`.
- `src/game/`: store (snapshot signal, actions, export/import, autosave), hover signals.
- `src/render/`: Pixi board, camera, zoomed-in CPU pipeline view (`docs/RENDER.md`).
- `src/ui/`: HUD, shop, stats drawer, tooltips, hints (`docs/UI.md`).
- `legacy/`: the old prototype, read-only reference.
- CI (`.github/workflows/ci.yml`) runs test + build and deploys to Pages from `main`.

### Known gaps and decisions waiting on the owner

- **Pacing (settled by the owner):** base tick 1 s, and the CPU runs 4 engine cycles per tick (`cpuCyclesPerClock`) so the first request takes about 28 s. Do not change it without asking.
- **CPU vs RAM (done):** the starting traffic is one third cache-hostile scan jobs, so RAM pays off for scan and the CPU for log; the best first purchase depends on the mix (see `docs/GAME.md` "CPU vs RAM" and `src/sim/game/tradeoff.test.ts`). Numbers are placeholders.
- All balance numbers are placeholders in `src/sim/game/economy.ts`.
- Machine RAM is fixed at 64K; the RAM tier only changes the cache miss penalty (and, via `minRamBytes`, optionally the job mix). The board upgrade (`board1`, $300) exists and unlocks the 250 W PSU; there is only one board upgrade so far.
- Engines: only unpipelined and in-order exist. Superscalar and out-of-order, the fast model, offline catch-up, GPU, multicore, security workloads and multi-machine are all still to do (see `docs/ARCHITECTURE.md`). Decode no longer allocates per fetched instruction.
- Visual gaps: text softens above 2x zoom, GPU/M.2/SATA are decor only, only single-width pipelines are drawn, touch hit-testing was not exercised (mouse and wheel only), no real-GPU frame times (software GL: about 17 fps with the die view at 16x). The UI drawer no longer hides the PSU (the camera frames the free area, see `docs/RENDER.md`). Hint toasts stack up to several cards high when many fire at once.
- Early game: a scan job (about 220 s on the starting machine) can arrive as the second request, so the first $100 can take 250+ s on unlucky seeds. Part of the CPU-vs-RAM design; tune `mix` weights and `payMul` if it feels bad.
- Verified in headless Chrome (software GL) after the follow-up pass: power-cycle button after a PSU trip, clock warnings (near-throttle, unstable, burnt), the Continue / New game prompt, speeds 1x/4x/16x/pause (tick rates match), and the hints stall, throttle, overheat, queue, burnt, trip, brownout. Underclock only changes the label (there is no underclock warning by design). Not verified: touch, real GPU.
- Browser checks were done with playwright-core and headless Chrome; it is not in package.json.

## Decisions already made (do not relitigate without asking)

The full list with reasoning is in `docs/ARCHITECTURE.md`. The headline ones:

- Sim runs in a **Web Worker** with no DOM imports. One-way data flow: worker snapshots -> signals in `src/game` -> render and UI.
- **Toy ISA** with its own assembler, 32-bit words, 16 registers, RISC-V-like formats, memory-mapped I/O. **Exact opcodes and encodings are your call**, just keep it plausible.
- Programs are **generated and composable** (kernels + scenario templates, seeded, deterministic).
- **Two fidelity tiers**: cycle-accurate for the machine being watched, a fast model calibrated from real runs for everything else (and offline catch-up).
- Default speed is **1 tick per second**, each device on its own clock (divider/multiplier), overclockable, with heat -> throttle -> errors -> damage.
- Devices are **declarative data specs**; the board has typed slots; power (PSU watts) and cooling are core.
- Saves are **config-only JSON files** (export/import). In-flight requests restart on load. Per-machine seeded PRNG state is saved.
- **Typed arrays (structure-of-arrays)** for sim state. This was the owner's explicit choice over plain objects. Engines own their pipeline arrays, and CPU upgrades apply only between requests.
- Milestone 1 scope is below. Everything else (GPU, NPU, multi-machine, world map) is later.

## Working agreements with the owner

- The owner likes to be **grilled with concrete multiple-choice questions** before big design forks, one small batch at a time, with a recommended option first. They have answered "keep grilling" several times. Ask before committing to something large; do not ask about things with an obvious default.
- Keep it **simple**. They said so explicitly. No speculative abstractions, no frameworks beyond what is chosen.
- **Commit often, but only push when asked** (the very first push was authorised; later pushes were not). End commit messages with the Co-Authored-By line from the harness reminder.
- Visual direction: cyberpunk-minimal, dark/light toggle, minimal text, explanations on hover. Not a copy of Mini Metro.

## Gotchas

- Git on this machine had a cached credential for the wrong GitHub account (`kmhirsi-code`). This repo has a local credential helper pointing at `gh`, so pushes use whichever account `gh auth switch` has active (should be `kodawari-gh`). If you see a 403, check `gh auth status`.
- Windows machine. Both PowerShell and Bash tools exist; use Bash for POSIX scripts. PowerShell mangles empty-string arguments.
- `.gitattributes` forces LF. `dist/` is gitignored (but `legacy/dist` is tracked).
- The legacy prototype uses plain objects per dynamic instruction. The new sim uses typed arrays, so engines are a re-implementation, not a copy-paste. Use the legacy engines for behaviour and the hazard rules, and `legacy/tools/test-sim.js` for the testing idea (compare against a reference interpreter with random cache invalidations and predictor flips).

## Milestone 1 (definition of done)

One PC: CPU + RAM + PSU + cooling on a board with typed slots. One generated CLI workload that writes real text to a memory-mapped framebuffer. Money loop with latency-driven demand. Clock domains with heat and throttling. A CPU-vs-RAM purchase decision. Export/import of a save file. First request takes about 20 to 40 seconds at 1 Hz on the starting unpipelined CPU.

## Original order of work (steps 1 to 10 done; kept for reference)

Do these as small commits. Each step should leave `npm test` and `npm run build` green.

1. **Housekeeping.** Push, enable Pages, confirm CI passes.
2. **ISA + assembler + reference interpreter** (`src/sim/isa`, `src/sim/asm`). Pick opcodes, formats, register roles. Round-trip tests: assemble then disassemble. The reference interpreter is a trivial functional executor used as ground truth.
3. **Machine and clock scheduler** (`src/sim/machine`). Typed-array RAM, registers, devices on a bus, sub-tick scheduler with per-device dividers. Deterministic, with a seeded PRNG.
4. **Unpipelined engine, then 5-stage in-order**, checked against the reference interpreter on generated programs. Add golden cycle traces for a few programs.
5. **Device specs and the board model**: data records for CPU, RAM, PSU, cooler, display. Typed slots, power budget, heat model, throttling.
6. **Program generator**: a few kernels and a "CLI request" template, seeded and deterministic, emitting assembly that prints text to the display device.
7. **Economy**: request arrivals, reputation from turnaround time, money, purchases (CPU tier vs RAM tier).
8. **Save/load**: versioned JSON, export/import, restart in-flight requests on load.
9. **Rendering**: port the board and chip art from `legacy/src` (c2/c3a/c3b) to Pixi, one layer at a time, driven by snapshots. Add the zoomed-in CPU view.
10. **UI**: HUD, purchase panel, speed control, hover tooltips, hints.

Fast model, offline catch-up, GPU, multicore, security, and out-of-order come after milestone 1, in roughly that order. Do not build them early.

## Open questions

Listed at the bottom of `docs/ARCHITECTURE.md`. The ones you will hit first: typed-array conventions per engine, and the balance numbers (demand curve, reputation function, prices). For the numbers, start with something that makes the first request pay out within a minute and the first upgrade affordable within a few minutes, then tune by playing.

## First message to send the owner

Summarise what you read, say which step of the order above you are starting, and ask only what blocks you. Do not re-ask settled decisions.
