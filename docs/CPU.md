# The CPU: how it runs, and how it takes interrupts

Code: `src/sim/machine` (`Machine`, `Engine`, `Intc`), `src/sim/engines` (the four timed engines), `src/sim/ref` (the reference interpreter), `src/sim/isa` (opcodes, memory map), `src/sim/board/apply.ts` (board to machine wiring). Status: **the CPU side of interrupts is built** (stage 1 of [`NETSTACK.md`](NETSTACK.md)); no device or kernel uses it yet. Details of each engine's pipeline: [`ENGINES.md`](ENGINES.md). The instruction set: [`ISA.md`](ISA.md).

## 1. How the CPU is driven

```
Game.advanceBaseTick()                      one base tick = 1 s of game time at 1x (4 per second of real time)
  -> Machine.advanceBaseTick()              1000 sub-ticks (ClockScheduler)
       -> domain "cpu" fires N times        N = the CPU's clock (ticks per base tick) from its spec, scaled by throttling
            -> Machine.stepCpu()            interrupt check, then Engine.step(): ONE CPU CYCLE
```

- **The CPU only runs while the machine is powered and has no POST error.** Everything the game does around it (arrivals, thermal, the network feed, power) runs once per base tick, outside the CPU's cycles.
- **One `Machine` lives for the whole game.** A power-on (`Game.coldBoot`) blanks RAM, resets the devices and calls `applyEngine`, which builds the installed CPU's engine from its spec (`engineConfigFor`: the RAM's latency becomes the data cache miss penalty) and `machine.attach`es it with the boot ROM. A CPU upgrade therefore takes effect at the next boot, with cold caches and an empty pipeline. `attach` also resets the interrupt controller.
- **Clocks.** Each device with a `clock` gets its own domain (`display`, each storage port, the PCH...). Domains fire in registration order inside a sub-tick: the display and the interrupt controller are registered before the CPU, the PCH and storage ports (added by the game afterwards) after it. The CPU's rate is a `Rate {mul, div}`, set from `clockToRate(clock)`; `applyRates` updates it when the thermal model throttles the chip (rate 0 = stopped).
- **Cores.** A machine can have several cores ([`MACHINE.md`](MACHINE.md) "Cores", [`MULTICORE.md`](MULTICORE.md)): `stepCpu` runs the interrupt check and the engine step of each core in index order, each against its own `Core` (registers, interrupt controller, timer, MPU, MMU). One core is exactly the description above.
- **Deterministic.** Same save and seed, same cycles. The machine PRNG (instability, crashes) is seeded; nothing in the CPU path uses wall-clock time.

## 2. What the CPU sees

| Thing | How |
|---|---|
| Registers | 16 x 32-bit, owned by the `Machine` (`machine.regs`); `x0` reads 0; `sp` starts at the top of RAM |
| Instruction fetch | a real read through the bus (`bus.load32(pc)`). There is no instruction cache: a fetch takes one cycle. A pc outside RAM or unaligned fetches an illegal word (op 0), a fault only if it reaches execution |
| RAM | `machine.ram` at address 0 |
| Data cache | per engine, direct-mapped, tags only; RAM is write-through, no-allocate, so memory is always up to date. A load miss freezes MEM for `missPenalty` cycles. **Only RAM addresses are cached** |
| Devices | memory-mapped; any address at or above the RAM size goes to the device that owns it. Access is uncached, byte-granular (the bus builds a word from four byte accesses, low byte first), and misaligned or unmapped access throws `RangeError` (a crash in the game) |
| Stores to devices | happen at the same architectural point as stores to RAM (MEM in the in-order engines, commit in the out-of-order one) and are never speculative |

Memory map (`src/sim/isa/memmap.ts`):

| Range | What |
|---|---|
| `0x0000_0000` + RAM size | RAM. The boot ROM is shadowed at 0; `ROM_DONE_VECTOR` 0x10; jobs load at `USER_BASE` 0x1000; the OS header, kernel and job table sit at 0xc000, 0xc100, 0xe000 |
| `0x4000_0000` | text display |
| `0x4001_0000` | status registers |
| `0x4002_0000` | PCH: boot ROM glue, USB host, key and result windows |
| `0x4003_0000` + k x 0x1000 | storage ports (block devices) |
| `0x4004_0000`, 0x100 | **interrupt controller** (section 4) |

## 3. The engine contract

```ts
interface Engine {
  reset(machine, program): void;   // load the program at 0, cold caches and pipeline, pc 0
  step(): void;                    // one CPU cycle
  readonly halted, pc, cycle;      // pc = the next instruction to fetch
  // interrupt support (optional; all four engines and the reference have it)
  readonly drained?: boolean;      // nothing in flight
  holdFetch?(on): void;            // stop fetching new instructions
  redirect?(pc): void;             // fetch from pc next (only while drained)
}
```

The four timed engines differ in when an instruction becomes architectural, which is what interrupts care about:

