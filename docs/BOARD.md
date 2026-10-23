# Devices, board, power and heat

Code: `src/sim/board` (import from `src/sim/board`). No DOM imports. **All numbers are placeholders** for a balance pass.

## Specs (`specs.ts`)

Devices are plain records in `DEVICE_SPECS` (`getSpec(id)`, `specsOfKind(kind)` gives the tier ladder). Common fields: `id, kind, tier, name, slot` (slot type needed; for a PSU the power connector), `price, idleW, loadW` (W at base clock), `heatFactor` (fraction of power that becomes heat), `clock {min, base, max}` (ticks per base tick; absent for PSU and cooler), `thermal {passive, mass, throttleC, unstableC, damageC}`, `visual` (opaque renderer key).

| Kind | Extra fields | Catalog (tier: clock base) |
|---|---|---|
| cpu | `engine: EngineConfig` | cpu0 unpipelined (1), cpu1 in-order no forwarding (2), cpu2 in-order + forwarding, 16-line cache (3) |
| ram | `sizeBytes, latency` (RAM ticks per access) | 16K lat 200, 32K lat 12 (2x clock), 64K lat 4 (3x clock) |
| psu | `watts` | 40 W and 100 W (`atx`), 250 W (`atx-plus`) |
| cooler | `coolingPerC` (W per degree C, CPU only) | stock 0.35, tower 0.8, liquid 1.8 |
| display | `writeLatency` | CLI monitor |
| storage | `capacityBytes, latencyTicks, blockTicks` | hdd0 HDD 96K (SATA, clock 1), ssd1 SATA SSD 64K (SATA, clock 2), nvme2 NVMe SSD 128K (M.2, clock 4). A block device on the bus, see [`OS.md`](OS.md) |

Slot types: `cpu dimm pcie sata m2 usb cooler display atx atx-plus`. Board tiers (`BOARD_TIERS`): tier 0 = 1 cpu, 2 dimm, 1 sata, 1 usb, 1 atx, 1 cooler, 1 display; tier 1 adds dimms, pcie, a second sata, **1 m2**, `atx-plus` instead of `atx`. **`sata` and `m2` are real, typed and installable** (storage drives; slot ids `sata0`, `sata1`, `m20`; a drive's clock domain is named after its slot). SATA power rule: a SATA drive needs a free sata slot and its `loadW` inside the PSU rated load (no connector count); NVMe needs the m2 slot. Tier ladder and the unlock principle: [`TECHTREE.md`](TECHTREE.md). An `atx-plus` slot also accepts plain `atx` PSUs (`slotAccepts`). `upgradeBoard(board, tier)` moves to a bigger tier carrying devices over (see GAME.md purchases).

## Board (`board.ts`)

`Board = {tier, nextId, devices: InstalledDevice[]}`, `InstalledDevice = {id, spec, slot, clock?, burnt?}`. Plain data; slots are derived from the tier (`boardSlots`, ids like `dimm0`).

- `install(board, specId, slotId?)` returns `{ok:true,id,slot}` or `{ok:false,reason}`: wrong slot type, slot used, no free slot, no such slot, or PSU limits. Auto-picks the first free slot of the right type.
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
