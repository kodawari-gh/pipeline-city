# Devices, board, power and heat

Code: `src/sim/board` (import from `src/sim/board`). No DOM imports. **All numbers are placeholders** for a balance pass.

## Specs (`specs.ts`)

Devices are plain records in `DEVICE_SPECS` (`getSpec(id)`, `specsOfKind(kind)` gives the tier ladder). Common fields: `id, kind, tier, name, slot` (slot type needed; for a PSU the power connector), `price, idleW, loadW` (W at base clock), `heatFactor` (fraction of power that becomes heat), `clock {min, base, max}` (ticks per base tick; absent for PSU and cooler), `thermal {passive, mass, throttleC, unstableC, damageC}`, `visual` (opaque renderer key).

| Kind | Extra fields | Catalog (tier: clock base) |
|---|---|---|
| cpu | `engine: EngineConfig` | cpu0 unpipelined (1), cpu1 in-order no forwarding (2), cpu2 in-order + forwarding, 16-line cache (3) |
| ram | `sizeBytes, latency` (RAM ticks per access) | 16K lat 200, 32K lat 12 (2x clock), 64K lat 4 (3x clock) |
| psu | `watts` | 40 W and 100 W (`atx`), 250 W (`atx-plus`) |
| cooler | `coolingPerC` (W per degree C, CPU only), `vrmAirPerC` (airflow over the VRM) | stock 0.35 / 0.05, tower 0.8 / 0.25, liquid 1.8 / **0** |
| display | `writeLatency` | CLI monitor |
| vrm-sink | `coolingPerC` | vsink0 fins (0.25), vsink1 big fins (0.5), vsink2 fins + fan (1.0, draws 0.3 / 1.5 W). Bolts onto the board VRM, slot `vrm-sink`, see [`VRM.md`](VRM.md) |
| storage | `capacityBytes, latencyTicks, blockTicks` | hdd0 HDD 96K (SATA, clock 1), ssd1 SATA SSD 64K (SATA, clock 2), nvme2 NVMe SSD 128K (M.2, clock 4). A block device on the bus, see [`OS.md`](OS.md) |

