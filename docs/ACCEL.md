# Accelerators: GPU, NPU, TPM (design note, T59)

Status: designed, not built. Owner decision 2026-10-24: start on T51. This note covers the GPU (own ISA, fed by the reserved `pcie` power cable), the NPU and the TPM (a header slot on Mainstream and up). It ends with a proposed task split for the owner to approve. Background: [`ARCHITECTURE.md`](ARCHITECTURE.md) "Accelerators" and "Security", unlock rows in [`PROGRESSION.md`](PROGRESSION.md), slots and VRM in [`BOARD.md`](BOARD.md) / [`VRM.md`](VRM.md).

All three follow the existing device rules: a declarative spec in `DEVICE_SPECS`, a typed slot, `idleW` / `loadW` / `heatFactor` / `thermal`, an MMIO range on the bus, programs that reach them through plain loads and stores and poll a status register (no interrupts, no DMA). Numbers below are first guesses for the balance pass.

## Shared shape

- **New device kinds:** `gpu`, `npu`, `tpm`. New slot type `tpm` (a header, one per board on Mainstream and Enthusiast, none on Starter and Basic). GPU and NPU use the existing `pcie` slot, one card per slot, competing with NIC cards (Basic 1, Mainstream 2, Enthusiast 4).
- **New cable:** `pcie` (the PCIe power lead from the PSU, already reserved in `cables.ts`). Same rules as `cpu`: needs a PSU that has the connector, `pruneCables` unplugs it when the source goes. A card whose spec says `needsPcieCable` and has it unplugged fails POST with `short: "GPU power cable"` (the card is detected but cannot start), not `noPower`.
- **PSU connector:** `psu0` / `psu1` have no PCIe lead, `psu2` (250 W ATX+) has one, `psu3` (500 W, planned) two, `psu4` (1 kW) four. A spec field `pcieLeads` on the PSU; `connectCable("pcie")` refuses with "this PSU has no PCIe power lead".
- **Clock domains:** each card gets its own domain named after its slot (`pcie0`, `pcie1`), like drives. TPM runs on a fixed slow domain `tpm` (no overclock).
- **Bus and MMIO:** each device takes a fixed window in the device range (command / status / data registers plus, for GPU and NPU, a small on-card memory window). The CPU writes a command descriptor, sets `go`, polls `status`. The crossing has explicit latency (PCIe hop: about 8 CPU-domain ticks each way; TPM header: about 20, it is slow on purpose). Bus traffic shows on the board as today.
- **Fast model:** how accelerators key the calibration cache waits for the fast-model design note (T54, T87).
- **Save:** devices go in `board.devices` as today; `Cables` gains `pcie`. One save version bump, migration fills `pcie: false`.
- **Sandbox:** every tier offered, as for every other kind.

## GPU

- **ISA:** its own small instruction set on the same assembler framework (second opcode table, same R/I/S/B formats, 32-bit words). Lane registers (8 vector registers of N lanes), a lane id register, an execution mask, vector ALU ops, `vld` / `vst` to on-card memory, a mask-set compare, `bar` (lockstep barrier, trivial in v1) and `halt`. Opcodes are the implementer's choice (ARCHITECTURE "Open questions").
- **Model:** one SIMD unit, N lanes in lockstep, unpipelined in `gpu1` and in-order 5-stage in `gpu2`/`gpu3` (reuse the CPU engine code where it fits). Divergence is real: both sides of a branch run under the mask, the idle lanes are drawn dark. On-card memory is small and banked; bank conflicts serialize, so memory-bound kernels look memory-bound.
- **Launch:** the CPU copies inputs into the card window with stores (no DMA, so the copy cost is visible), writes the descriptor (kernel address, lane count, args), sets `go`, polls. Kernel code lives in card memory and is loaded the same way.
- **Tiers** (prices are orders of magnitude only):

| id | lanes | card memory | clock base | W idle / load | PCIe cable | price | level |
|---|---|---|---|---|---|---|---|
| `gpu1` | 8 | 8K | 2 | 4 / 40 | yes | about $1,500 | 10 |
| `gpu2` | 16 | 16K, 2 banks | 3 | 8 / 90 | yes | about $5,000 | 14 |
| `gpu3` | 32 | 32K, 4 banks | 4 | 12 / 180 | yes, 2 leads | about $15,000 | 16 |

- **Thermal:** its own cooler, built into the card (`passive` high, no cooler slot), throttles like a CPU. Fans on the card are art, not a part.
- **Display:** `display1` (planned, level 10) is the graphics display the GPU drives; `gpu` jobs whose template renders write the frame there. Without `display1` the job still runs and pays, it just shows nothing.

