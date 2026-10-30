# The GPU: engines, memory path and card view

Code today: `src/sim/machine/gpu.ts` (`GpuPort`), `src/sim/ref/gpuref.ts` (`GpuRef`), `src/sim/isa/gpu.ts` (ISA), `src/sim/asm/gpu.ts`, `src/sim/gen/gpupicture.ts` (kernels), `src/render/board/gpu*.ts` (card view). Status: **built** (T128 to T145; the balance pass T56 stays with the owner). The engine contract, the `simd`, `warp` and `multi` engines and the memory system (`src/sim/gpu`), the card specs on them, the floorplans and block symbols (`src/render/gpu`: `gpuplans`, `gpuart`, `gpuglyph`), the card player (`gpuplayer`), hover ids from the plan, card stepping with the Trace panel's card section, and the picker stats. Cards are 600 high on a 700 PCIe pitch; blur3 over 64 elements: 1198 cycles on the unit, 991 on the two-warp SM. Background: [`ACCEL.md`](ACCEL.md) (device rules, ISA as built, picture jobs, the NPU and TPM), [`CPU.md`](CPU.md) and [`ENGINES.md`](ENGINES.md) (the model this note copies), [`DIE.md`](DIE.md) (the floorplan model the card view copies).

## Why

The CPU has five microarchitectures, each its own engine, floorplan, goldens and stepping UI. The GPU is one interpreter drawn three times: `gpu1..3` differ only in lanes, banks, memory and clock. The owner asked for the same standard: every tier a distinct, documented engine, with its own die plan, live replay, stepping and tests. Owner decisions (2026-10-30): full engine ladder, full floorplan with stepping and Trace panel, docs first.

## Invariants (every engine, every task)

- **Same results everywhere.** A kernel gives bit-identical memory on every tier and on `GpuRef`. Jobs' expected text and checksums are seed-only (`gpujob.test.ts`). Timing is the only thing a tier changes. Every engine is tested against `GpuRef` the way `engines.test.ts` tests timed CPU engines against `RefCpu`.
- **Nothing outside the card changes:** the ISA, the register map, `GPU_HOP_TICKS` (8), `KERNEL_LAYOUT` and `GPU_FRAME` (0x800), the spec ids `gpu1..3` and their `visual` keys. No save bump: card state is not saved (card memory is volatile; only spec id and clock are).
- **gpu1 keeps its numbers.** Blur3 golden in `machine/gpu.test.ts`: 462 instructions, 602 cycles, 140 conflict cycles, 618 ticks (ACCEL.md quoted 93/205/221, an old figure).
- **Tier order holds:** `gpu.test.ts` "GPU tiers" (gpu3 < gpu2 < gpu1 on cycles and on base ticks), card faster than the CPU twin (`gpujob.test.ts`), npu8 < npu4 < gpu < cpu (`npujob.test.ts`).
- Deterministic: same save and seed, same cycles. No wall clock, no `Math.random`.

## 1. How the card is driven

```
Game.advanceBaseTick()
  -> Machine.advanceBaseTick()                 1000 sub-ticks
       -> domain "pcie<k>" fires N times       N = the card's clock (spec, scaled by throttling)
            -> GpuPort.tick()                  phases: idle -> in (8 ticks) -> run -> out (8 ticks) -> idle
                 -> GpuEngine.step()           ONE CARD CYCLE (run phase only)
```

A launch is a CMD write; the card starts `GPU_HOP_TICKS` after it, runs, and shows Done `GPU_HOP_TICKS` after the halt: 16 ticks of overhead plus the kernel's cycles. The engine contract below makes one `step()` exactly one cycle. (Today `GpuPort` calls `GpuRef.step()` once per instruction and stalls the port for `cost - 1` ticks; that trick goes away when the engines count cycles themselves, with the same totals for `simd`.)

## 2. What the card sees

Registers and the card-memory window are in ACCEL.md "Device as built". Card memory is one flat word array (the engines call it global memory); kernel code, the two parameter words (0x700) and the 64 x 40 picture (0x800) live in it, and the CPU fills it with plain stores. The ISA has no shared-memory space, so the tiers differ in the **path** between a lane and that array, not in the address map.

## 3. The engine contract