| Engine (cpu spec) | Instructions in flight | Registers written | Stores / device writes | Branch resolved | Retired |
|---|---|---|---|---|---|
| `unpipelined` (cpu0) | exactly one, 5 cycles | WB | MEM | EX, no penalty | on entering WB |
| `inorder` (cpu1, cpu2) | up to 5, one per stage | WB | MEM | EX, wrong guess flushes IF and ID (+2 bubbles) | WB |
| `inorder2` (cpu3) | up to 10 in two lanes, issued as bundles | WB | MEM | EX | WB |
| `ooo` (cpu4) | fetch queue + decode + ROB (8 entries here) | at commit | **at commit**, in order | when the branch finishes; younger work is squashed | commit, up to `commitWidth` per cycle |

Everything an engine does after fetch is invisible to the machine until it is architectural, except two things that cannot be undone: **a store in MEM (in-order) and a load or store to a device**. That is why an interrupt is taken between instructions (section 4) and not by squashing the pipeline: a younger store in MEM has already happened.

The engines are checked against the reference interpreter (`src/sim/ref`) on registers and memory, so every behaviour below is defined by the reference first and by the timing second.

## 4. Interrupts

### The model

A device asks for service by **raising a line** on the machine's interrupt controller. When interrupts are on and the line is enabled, the CPU stops what it is doing between two instructions, remembers where it was, and jumps to a handler. The handler does its work (acknowledge the device, move some data, set a flag), restores the registers it used, and executes `iret`, which resumes the interrupted program as if nothing had happened.

The interrupted program does not know. A handler's cost is real: its instructions run on the same pipeline, so a running job loses exactly the cycles the handler used, plus the cycles to empty the pipeline first.

### The controller (`Machine.intc`, `src/sim/machine/intc.ts`)

Always present at `INTC_BASE` 0x4004_0000. Word registers (`INTC_REG`):

| Offset | Name | Access | Meaning |
|---|---|---|---|
| 0x00 | `PENDING` | ro | lines raised and not yet acknowledged (bit n = line n) |
| 0x04 | `MASK` | rw | lines allowed to interrupt. Reset 0 |
| 0x08 | `ACK` | wo | write 1-bits to clear those lines in `PENDING` |
| 0x0c | `VECTOR` | rw | where the CPU jumps |
| 0x10 | `EPC` | rw | where `iret` returns to |
| 0x14 | `CAUSE` | ro | the line taken last |
| 0x18 | `CTRL` | rw | bit0 = interrupts on. Cleared on entry, set by `iret`. Reset 0 |
| 0x1c | `COUNT` | ro | interrupts taken |
| 0x20 | `ROW_BASE` | rw | display row base of this core: its display accesses land that many rows lower (reset 0) |
| 0x24 | `CORE_ID` | ro | the number of the core reading it |
| 0x28 | `CORES` | ro | how many cores the machine has |
| 0x2c | `IPI` | wo | a mask of cores; each gets line `IPI` (a core may signal itself; bits past the last core are ignored) |
| 0x30 | `PARK` | rw | write nonzero: this core stops fetching, what is in its pipeline finishes, then it sleeps until a line that is not masked is pending. Reads 1 while parked |
| 0x40 + 4n | `ROUTE[n]` | rw | the core that takes device line n, n < 16 (reset 0; a core number that does not exist means 0) |

**Cores.** With several cores each has its own bank of all of these at the same address (the bus answers for the core it is serving, `bus.core`), except `ROUTE`, which is one table all banks show. A single-core machine has one bank: `CORE_ID` 0, `CORES` 1. `Machine.raise(line)` is what a device calls to reach the routed core; the timer and `IPI` are per core and always go to their own. A parked core does not step, draws idle power and counts `parkedCycles`; it wakes the cycle a masked-in line is pending (the interrupt itself is taken only if `CTRL` has interrupts on, so a core with them off just resumes after the park). A wake that was already pending when the core parked is not lost. Follow a `PARK` write with a jump back to it (an idle loop): the instructions already behind it in the pipeline complete before the sleep, as with any fetch stop. `ROW_BASE` lets several cores print their jobs' lines at once without overwriting each other; the OS sets it when it switches a context in (`src/sim/machine/display.ts`: an access pushed off the screen is dropped). See [`MULTICORE.md`](MULTICORE.md) sections 4 and 6.

Lines (`IRQ`): `TIMER` 0, `NIC` 1, `DISK` 2, `USB` 3, `IPI` 4. **The lowest pending, enabled line wins.** Lines are *latched*: a raise stays pending until the handler writes `ACK`. A handler that forgets to acknowledge is entered again the moment `iret` turns interrupts on, which is the real behaviour and a good way to see a bug.

Host side (`Intc`): `raise(line)`, `next()` (the line to take now, or -1), `enter(line, epc, latency)`, `leave()`, `reset()`, and the counters `taken`, `lastLatency`, `maxLatency` (CPU cycles an interrupt waited for the pipeline to empty; for the UI and tuning).