## NPU

- **Not a second programmable ISA** (scope). The NPU is a fixed-function systolic matmul / activation unit driven by **command descriptors**: `load tile`, `matmul`, `add bias`, `relu`, `store tile`. The CPU builds a short descriptor list in card memory and launches it. This keeps the emulation cost small while still giving a visible structure (a K x K grid of MACs where data flows right and down).
- **Model:** cost per descriptor = tile setup + `K` ticks fill + one tick per row + drain. Bigger grids finish matmuls faster but cost the same setup, so small jobs gain less (a real trade-off against the GPU, which can also run `npu` jobs, see below).
- **Tiers:**

| id | grid | card memory | W idle / load | PCIe cable | price | level |
|---|---|---|---|---|---|---|
| `npu1` | 4 x 4 | 8K | 2 / 15 | no (slot power only) | about $2,500 | 12 |
| `npu2` | 8 x 8 | 32K | 5 / 45 | yes | about $10,000 | 16 |

- `npu1` needs no cable on purpose: an efficient card a player can add to a Mainstream PSU budget.

## TPM

- **Slot:** the `tpm` header (owner decision 12 in PROGRESSION.md: not a PCIe card, so PCIe stays free for NICs and GPUs). A small daughterboard on the header, no cable, no clock control.
- **MMIO commands:** `measure` (hash a range of RAM, cost per word read through the bus, so it is visibly slow), `attest` (fixed latency, returns a quote word), `seal` / `unseal` (key handle). Uses the machine PRNG only for the quote value, so runs stay deterministic.
- **Protected mode:** while a `secure` job runs, RAM traffic outside the job's own range is refused (a fault that kills the job) and every RAM access pays an encryption surcharge (`tpm1` +2 RAM ticks, `tpm2` +1). This is the "real, visible cycle cost" from ARCHITECTURE "Security".
- **Tiers:**

| id | measure cost | attest latency | encryption surcharge | W | price | level |
|---|---|---|---|---|---|---|
| `tpm1` | 4 ticks / word | 60 | +2 | 0.2 / 0.5 | about $400 | 9 |
| `tpm2` | 1 tick / word | 20 | +1 | 0.3 / 0.8 | about $1,500 | 13 |

- The header exists from Mainstream (level 5) but stays empty until level 9: the empty header is drawn on the board as a hint.

## Unlock levels (summary)

As already listed in PROGRESSION.md, unchanged: `tpm1` 9 (with the `secure` class), `gpu1` + `psu3` + `display1` 10 (with `gpu`), `npu1` 12 (with `npu`), `tpm2` 13, `gpu2` 14, `gpu3` + `npu2` 16. The only addition is `pcieLeads` on PSUs: `psu2` (level 5) gets one, so a level 10 GPU fits a Mainstream build if the watts allow; `psu3` is the comfortable choice.

## Job classes

All three classes already exist in `levels.ts` as never-running classes (T50); this makes them runnable. Each is a generator template ([`GEN.md`](GEN.md)) emitting real CPU code plus device code:

- **`gpu`** ("render frame" / "batch shader"): with a working GPU (and its cable) the CPU kernel copies a seeded input tile to card memory, uploads a GPU kernel, launches, polls, reads back a checksum and prints it on the CLI. Without one, the generator emits an equivalent CPU loop that prints the same checksum, only slower. GPU kernels: `vadd`, `saxpy`, `blur3` (divergent at the edges), `mandel` (heavy divergence). Same pay either way.
- **`npu`** ("inference"): with an NPU the CPU builds a 2 to 6 descriptor list (seeded layer sizes), launches, polls, prints the class index. The fallback chain is NPU, then GPU (a slower kernel), then CPU (a slower loop). All three print the same class index and pay the same; the speed gap down the chain is what the card sells, so the NPU is an upgrade, not a key.
- **`secure`** ("signed transaction"): `measure` the job's code range, `attest`, run a small hash / checksum kernel in protected mode, `seal` the result, print the quote. The only class that needs its hardware: accepted only with a TPM. Pays more per tick than `db` to make up for the surcharge.

Only `secure` is gated: its arrival is refused (not queued) without a TPM, with the reason on the hover ("needs a TPM"). `gpu` and `npu` jobs are never refused for lack of a card. The job mix weights per level are already in PROGRESSION.md.

## Board and VRM demand