```ts
interface GpuEngine {
  reset(pc: number, lanes: number): void   // lanes = the launch's lane count (0 = all)
  step(): void                              // ONE card cycle
  readonly halted: boolean
  readonly cycles, instructions, conflictCycles, idleLaneSlots: number
  mem: Uint32Array                          // card memory (shared with the port window)
  view(): GpuView                           // snapshot data, see 6
}
type GpuConfig =
  | { kind: 'simd';  lanes; memBytes; banks }
  | { kind: 'warp';  lanes; warps; memBytes; banks; lineWords; globalLatency }
  | { kind: 'multi'; lanes; warps; sms; memBytes; banks; lineWords; globalLatency; l1Lines; l2Lines }
createGpu(cfg: GpuConfig): GpuEngine        // like engines/index.ts createEngine
```

`GpuRef` stays the functional oracle and exports the per-instruction semantics the engines share (an instruction on a lane set under a mask gives the same registers, memory, mask and stack). Engines add timing and scheduling around it and are free to be cycle-by-cycle. `GpuPort.configure` compares the whole config (today it compares lanes, memory and banks only, so a new field would silently keep the old core).

## 4. The tiers

| id | Engine | SMs x warps x lanes | Pipeline | Memory path |
|---|---|---|---|---|
| `gpu1` | `simd` | 1 x 1 x 8 | none: one instruction at a time (today) | 1 bank, no latency, no coalescing |
| `gpu2` | `warp` | 1 x 2 x 8 (16 lanes) | fetch, decode, issue (scoreboard), execute, memory/writeback | 2 banks, global latency 6 cycles, coalescing into lines |
| `gpu3` | `multi` | 2 x 2 x 8 (32 lanes) | as `gpu2`, per SM | 4 banks per SM, a tag-only L1 per SM, one shared L2, coalescing |

Numbers are first guesses for the balance pass (T56). Prices, levels, watts and clocks stay as in ACCEL.md until the owner says otherwise.

### `simd` (gpu1)

One SIMD unit, N lanes in lockstep, unpipelined: each instruction takes 1 cycle, a `vld`/`vst` takes the most distinct addresses any one bank (`word % banks`) must serve (lanes on one address share one access, masked-off lanes take no part). Divergence runs both sides under the mask and the idle lanes count in `idleLaneSlots`. This is `GpuRef` and its timing rule exactly.

### `warp` (gpu2)

The lanes are split into warps of `lanes / warps` lanes. **Each warp has its own pc, execution mask, mask stack and register file slice;** a branch diverges only inside its warp. One shared fetch/decode path and one scheduler:

- **Issue:** each cycle the scheduler picks the next ready warp round-robin and issues one instruction. A warp is not ready while an operand is pending in the **scoreboard** (a register written by an in-flight `vld`), while it waits at a barrier, or when it is done.
- **Pipeline:** fetch, decode, issue, execute, memory/writeback. ALU results are ready the next cycle (full forwarding, so no ALU stall). A `vld` returns `globalLatency` cycles after its memory rounds finish; only the issuing warp waits, the other warp keeps issuing. This is the latency hiding that tier 1 does not have.
- **Memory rounds:** the active lanes' addresses are grouped into lines of `lineWords` words (the **coalescer**: lanes in one line cost one access). The distinct lines are then spread over the banks (`line % banks`); the **arbiter** serves one line per bank per cycle, so a conflict is more rounds. A `vst` is write-through with no result latency.
- **`bar`** is real: a warp that reaches it waits until every warp of the SM has reached it, then all go on. With one warp it costs 1 cycle, as before.
- **Counters:** `idleLaneSlots` counts masked-off lanes of the issuing warp, `conflictCycles` the extra rounds, plus new `stallCycles` (cycles with no warp ready) and per-warp issue counts.

### `multi` (gpu3)