Nothing about the controller is saved. A loaded game starts powered off, and `machine.attach` (every power-on) resets it.

### `iret`

Opcode `0x71`, no operands. `pc = EPC`; interrupts come back on **when `iret` retires**. It reads `EPC` as it executes, so a handler may rewrite `EPC` first (to resume elsewhere: this is how a scheduler will switch programs). In the engines it is a jump through the interrupt controller, flagged like `jalr` (predicted not taken, so it flushes the front end), with two ordering rules so a store to `EPC` right before it is seen: the in-order engines never put it in a bundle behind another instruction, and the out-of-order engine issues it only when it is the oldest instruction in the ROB.

### Taking an interrupt (`Machine.stepCpu`)

Each CPU cycle, before `Engine.step()`:

1. Ask the controller for a deliverable line (`next()`). None: make sure fetching is on, step.
2. A line is deliverable and the engine is `drained`: **enter**. Record `EPC = engine.pc` (the next instruction of the program, in program order), `CAUSE`, switch interrupts off, `redirect(VECTOR)`, then step: the first fetch of that cycle is the handler's first instruction.
3. A line is deliverable but the engine is not drained: **`holdFetch(true)`** and step. Nothing new is fetched; what is in flight finishes (a mispredicted branch still resolves and squashes its wrong path, a cache miss still freezes its stage). Counted in `lastLatency`.
4. An engine that halted (`ecall`) takes no interrupts. An engine without `drained` (a custom one) never does.

"Drained" means: unpipelined, between instructions (idle, or the last one is entering WB and has retired); in-order, every stage latch empty or a bubble (this includes WB, whose write has not landed yet); out-of-order, fetch queue, decode and ROB empty. At that point `engine.pc` is exactly the next instruction in program order, because any wrong-path work has been squashed and the pc was corrected by the branch that squashed it.

**Cost.** The latency is the depth of the pipeline (about 5 cycles for the in-order engines, more behind a cache miss or a long-latency op, the ROB length for the out-of-order one), plus the refill after the redirect. A deeper, wider core is slower to interrupt; this is real and shows in `maxLatency`. Entry itself costs nothing extra.

### Writing a handler (the convention)

On entry **every register belongs to the interrupted program**, and there is no hardware save. A handler:

1. Saves the registers it will use to a save area in RAM, using `sw rX, imm(zero)` with an address below 64 KiB (`zero + imm17` reaches 0..65535), so it needs no free register to do it. The OS chooses the area (the test handlers use `0xf00..`).
2. Does its work. It may use the stack the program is on (`sp` is the program's), but a dedicated area is cleaner.
3. **Acknowledges** the line (`sw` to `ACK`).
4. Restores the registers, then `iret`.

Not supported, on purpose: **nesting** (interrupts stay off in the handler; a handler that turns them on must save `EPC` itself) and **priorities beyond the line number**. There are no exceptions or traps yet: an illegal instruction, a misaligned access or an unmapped address still throws `RangeError`, which the game treats as a crash. There is no privilege level, no `wfi` (a waiting kernel spins), and no timer device (line 0 is reserved for it).

### Using it from a device

A device calls `machine.intc.raise(IRQ.X)` from its own `tick()`. Give the device a clock domain (as the storage ports do) so it raises mid-base-tick, at CPU-cycle granularity; a raise from game code (`Game.netTick`, once per base tick, after the machine ran) works but arrives at base-tick granularity. The kernel installs its handler by writing `VECTOR`, `MASK` and `CTRL` during boot. None of this is wired into the kernel or the boot ROM yet.

### Open decisions

- **Decided (owner): every CPU tier has an interrupt line.** `TECHTREE.md`'s "a CPU with an interrupt line" for the preemptive OS is then always met.
- **Where the first handler lives.** The boot ROM (so it works without an OS) or the kernel (`src/sim/os/kernel.ts`, which the NIC stage needs).
- **Timer interrupt.** Built: the interval timer device (`src/sim/machine/timer.ts`, `TIMER_BASE` 0x4012_0000: `INTERVAL` cycles between interrupts on line 0, `COUNT`, `KICK`) and the preemptive kernel `os3` (docs/OS.md "OS 3"). The MMU's `CONTROL` write inside a handler decides whether `iret` turns translation on.

### Tests

`src/sim/engines/interrupts.test.ts` runs a loop full of hazards on the reference engine and on every engine configuration (unpipelined, in-order with and without forwarding and shared port, 2- and 4-wide, eight out-of-order sizes) and raises a line at about 120 different cycles of each run. After every one, registers and memory must equal the uninterrupted run, the handler must have run exactly once, and the latency must be bounded. It also covers bursts of raises, a handler that rewrites `EPC`, interrupts staying off until enabled, a masked line staying pending, a missing acknowledge, line priority, and `CAUSE`/`EPC` contents. `src/sim/machine/intc.test.ts` covers the register file. The existing golden timing tests are unchanged: without an interrupt the engines behave exactly as before.