Slot types: `cpu dimm pcie sata m2 usb cooler display atx atx-plus vrm-sink ram-sink tpm`. Accelerators ([`ACCEL.md`](ACCEL.md)): device kinds `gpu`, `npu`, `tpm`; the `tpm` header is one slot on Mainstream and Enthusiast and absent on Starter and Basic; GPU and NPU cards use `pcie` slots (competing with NICs); `PsuSpec.pcieLeads` (0, 0, 1 for `psu0..2`) is how many PCIe power leads a PSU has; `install` refuses a card drawing more than `PCIE_SLOT_W` (75 W) unless its spec has `needsPcieCable`. The card and TPM specs themselves come with T69. **Board tiers are a four-step ladder with a VRM each: Starter, Basic, Mainstream, Enthusiast (table, VRM and heatsinks in [`VRM.md`](VRM.md))**. The Starter board has 1 DIMM, 1 SATA, 1 USB, 1 display, ATX power, no PCIe, no M.2, no ethernet; slots a tier lacks are absent from `boardSlots` and from `snapshot.slots` (the renderer draws them unpopulated on one shared layout). `BoardTierSpec` = `{tier, name, price, slots, features: {ethernetMbps, usbPorts, displayPorts}, vrm: VrmSpec, visual}`; `features.ethernetMbps` (0, 100, 100, 1000) is a field only, the network phase will read it. The text below that mentions "tier 0 / tier 1" slot counts is the old two-tier layout: the old tier 0 is now Basic, the old tier 1 Mainstream. Board tiers (`BOARD_TIERS`): tier 0 = 1 cpu, 2 dimm, 1 sata, 1 usb, 1 atx, 1 cooler, 1 display; tier 1 adds dimms, pcie, a second sata, **1 m2**, `atx-plus` instead of `atx`. **`sata` and `m2` are real, typed and installable** (storage drives; slot ids `sata0`, `sata1`, `m20`; a drive's clock domain is named after its slot). SATA power rule: a SATA drive needs a free sata slot and its `loadW` inside the PSU rated load (no connector count); NVMe needs the m2 slot. Tier ladder and the unlock principle: [`TECHTREE.md`](TECHTREE.md). An `atx-plus` slot also accepts plain `atx` PSUs (`slotAccepts`). `upgradeBoard(board, tier)` moves to a bigger tier (or the same tier again while the board is burnt, which clears the flag) carrying devices over (see GAME.md purchases).

## Board (`board.ts`)

`Board = {tier, nextId, devices: InstalledDevice[], burnt?}` (`burnt`: the VRM burnt out, the board is dead), `InstalledDevice = {id, spec, slot, clock?, burnt?}`. Plain data; slots are derived from the tier (`boardSlots`, ids like `dimm0`).

- `install(board, specId, slotId?)` returns `{ok:true,id,slot}` or `{ok:false,reason}`: wrong slot type, slot used, no free slot, no such slot, or PSU limits. Auto-picks the first free slot of the right type; for a `pcie` card, the narrowest free slot it fits.
- **PCIe widths:** each board tier lists its slots' lane widths in `BoardTierSpec.pcieWidths` (Starter x16; Basic x16, x4; Mainstream x16, x8, x4; Enthusiast x32, x16, x8, x4), and a card spec's `pcieWidth` is the narrowest slot it fits (NICs x4, x4, x8; GPUs x8, x16, x32; NPUs x4, x8). `install` / `placeInto` refuse a narrower slot (`slotRefusal`), `upgradeBoard` moves the widest cards first, and `boardFromJson` does not check widths so an older save keeps its cards. The board art's slot rails are as long as their width.
- PSU rule: a PSU needs a matching connector and `watts >= rated load` (sum of `loadW` at base clocks of all non-PSU parts). With a PSU present, a new part is refused if rated load would exceed it. Overclocking can still exceed the budget at run time (brownout below).
- `uninstall`, `setClock(board, id, clock)` (range checked), `boardToJson` / `boardFromJson` (validates; throws on bad saves).

Serialization shape (this is the board part of the save; temperatures are not saved, they restart at ambient):

```json
{ "tier": 0, "nextId": 6, "devices": [ { "id": "dev1", "spec": "cpu0", "slot": "cpu0", "clock": 1 }, { "id": "dev2", "spec": "ram0", "slot": "dimm0", "clock": 1, "burnt": true } ] }
```

## Power and heat (`thermal.ts`)

`const th = new ThermalModel(machine.prng); th.step(board, {cpu: load, ...})` once per base tick (load 0..1 per kind, default 1). Per device: `r = effClock / baseClock`; `power = idleW*r + (loadW-idleW)*load*r^3`; `T += (heat - (passive + coolerCoeff[CPU only]) * (T - 25)) / mass`. Effective clock = requested * thermal factor * PSU factor. Read `th.state(id)` (tempC, powerW, effClock, throttle, unstable, stress), `th.power`, `th.effectiveClock(id)`.

- **Throttle**: factor 1 up to `throttleC` (CPU 70), falling linearly to 0.8 at `unstableC` (85). Throttling only trims 20%, so heavy overclock or poor cooling still runs away.
- **Instability**: above `unstableC`, `th.errorRoll(id)` returns true with p = 1% + 2%/degree (max 50%) using the machine PRNG. It consumes PRNG state only while unstable. Engines are not wired to it yet; the sim decides what an error does.
- **Damage**: above `damageC` (CPU 95) for 10 accumulated ticks (each cool tick forgives 1) the device gets `burnt = true`: clock 0, no draw, until uninstalled/replaced.
- **Brownout**: total draw > PSU watts: all clocks scaled by `watts/draw` (forced throttle). Draw > 1.5x watts: hard trip, everything off (clock 0) until `th.powerCycle()`. No working PSU: off.

## Wiring (`apply.ts`)

- `machineConfigFor(board, seed?)`: `MachineConfig` with total DIMM bytes, initial cpu/display rates, display latency (RAM size is fixed at Machine construction).
- `applyRates(board, machine, thermal?)`: `clock.setRate` for the `cpu` and `display` domains (and `ram` if such a domain exists), using throttled effective clocks; rate 0 for missing or burnt parts. Call after each `th.step`. Clock to rate: `{mul: round(clock*100), div: 100}`.
- `engineConfigFor(board)` / `applyEngine(board, machine, program)`: engine from the CPU spec, `missPenalty = ceil(ram.latency * cpuClock / ramClock)`; with several working RAM sticks the **slowest** one (highest penalty) counts. The game calls `applyEngine` at every power-on with the boot ROM as the program (caches go cold).

## Cables and the boot check (`cables.ts`)

Cables are board connectors that are either plugged or not: `CableId` = `atx` (24-pin, from the PSU), `cpu` (8-pin, from the PSU), `video` (from the monitor's display output). `Cables` is `Record<CableId, boolean>`, owned by the Game (not part of `Board`/`BoardJson`; saved next to it). `connectCable(board, cables, id)` needs the source part installed (a PSU, or the monitor) and says why otherwise; `disconnectCable(cables, id)`; `pruneCables(board, cables)` unplugs cables whose source part is gone (after an uninstall; a swap keeps them). `bootCheck(board, cables)` returns `{noPower, post}`: `noPower` (no PSU, burnt PSU, ATX cable off: the power button does nothing) and `post` (`{reason, short}` for a missing/burnt CPU, 8-pin cable off, or no working RAM: the machine powers on but POST fails). See [`ASSEMBLY.md`](ASSEMBLY.md).

The thermal model's `step(board, loads, powered = true)` takes a `powered` flag: false means switched off (nothing draws, parts cool, the trip latch is untouched).

Other changes for the assembly phase: `ram0` latency 100 to 200 (RAM stays a real choice now that jobs boot first), `Display` has `connected` (no monitor: writes go nowhere) and `setText` (the PCH's own POST error text).

## The VRM and the board ladder

The VRM is a per-tier component, simulated inside `ThermalModel.step` (state in `th.vrm`, maths in `vrm.ts`): its conversion loss is added to the PSU draw (`th.power.vrmLossW` is included in `totalW`), a hot VRM multiplies the CPU clock by a factor in [0.8, 1], overload or heat makes `th.vrmErrorRoll()` fire (PRNG only while unstable), and sustained trouble sets `board.burnt` (a dead board: `bootCheck.noPower = "board dead: replace the board"`, nothing draws). Full model, numbers and the plain-words explanation: [`VRM.md`](VRM.md). Snapshot: `snapshot.board` (tier, name, burnt, features, slots, vrm, vrmSink) and `snapshot.power.vrmLossW`.

Heatsink slot `vrm-sink`: one per board on every tier (the Starter board too). Cooler coupling: an air cooler adds `vrmAirPerC` of cooling to the VRM, a liquid cooler adds none. Board tiers carry the VRM's strength (phases x amps: 24, 36, 60, 120 A). Tests: `src/sim/board/vrm.test.ts`.

## Cases

The PC case is part of the machine (`CASE_TIERS` in `specs.ts`, `Board.caseTier`, `snapshot.caseTier` and `snapshot.board.caseName / caseForm`). A case of tier `t` holds boards up to `maxBoard` = `t`: **Mini tower** (mini-ITX, the Starter board; the campaign starts in it), **Micro tower** (micro-ATX), **Mid tower** (ATX) and **Full tower** (E-ATX). Prices are placeholders ($25, 70, 160, 320).

- **A bigger board needs a bigger case first.** `applyOffer`, `Game.install` and the shop's `blocked` text refuse a board the case cannot hold ("the Mini tower is too small for a Basic board: buy a Micro tower first"). Owning the bigger case in the inventory is enough to buy the board; fitting the board needs the case fitted. A dead board of the same tier needs no bigger case.
- **Offers**: the next case tier (`case1`...), also in the shop with its level lock (a case unlocks with its board: levels 2, 5 and 9). A case item installs onto the case (`freeSlots ["case"]`) only with the machine off (`purchase` and `install` say so); every part stays where it is.
- **Not gated**: the sandbox, and a game whose `economy.caseGating` is false (the sim tests): there the case follows the board (`caseFor(tier)`).
- The primitive `upgradeBoard` does not look at the case (the game does); `upgradeCase` only goes up. `createBoard(tier, caseTier?)` puts a board in the smallest case that holds it. `src/sim/game/case.test.ts`.
