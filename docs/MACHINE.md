# Machine and clocks

Code: `src/sim/machine` (import from `src/sim/machine`). No DOM imports.

## Clock scheduler (`clock.ts`)

- 1 base tick = 1 s of game time at 1x = `SUBTICKS_PER_BASE` (1000) integer sub-ticks.
- A domain has `Rate {mul, div}` = `mul/div` domain ticks per base tick. Phase is an integer accumulator (+`mul` per sub-tick, fire at `div * subticksPerBase`), so there is no float drift. Domains fire in registration order within a sub-tick.
- API: `addDomain(name, rate, onTick)`, `setRate(name, rate)` (a partial phase is rescaled and floored, deterministic), `getRate`, `ticks(name)`, `advance(subTicks)`, `advanceBaseTick()`, `subTicks`, `baseTicks`.
- Cross-domain transfer: `schedule(destDomain, delayTicks, fn)` runs `fn` on the Nth upcoming destination tick (min 1) just before that tick's `onTick`. Latency is in destination ticks.

## Machine (`machine.ts`)

`new Machine({ramSize, seed, cpuRate, displayRate, displayLatency})` owns `ram` (Uint8Array), `regs` (Int32Array(16)), `bus`, `clock`, `prng`, `display`, `status`.

- `Bus` (`bus.ts`): RAM is the default range at 0; devices attach with `bus.attach(device)` (overlap checked). `load8/load32/store8/store32`; unmapped or misaligned access throws `RangeError`.
- `Device` (`device.ts`): `name, base, size, read(off), write(off, val), tick(), clock?`. Byte-granular; the bus composes words little-endian. `machine.addDevice(d)` attaches it and, if it has `clock`, creates a domain named after the device that calls `tick()`. `RamDevice` is plain storage (used for the status window).
- `Display` (`display.ts`): 64x16 text framebuffer at `DISPLAY_BASE`; `text()` returns rows. `writeLatency` N means each write lands after N display ticks, in order (`pending` counts queued writes). The CPU does not stall.
- `Prng` (`prng.ts`, mulberry32): `next()`, `nextU32()`, `nextInt(n)`, `getState()/setState()` (state is one uint32, save it as a number).
- `machine.attach(engine, program)` sets the engine and resets it. The `cpu` domain calls `engine.step()` once per CPU tick while not halted. `machine.advanceBaseTick()` is the usual driver.

## Engine interface (`engine.ts`)

`reset(machine, program)`, `step()` (one CPU cycle), read-only `halted`, `pc`, `cycle`. Engines own their pipeline state; RAM, registers and devices belong to the Machine and are accessed through `machine.bus` / `machine.regs`.

`RefEngine` (`refEngine.ts`) is a placeholder: the reference interpreter at one instruction per CPU tick through the bus. The timed engines are in `src/sim/engines` (see [`ENGINES.md`](ENGINES.md)); build one with `createEngine(config)`.

`machine.addDevice` also takes the PCH (`src/sim/pch`, see [`ASSEMBLY.md`](ASSEMBLY.md)): boot ROM, USB host controller and display control on the bus at 0x4002_0000. `Display.connected` (false: writes are dropped) and `Display.setText` were added for the monitor cable and the PCH's POST error text.

`StoragePort` / `Disk` (`storage.ts`): memory-mapped block device with its own clock domain, see [`OS.md`](OS.md). The Game attaches one port per storage slot (`sata0`, `sata1`, `m20`, then `sata2` .. `sata5`, `m21`, `m22`: the first three keep their addresses) at `STORAGE_BASE`.