- **The board VRM feeds the CPU only.** GPU and NPU cards have their own VRM on the card (part of the card spec, folded into its `heatFactor`), and draw from the PSU through the slot (up to 75 W) plus the `pcie` cable. So they add **PSU watts and case heat**, not board-VRM amps. This keeps VRM.md's model unchanged and keeps the board choice about the CPU.
- **Slot power cap:** a card with `loadW > 75` must have `needsPcieCable` (all GPUs; `npu2`). The PSU rule counts the card's `loadW` in the rated load as today.
- **Case heat:** card heat raises the ambient for other parts by a small amount (`ambientRiseC = 0.05 x card W`), so a 180 W `gpu3` warms the CPU by about 9 degrees without case fans (`fan1`, planned level 7, offsets it). This is the one new thermal coupling.
- **TPM:** under 1 W, ignored by the VRM, counted in the PSU sum.

## Picker and board art

Every size in UI code relative (rem, em, %), as UI.md requires. Needed art:

- **Shop / picker tiles** (illustrated, greyed with `Level N` until reached): `gpu1`, `gpu2`, `gpu3` (cards of growing length, 1 / 2 / 3 fans, the last with a power lead pair), `npu1`, `npu2` (low-profile card, a grid motif on the shroud), `tpm1`, `tpm2` (a small daughterboard with one chip), `psu3`, `display1`.
- **Board view:** a card occupying a `pcie` slot (long cards overhang the next slot visually but not logically), the `pcie` cable drawn from the PSU to the card's top edge with plug / unplug like the other cables, the `tpm` header as a small pin row near the PCH (empty and filled states).
- **Internal views** (zoom on a device, animated from sim state): GPU = a row of N lanes with the mask (lit / dark), the current instruction and the on-card memory banks with conflicts flashing; NPU = the K x K MAC grid with data pulsing right and down, the descriptor list with the current step; TPM = a chip with three stages (measure, attest, seal) and a lock badge on RAM while protected mode is on.
- **Hover ids:** each lane / bank / MAC cell / TPM stage gets a hover id under the existing RENDER.md scheme.

## Out of scope for this phase

DMA and interrupts, multi-GPU, GPU-to-NPU sharing, a programmable NPU ISA, TPM firmware updates, secure boot of the OS.

## Proposed task split (for the owner to approve)

Each line is meant as one TODO entry, in dependency order:

1. **Specs and slots:** kinds `gpu`/`npu`/`tpm`, slot type `tpm` on Mainstream and Enthusiast, `pcieLeads` on PSUs, `needsPcieCable` and the 75 W slot rule in `install`, spec entries for `tpm1`, `gpu1`, `npu1`, `psu3` (higher tiers as data only). Tests: slot counts, install refusals.
2. **`pcie` cable:** `CableId` gains `pcie`, connect / prune / POST reason, save version bump and migration. Tests in `cables.test.ts`, a save round-trip.
3. **Thermal and power:** card power in the PSU sum, card thermal, `ambientRiseC` case heat. Tests: a 180 W card warms the CPU, brownout with a card.
4. **TPM device + protected mode:** MMIO commands, encryption surcharge, out-of-range fault. Tests: cost per word, determinism of the quote.
5. **`secure` job template** and gating; class becomes runnable at level 9. Tests: generated program runs on the reference interpreter with a fake TPM, refused without a TPM.
6. **GPU ISA and assembler table** (second opcode set, lane registers, mask). Tests: assembler round-trip, a reference interpreter for the GPU ISA.
7. **GPU engine** (unpipelined `gpu1`, lockstep, divergence, banked memory, MMIO launch). Tests: matches the GPU reference interpreter on generated kernels, golden cycle trace for `blur3`.
8. **`gpu` job template** (`vadd`, `saxpy`, `blur3`, `mandel`) and gating; class runnable at level 10.
9. **NPU device** (descriptor list, systolic timing) and the **`npu` job template** with the GPU fallback; class runnable at level 12.
10. **Fast-model keys:** accelerators in the hardware hash, per-class invalidation. Test: swapping a GPU keeps `cli` entries.
11. **Board art** [visual]: card in slot, `pcie` cable, `tpm` header (empty / filled).
12. **Picker art** [visual]: tiles for all accelerator tiers, `psu3`, `display1`.
13. **Internal views** [visual]: GPU lanes and banks, NPU grid, TPM stages; hover ids.
14. **Later tiers:** `gpu2` (pipelined), `gpu3`, `npu2`, `tpm2` as data plus any engine option they need.

Open points for the owner: the NPU as descriptor-driven rather than a third ISA (recommended, for scope) (decided: yes); the case-heat coupling (decided: it stays); no gpu or npu job is gated by hardware or paid less without the card (decided, T67).
