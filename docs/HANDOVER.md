# Handover

For the next model (or person) picking this up. Read this file, then `docs/ARCHITECTURE.md`. `legacy/HANDOVER.md` describes the earlier prototype, which is the reference for the engines and board visuals until they are ported.

## What this is

Pipeline City is an incremental game (Universal Paperclips / SimCity vibe) about building a computer. Customers send requests (small generated programs). The machine runs them on a simulated toy CPU, and money comes in as they finish. Money buys better or more hardware. Demand depends on turnaround time. The sim is the economy and the show: you watch instructions move through a pipeline at 1 tick per second.

It is a **POC**. Keep things simple, iterate bit by bit, and do not build for scale you have not needed yet. Scale is "unbounded" in the long run, so leave seams for it (interfaces, fidelity tiers) but do not build the machinery early.

## State of the repo (updated after steps 1 to 10, the follow-up pass, and the assembly/boot/USB-keys phase)

Milestone 1 is built end to end and playable in the browser: `npm run dev`. Steps 2 to 10 of the order below are DONE and committed. Check `git log` and `git status` to see what has been pushed; the owner pushes (or asks for it).

- `src/sim/`: isa, asm, ref (reference interpreter), machine (bus, clocks, PRNG), engines (unpipelined, 5-stage in-order), board (specs, slots, power/thermal, cables), gen (program generator), pch (platform controller hub: boot ROM, USB host, display control), game (Game, economy, save, key tray, bot operator), worker + host + protocol. Docs for each: `docs/OS.md`, `docs/TECHTREE.md`, `docs/ISA.md`, `MACHINE.md`, `ENGINES.md`, `BOARD.md`, `GEN.md`, `GAME.md`, `SAVE.md`, and **`docs/ASSEMBLY.md` (the Game API for installing parts, cables, power, boot phases, USB keys, progress flags)**.
- `src/game/`: store (snapshot signal, actions, export/import, autosave), hover signals.
- `src/render/`: Pixi board, camera, zoomed-in CPU pipeline view (`docs/RENDER.md`).
- `src/ui/`: HUD, shop, stats drawer, tooltips, hints (`docs/UI.md`).
- `legacy/`: the old prototype, read-only reference.
- CI (`.github/workflows/ci.yml`) runs test + build and deploys to Pages from `main`.

### Assembly phase (done): what changed

- The game starts with a **bare board and a starter crate** (inventory: CPU, PSU, RAM, monitor and the stock cooler; nothing is mounted. The cooler mounts on the CPU: tutorial step 2, flag `coolerInstalled`, POST error `NO CPU COOLER` without it; see ASSEMBLY.md. The renderer must show an empty cooler slot as the normal start). Purchases go to the **inventory**; parts and cables are installed/connected only while the machine is **off**. The old "deferred purchase" mechanism is gone.
- A **PCH** device holds the **boot ROM** (a loader in the toy ISA, run on the real CPU engine, so boot time depends on CPU speed), the USB host registers and the display control. Each job: power-on/reboot -> POST -> wait for key -> copy the key's program through MMIO -> run -> write result -> REMOVE KEY -> reboot. One reboot per job; an OS later removes it (seam: the ROM's last `j reset` and `Game.ejectKey`).
- **Client requests are USB keys in a tray** (the queue, cap 10). The player plugs one (`plugKey`), removes it when done (`ejectKey`); payout and reputation are applied on removal. `WorkSource` (`src/sim/game/work.ts`) is the seam for a router/ethernet later.
- Save is **v2** (with a v1 migration), and a `progress` object of tutorial milestones is part of the Game/snapshot/save. See `docs/ASSEMBLY.md` for the whole API; `src/sim/game/operator.ts` is a bot player used by the tests.
- The old UI keeps working through a minimal "Machine" section in `src/ui/Shop.tsx`; the real UI (drag and drop, hover, key tray, contextual shop, tutorial) and the renderer still show the old model and are the next phase.

### Storage and OS v1 phase (done)

