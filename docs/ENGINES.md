# Timed CPU engines

Code: `src/sim/engines` (import from `src/sim/engines`). No DOM imports. Both engines implement `Engine` from `src/sim/machine/engine.ts` (unchanged) and also `PipelineEngine`: `view`, `invalidateCache()`, `flipPredictor(pc?)`.

```ts
import { createEngine } from "src/sim/engines";
machine.attach(createEngine({ kind: "inorder", forwarding: true, sharedPort: false }), program);
```

`EngineConfig` is plain data: `{kind: "ref"}` (RefEngine), `{kind: "unpipelined", ...EngineSettings}`, `{kind: "inorder", ...InOrderSettings}`. Superscalar and out-of-order come later.

## Common behaviour

- **Fetch is a real bus read** of the instruction word; `decode` from `src/sim/isa` decodes it. Fetches outside RAM or unaligned give an illegal instruction, which only throws `RangeError` if it reaches EX (wrong-path fetches are squashed first).
- **ecall** halts when it enters WB (`halted` is true, `cycle` is the cycle it shows W). Anything fetched behind it is squashed. `pc` after halting is the address after the ecall, like the reference.
- **Data cache**: direct-mapped, tags only (RAM is write-through, no-allocate, so data always comes from RAM). Only RAM addresses are cached; device (MMIO) accesses bypass it so status polling is always live. A load miss freezes MEM for `missPenalty` extra cycles (`StallCache` counts them). Stores never miss.
- **Instruction cache** is not modelled yet (fetch always takes one cycle).
- `reset(machine, program)` loads the program, clears registers (sp = top of RAM), pipeline, predictor and cache (cold). Flip the predictor or toggle options after `reset`.
- Cycle numbering: the first `step()` is cycle 1 and shows the first instruction in F. The timeline cell for cycle `c` shows where an instruction sits during `c`.

`EngineSettings` (both engines): `cacheLines` 8, `cacheLineBytes` 16, `missPenalty` 4, `timelineRows` 32 (>= 8), `timelineCols` 64.

## Unpipelined (`UnpipelinedEngine`)

One instruction at a time: 5 cycles each (F D X M W), plus `missPenalty` extra M cycles on a load miss. No prediction, no hazards, branches resolve in EX with no penalty. Work happens as the instruction enters a stage: IF reads the word, ID decodes, EX reads registers and computes, MEM accesses data, WB writes back.

## In-order 5-stage (`InOrderEngine`, width 1)

`InOrderSettings` adds `forwarding` (default true) and `sharedPort` (default false). They live in `engine.options` and may be toggled between steps.

- **Register file** is written in WB before that cycle's reads, so a consumer 3 instructions behind a producer never stalls. Operands are read in EX.
- **Forwarding on**: EX operands are bypassed from the MEM latch (non-loads). The only stall is load-use: 1 bubble (`StallLoad`). **Off**: the consumer waits in ID until the producer has written back: 2 / 1 / 0 bubbles at distance 1 / 2 / 3 (`StallData`).
- **Control flow** is resolved in EX. Fetch predicts: conditional branches use a 1-bit table (64 entries, indexed by `(pc >> 2) % 64`, starts not-taken, updated in EX), `jal` is always predicted taken with the right target (BTB-like predecode in fetch), `jalr` (so `ret`) is predicted not-taken and always flushes. A wrong prediction squashes IF and ID and injects 2 flush bubbles (`StallFlush += 2`).
- **Cache miss** freezes everything behind MEM (IF, ID, EX hold; WB drains). A mispredict found in EX during a freeze still flushes.
- **Shared port**: with `sharedPort`, a fetch in the same cycle as a load/store in MEM loses and an IF bubble with cause `Struct` appears.
- Test hooks: `invalidateCache()` empties the cache, `flipPredictor(pc?)` flips one entry (or all). Correctness must not depend on either.

## Observability: `engine.view` (read-only, live typed arrays)

Documented in `src/sim/engines/view.ts`. Nothing is allocated per step. The renderer should read, never write.

| Field | Type | Meaning |
|---|---|---|
| `stageKind[5]` | Uint8Array | per stage IF ID EX MEM WB: `SlotKind` Empty 0 / Instr 1 / Bubble 2 |
| `stageId[5]` | Int32Array | dynamic instruction id (-1 for none or bubble) |
| `stagePc[5]` | Uint32Array | pc of the occupant |
| `stageCause[5]` | Uint8Array | bubble cause: `Cause` None 0, Load 1, Data 2, Flush 3, Struct 4 |
| `stageStalled[5]` | Uint8Array | 1 if the occupant is held this cycle (ID hazard stall, cache freeze) |
| `counters` | Float64Array | indexed by `Counter` (below) |
| `timeline` | views | ring buffer of the last `rows` instructions |
| `nextId` | number | ids handed out; newest id is `nextId - 1` |

`Counter`: Cycles, Retired, StallLoad, StallData, StallFlush, StallStruct, StallCache, Flushes (mispredicted branch/jalr), FlushedInstrs (squashed wrong-path instructions), Branches, BranchMispredicts, CacheHits, CacheMisses. Names in `COUNTER_NAMES`. Stall counters count bubbles (or frozen cycles for the cache), by cause.

`timeline`: `rows x cols` ring. Row of instruction `id` is `id % rows`; `id[row]`, `pc[row]`, `word[row]` (raw word, disassemble with `src/sim/isa`), `fate[row]` (`Fate`: InFlight 0, Retired 1, Flushed 2). `codes[row * cols + cycle % cols]` is the stage code for that cycle: `StageCode` None 0, F 1, D 2, X 3, M 4, W 5, Flushed 6; letters in `STAGE_CODE_CHARS = " FDXMWx"`. A cell is valid while `id[row]` is the instruction you want and the cycle is within the last `cols` cycles. A stalled instruction repeats its letter each cycle; a squashed one gets `x` in the cycle it dies.

## Tests

`src/sim/engines/*.test.ts`: correctness against `src/sim/ref` (registers, RAM, display) for every configuration on hand-written and seeded random programs (`testgen.ts`, test-only) with random cache invalidations and predictor flips; timing sanity (bubble counts, flush, freeze length); golden stage charts as inline snapshots (update with `npx vitest run -u` after an intended timing change); determinism.
