# Machine and clocks

Code: `src/core/sim` (import from `src/core/sim`). No DOM imports.

## Clock scheduler (`clock.ts`)

- 1 base tick = 1 s of game time at 1x = `SUBTICKS_PER_BASE` (1000) integer sub-ticks.
- A domain has `Rate {mul, div}` = `mul/div` domain ticks per base tick. Phase is an integer accumulator (+`mul` per sub-tick, fire at `div * subticksPerBase`), so there is no float drift. Domains fire in registration order within a sub-tick.
- API: `addDomain(name, rate, onTick)`, `setRate(name, rate)` (a partial phase is rescaled and floored, deterministic), `getRate`, `ticks(name)`, `advance(subTicks)`, `advanceBaseTick()`, `subTicks`, `baseTicks`.
- Cross-domain transfer: `schedule(destDomain, delayTicks, fn)` runs `fn` on the Nth upcoming destination tick (min 1) just before that tick's `onTick`. Latency is in destination ticks.

## Machine (`machine.ts`)

`new Machine({ramSize, seed, cpuRate, displayRate, displayLatency})` owns `ram` (Uint8Array), `regs` (Int32Array(16)), `bus`, `clock`, `prng`, `display`, `status`, `intc` (the interrupt controller, always on the bus at `INTC_BASE`).

- `Bus` (`bus.ts`): RAM is the default range at 0; devices attach with `bus.attach(device)` (overlap checked). `load8/load32/store8/store32`; unmapped or misaligned access throws `RangeError`.
- `Device` (`device.ts`): `name, base, size, read(off), write(off, val), tick(), clock?`. Byte-granular; the bus composes words little-endian. `machine.addDevice(d)` attaches it and, if it has `clock`, creates a domain named after the device that calls `tick()`. `RamDevice` is plain storage (used for the status window).
- `Display` (`display.ts`): 64x16 text framebuffer at `DISPLAY_BASE`; `text()` returns rows. `writeLatency` N means each write lands after N display ticks, in order (`pending` counts queued writes). The CPU does not stall.
- `Prng` (`prng.ts`, mulberry32): `next()`, `nextU32()`, `nextInt(n)`, `getState()/setState()` (state is one uint32, save it as a number).
- `machine.attach(engine, program)` sets the engine and resets it. The `cpu` domain calls `machine.stepCpu()` once per CPU tick: it takes a deliverable interrupt if the engine is drained (otherwise stops fetching so it drains), then calls `engine.step()`; a halted engine does nothing. `attach` also resets the interrupt controller (a power-on). See [`CPU.md`](CPU.md). `machine.advanceBaseTick()` is the usual driver.

## Cores (`core.ts`, [`MULTICORE.md`](MULTICORE.md) section 1)

`new Machine({cores: n, mem})` has `n` cores (default 1). A `Core` owns what is per CPU: `regs`, `intc`, `mpu`, `timer`, `mmu`, its `engine`, and where its program starts (`entry`, 0 for core 0) and its stack (`stackTop`, the top of RAM unless given), plus the interrupt wait and guard stall counters. `machine.regs`, `intc`, `mpu`, `timer`, `mmu`, `engine` are core 0's, so single-core code is unchanged. RAM, the clock, the display, storage and every other device are shared.

- With more than one core the four per-core devices are wrapped in a `BankedDevice` at the same address: an access goes to the bank of `bus.core`, the core the machine is serving (`bus.serve(k, core.mpu)`, which also picks that core's protection unit). With one core the devices are attached directly.
- `stepCpu` steps every core in index order (a halted or missing engine does nothing), so a save and seed give the same cycles. `attach(engine, program)` powers every core on and installs the engine on core 0; `attachCore(k, engine, program, {entry, stackTop})` installs one on core k. Programs are position independent except for data addresses. Device interrupt lines go to core 0's controller (routing comes with the interrupt controller banks, `MULTICORE.md` M5).
- `mem` is the `MemSystem` ([`ENGINES.md`](ENGINES.md)) the cores share; with more than one core it is handed to every engine (`useMemSystem`) and reset by `attach`.

## Engine interface (`engine.ts`)

`reset(machine, program, core?)` (the core defaults to core 0), optional `useMemSystem(mem)`, `step()` (one CPU cycle), read-only `halted`, `pc`, `cycle`, and the optional interrupt hooks `drained`, `holdFetch(on)`, `redirect(pc)` (all four timed engines and `RefEngine` have them). Engines own their pipeline state; RAM, registers and devices belong to the Machine and are accessed through `machine.bus`; registers, interrupt controller and MMU through the engine's `core`.

`RefEngine` (`refEngine.ts`) is a placeholder: the reference interpreter at one instruction per CPU tick through the bus. The timed engines are in `src/features/cpu/sim/engines` (see [`ENGINES.md`](ENGINES.md)); build one with `createEngine(config)`.

`machine.addDevice` also takes the PCH (`src/features/board/sim/pch`, see [`ASSEMBLY.md`](ASSEMBLY.md)): boot ROM, USB host controller and display control on the bus at 0x4002_0000. `Display.connected` (false: writes are dropped) and `Display.setText` were added for the monitor cable and the PCH's POST error text.

`StoragePort` / `Disk` (`storage.ts`): memory-mapped block device with its own clock domain, see [`OS.md`](OS.md). The Game attaches one port per storage slot (`sata0`, `sata1`, `m20`, then `sata2` .. `sata5`, `m21`, `m22`, `sata6`, `sata7`: the first three keep their addresses) at `STORAGE_BASE`.