Drives (HDD, SATA SSD, NVMe) are real typed `sata` / `m2` slot devices and memory-mapped block devices with simulated latency per tier; **OS v1** (resident, single-task) is a purchasable item installed onto a drive, with a kernel in toy-ISA asm that the PCH ROM loads from storage after POST. With an OS the machine boots once, ingests USB keys into a disk-backed job queue, runs one program at a time and returns results through a second plug of the key (payout then). Save is **v3 at that phase, now v4** (migration from v2; v2 games keep the reboot-per-job flow). Docs: [`OS.md`](OS.md) (everything), [`TECHTREE.md`](TECHTREE.md) (the unlock principle: money + real hardware requirements, no research points, with the planned ladders). The renderer and UI still show the old model for the new devices (see the list in OS.md / the phase report): drawing the drives in the sata/m2 slots, the OS queue and the new phases is the next visual phase. The network `WorkSource` is not built.

### Board ladder and VRM phase (done in the sim)

The motherboard is a four-tier ladder (Starter with 1 DIMM, 1 SATA, 1 USB, 1 HDMI, no PCIe/M.2/ethernet; Basic; Mainstream; Enthusiast) and each tier has a simulated **VRM** (phases, amps, efficiency curve, ripple) with its own temperature in the thermal model: its loss counts against the PSU, a hot VRM trims the CPU clock, overload or heat causes "VRM voltage droop" crashes, and sustained trouble burns the board (dead until you buy a board of the same or higher tier, powered off, parts carry over). A purchasable VRM heatsink (`vrm-sink`, 3 tiers) cools it; air CPU coolers also help the VRM, liquid ones do not. Save is **v4** (old tier 0 -> Basic, old tier 1 -> Mainstream). Everything is in [`VRM.md`](VRM.md) (design, numbers, snapshot); the renderer and UI still need to draw the new parts (list in the phase report: unpopulated slots on one shared layout, VRM phase blocks, heatsink, VRM temperature and load readout, board-dead state, tooltips). Ethernet is a `features.ethernetMbps` field only; the network phase is next.

### Known gaps and decisions waiting on the owner

- **Pacing (retuned for the boot, owner decision 6):** base tick 1 s, and the CPU runs 36 engine cycles per tick (`cpuCyclesPerClock`) so the first complete job (power-on, POST, plug, load, run, write, remove) takes 45-48 s with a payout of about $50. It was 4 before the boot ROM existed. Do not change it without asking.
- **CPU vs RAM (done, retuned):** the starting traffic is one third cache-hostile scan jobs (scale 4), so RAM pays off for scan and the CPU for log and for every boot; the best first purchase depends on the mix (see `docs/GAME.md` "CPU vs RAM" and `src/sim/game/tradeoff.test.ts`). `ram0` latency is now 200. Numbers are placeholders.
- All balance numbers are placeholders in `src/sim/game/economy.ts`.
- Machine RAM is fixed at 64K; the RAM tier only changes the cache miss penalty (and, via `minRamBytes`, optionally the job mix). Board upgrades are the Basic ($150), Mainstream ($300, unlocks the 250 W PSU and M.2) and Enthusiast ($700) tiers.
- Engines: unpipelined, in-order, `inorder2` and `ooo` exist in `src/sim/engines` but only the first two are wired into board specs and saves (integration is a TODO). The fast model, offline catch-up, GPU, multicore, security workloads and multi-machine are still to do (see `docs/ARCHITECTURE.md`). Decode no longer allocates per fetched instruction.
- Visual gaps: text softens above 2x zoom, GPU/M.2/SATA are decor only, only single-width pipelines are drawn, touch hit-testing was not exercised (mouse and wheel only), no real-GPU frame times (software GL: about 17 fps with the die view at 16x). The UI drawer no longer hides the PSU (the camera frames the free area, see `docs/RENDER.md`).
- Early game: scan jobs ramp in over the first 300 ticks (`rampTicks`), so the first $100 takes about 105 to 323 s over 30 seeds (tested). Hint toasts are capped at 2 visible with a queue (see `docs/UI.md`).
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