`gpu2`'s SM, twice. The launch's lanes are dealt out to the SMs (warp-aligned, SM 0 first), each SM has its own scheduler, banks and tag-only L1 (direct-mapped, write-through, no allocate on a store, as the CPU's `DataCache`; built on the same class). A miss goes to the shared **L2** (tags only, hit and miss latencies, one request per cycle for the whole card, so two SMs missing together serialise) and then to card memory. `bar` synchronises the warps of one SM, not the card (as on real hardware). A kernel that needs another SM's result inside one launch is wrong on this tier; the kernel audit (T133) makes sure none does.

## 5. Timing rules (written once, tested once)

| Event | Cost |
|---|---|
| ALU, mask, branch, `lane`, `vli` | 1 issue slot; result next cycle |
| `vld`, `simd` | 1 + `bankCycles` (as today) |
| `vld`, `warp` | 1 issue slot, then `rounds` (arbiter) + `globalLatency` until the register is ready |
| `vld`, `multi` | as `warp`, but an L1 hit replaces `globalLatency` by `l1Hit`; an L1 miss pays the L2 (`l2Hit` or `globalLatency`) and queues on the L2 port |
| `vst` | 1 issue slot + `rounds`; write-through to L1 and L2 |
| `bar` | warp waits until the SM's warps arrive |
| `halt` | warp done; the launch ends when every warp is done and the pipeline is empty |
| fill, drain | the first issue is in cycle 2 (fetch, decode), the card is done 2 cycles after the last issue (execute, write-back); `WARP_FILL`, `WARP_DRAIN` in `gpu/warp.ts` |
| taken `bany` / `jmp` | the warp cannot issue for 2 more cycles (`WARP_BRANCH_PENALTY`); a branch that falls through costs nothing |
| register hazard | an instruction that reads or writes a register a load has not returned waits (scoreboard); ALU results are forwarded, so ALU work never waits |
| memory unit | busy for the rounds of a `vld` / `vst`; a second memory instruction waits, ALU work does not |

Open numbers for the balance pass: `globalLatency` 6, `l1Hit` 2, `l2Hit` 4, `lineWords` 8, `l1Lines` 16, `l2Lines` 64.

## 6. The view contract

`GpuView` only grows (the board art, the screen and the tooltips read it):

- `GpuStep` (one issued instruction) gains the raw `word`, `maskAfter`, `stackDepth`, `startCycle`, `sm`, `warp` and a `stall` reason; `kind` and `banks` mean what they meant.
- `GpuView.sms?: { warps: { pc, mask, stack[], state: 'ready' | 'wait-mem' | 'barrier' | 'done' }[], l1?: tags }[]` and `l2?: tags` for the tiers that have them; a pipeline ring of stage codes like `engines/view.ts` for the stage lamps.
- The trace ring grows from 24 to 64 entries; a paused card keeps the window that one stepping request produced.

## 7. The card view

The card gets a die plan in the style of [`DIE.md`](DIE.md): a data model (`gpuplan.ts`: blocks, routed links, per-tier variants), the same slicing layout and channel router (generalised, T137), block symbols instead of cell fields (lane ALU column, warp scheduler with scoreboard and warp cards, coalescer, bank arbiter, mask and stack strips, cache lines with tags), pulses that travel exactly along the routed wires, an instruction shown inside the block that holds it, a history with a scrubber, and the Trace panel with a card selector. Blocks per tier: PCIe link and launch registers (west), pc, fetch, decode, scheduler, register file, lanes, mask and stack, coalescer, arbiter, banks, L1 and L2 where present, card memory, the frame region. The fans stay art along the top edge. Hover ids are generated from the plan, `pcie<k>.<part>` with an index suffix for lane, warp, bank and SM; the closed regexes in `ui/panels/gpudesc.ts` and `render/interact.ts` are updated in the same commit (T142). The card is 6 to 9 times wider than tall and the body under the fans is about 160 px high, so the card must grow. **Decided (T136, owner):** the floorplans in `src/render/gpu/gpuplans.ts` (the mock-up layouts) are approved; the cards became much taller (built: 600 high, the die 440) and the PCIe pitch grows with them, and the card art copies the CPU die's (`dieart.ts`, `blockart.ts`), not a new style.

## 8. Tests (copy the CPU's)

- Equivalence: every kernel in `gpupicture.ts` and `gpukernels.ts`, at several lane counts, `GpuRef` vs each engine (memory and registers equal).
- Timing: exact cycle counts per rule in 5 (load-use stall, two warps hide latency on a memory-bound kernel, divergence idles only its warp, barrier waits, coalesced vs scattered, bank conflict rounds, L1 hit/miss, L2 serialisation).
- Golden charts per engine (blur3, inline snapshots), the style of `engines/golden.test.ts`.
- Tier order: the three existing orderings in the invariants, plus `warp` < `simd` and `multi` < `warp` on the same clock.
- Plan tests for the card view: the `cpuplan.test.ts` `check()` over `specsOfKind('gpu')`; the tooltip test enumerates ids from the plan.

## 9. Fast model

When the fast model (T54, T87) is built, the calibration key must include the GPU config and clock of every installed card (ARCHITECTURE.md "Calibration cache"). Nothing for the GPU is cached today.

## 10. Task list

T128 this note (owner approves) | T129 engine interface | T130 richer step record and view | T131 GPU memory system | T132 warp engine (gpu2) | T133 kernel audit for barriers | T134 multi-SM engine (gpu3) | T135 specs and balance guards | T136 floorplan mock-ups (owner) | T137 generalise the layout machinery | T138 `gpuplan` | T139 card geometry and static art | T140 block symbols | T141 card player | T142 hover ids | T143 stepping and Trace panel | T144 shop and picker | T145 docs sweep. The balance pass stays T56.
