# The VRM, the board ladder and VRM cooling

Code: `src/sim/board/vrm.ts` (the maths), `src/sim/board/thermal.ts` (the VRM's temperature state, stepped with everything else), `src/sim/board/specs.ts` (`BOARD_TIERS`, `VrmSpec`, the heatsink parts), `src/sim/game/game.ts` (crash, burn-out, snapshot). **All numbers are placeholders** for the balance pass; the structure is what matters.

## What a VRM is, in plain words

A CPU wants about **1 volt at a very large current** (tens to hundreds of amps in a real PC). The PSU only gives **12 volts**. The **Voltage Regulator Module (VRM)** on the motherboard turns one into the other. It is not one big part but a row of small identical circuits called **phases**, each a **buck converter**:

- two power transistors (**MOSFETs**) that switch the 12 V on and off very fast, under the control of a **PWM controller** chip;
- an **inductor** (a coil) that smooths those pulses into a steady current;
- **capacitors** that smooth the voltage further.

Switching on for a short slice of each cycle gives a lower average voltage: 12 V on for about 1/12 of the time gives about 1 V. Nothing here is lossless: the MOSFETs and coils waste a few percent as heat.

Why **several phases**: the CPU's current is split between them, and the controller runs them one after another (interleaved). So each phase carries less current (it runs cooler), and the output voltage has less ripple because the pulses overlap. More phases is steadier and cooler, and costs more board.

**Component quality** decides two things: **efficiency** (how much power is wasted as heat in the VRM) and **ripple** (how much the voltage wobbles around its target). Cheap parts waste more and wobble more.

**Cooling**: the heat produced by the MOSFETs has to go somewhere. A finned **heatsink** on them, and airflow over it (a CPU air cooler's fan blows across the area; a liquid cooler does not, which is why liquid-cooled builds often add a small fan for the VRM), carry it away.

## How a VRM fails

1. **Thermal throttling.** Hot MOSFETs lose efficiency and eventually the controller protects itself by cutting the power it allows the CPU, so the CPU slows down. The machine still works, just slower.
2. **Voltage droop and ripple.** When the CPU asks for more current than the phases can supply (a big CPU on a small VRM, or an overclock that raises both clock and voltage), the voltage sags and wobbles. The CPU then makes errors: the program computes a wrong value, or the machine crashes and reboots. Worst when overclocking, and worse with poor components.
3. **Burn-out.** If the overload or the heat is sustained, MOSFETs fail (usually shorted) and the board is dead. Nothing else on the board is harmed, but the machine cannot power on until the board is replaced.

## The model

One VRM per board, described by a `VrmSpec` that belongs to the **board tier** (not a part you buy; the part you can buy is the heatsink). It is simulated once per base tick inside `ThermalModel.step`, after the CPU's power is known.

Per tick, with `P` the CPU's power in W this tick (same power model as everything else) and `r` = CPU effective clock / CPU base clock:

```
vcore       = 1.0 + 0.3 * (r - 1)             volts, floored at 0.7  (voltage rises with clock)
demand      = P / vcore                       amps  (1 W at 1 V is 1 A; r^3 power over a rising voltage: demand grows ~ r^2)
capacity    = phases * ampsPerPhase           amps
loadRatio   = demand / capacity               per-phase load; 1 = every phase at its rating
efficiency  = clamp(peak - light - heavy, 0.4, peak)
   light    = 0.12 * max(0, 1 - loadRatio / 0.15)       phases are wasteful at very light load
   heavy    = 0.35 * max(0, loadRatio - 0.6)^2           and when pushed past 60% of rating
lossW       = P * (1 / efficiency - 1)        heat made in the VRM
total draw  = ... + P + lossW                 (the loss is drawn from the PSU like any other part)
T          += (lossW - (passive + sinkK + airK) * (T - ambient)) / mass
```

`passive` is the spec's own cooling to the case; `sinkK` is the installed VRM heatsink's `coolingPerC` (0 with none); `airK` is the installed CPU cooler's `vrmAirPerC` (an air cooler blows over the VRM, **a liquid cooler gives 0**; a burnt cooler gives 0). `sinkK` and `airK` apply only while the machine is powered.

Behaviours:

- **Thermal throttle** (`THROTTLE_MIN` style, same shape as the CPU's): factor 1 up to `throttleC`, falling linearly to 0.8 at `unstableC`. Computed from last tick's temperature and **multiplied into the CPU's effective clock**, on top of the CPU's own throttle and the PSU factor. So a hot VRM slows the CPU by up to 20%, which also lowers its demand.
- **Instability**: `unstable` when `loadRatio > 1` (past the phases' rating) or `T > unstableC`. Then `errProb = min(0.5, (0.01 + 0.2 * max(0, loadRatio - 1) + 0.02 * max(0, T - unstableC)) * (0.5 + 1.5 * ripple))`, so more overload, more heat and sloppier components all raise it. `ThermalModel.vrmErrorRoll()` draws from the machine PRNG **only while unstable** (like `errorRoll`), so a healthy VRM never touches the PRNG stream. In the game it is rolled while the machine is busy, next to the CPU's own roll. A hit crashes the machine exactly like a thermal CPU error (the machine cold-reboots, the plugged key's job restarts from the ROM, `errors` and the key's `attempts` go up) and writes `VRM voltage droop: the machine crashed and rebooted` to the event log.
- **Burn-out**: a stress counter goes up by 1 each tick when `T > damageC` or `loadRatio > 1.6`, and down by 1 otherwise. At `DAMAGE_TICKS` (10) the VRM is burnt: `Board.burnt = true`. A burnt board: nothing draws (every clock is 0), the machine cannot be powered on (`noPowerReason` and, if it happens while running, `phaseReason`: **"board dead: replace the board"**), installed parts stay in their slots as dead weight, and the flag is saved. It is fixed only by **buying a board of the same or a higher tier**: the dead board is thrown away and every installed device is carried over (same as any board upgrade).
- **Idle stays cool**: at idle `P` is a couple of watts, `loadRatio` is tiny and the loss is under 1 W.

### What must not happen

A CPU on its tier's board (`cpu0` on Starter, `cpu1` on Basic, `cpu2` on Mainstream, or on any better board) at stock clock under full load never gets near `throttleC`, and `loadRatio` stays below 1. Trouble needs one of: an **overclock** (power and voltage both rise), a **heavy CPU on a weak board** (`cpu2` on Starter: loadRatio about 1.5, it crashes at once and cooks), a bad or absent heatsink with liquid cooling, or (later) a hot case.

## The board ladder

Four tiers, `BOARD_TIERS[tier]`, purchase ids `board1` ... `board3` (the number is the tier; the start board is tier 0 and is free). Slots a tier lacks are simply absent from `snapshot.slots`; the renderer draws the missing ones unpopulated on one shared layout.

| Tier | Name | Price | cpu | dimm | pcie | sata | m2 | usb | display | vrm-sink | power | Ethernet | VRM (phases x A, peak eff, ripple) |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | Starter | $0 (replacement $40) | 1 | 1 | 0 | 1 | 0 | 1 | 1 (HDMI) | 1 | atx | none | 2 x 12 A = 24 A, 0.80, 0.60 |
| 1 | Basic | $150 | 1 | 2 | 1 | 2 | 0 | 2 | 1 | 1 | atx | 100 Mbit | 3 x 12 A = 36 A, 0.84, 0.45 |
| 2 | Mainstream | $300 | 1 | 4 | 2 | 2 | 1 | 3 | 1 | 1 | atx-plus | 100 Mbit | 4 x 15 A = 60 A, 0.88, 0.25 |
| 3 | Enthusiast | $700 | 1 | 8 | 4 | 2 | 1 | 4 | 1 | 1 | atx-plus | 1 Gbit | 6 x 20 A = 120 A, 0.92, 0.10 |

Notes: all tiers can take one VRM heatsink (the Starter board included: the part is cheap and teaches the idea). SATA stays at 2 and M.2 at 1 because the bus has exactly those storage ports (`sata0`, `sata1`, `m20`); more would need more bus windows (RAID phase). `features` is `{ethernetMbps, usbPorts, displayPorts}`; `displayPorts` is 1, 1, 2, 2 as a visual/feature count (the sim supports one monitor so far; there is still one `display` slot). Ethernet is a feature field only: the network phase will read it, there is no network device or behaviour yet. VRM per tier (all tiers): `passive` 0.15 / 0.20 / 0.30 / 0.40 W per degree C, `mass` 20 / 30 / 45 / 60 J per degree C, `throttleC` 90, `unstableC` 105, `damageC` 120.

Buying: `board<N>` is offered for the next tier, and for the same tier when the installed board is burnt (price of that tier). **A board can only be bought while the machine is powered off** (the shop says "powered off required"). It goes to the inventory like any part; installing it carries every device over. Installing a board while a burnt flag is set clears the flag.

## VRM heatsinks (kind `vrm-sink`, slot type `vrm-sink`)

| Id | Part | coolingPerC | Draw (idle / load W) | Price |
|---|---|---|---|---|
| vsink0 | Passive fins | 0.25 | 0 / 0 | $30 |
| vsink1 | Big fins | 0.5 | 0 / 0 | $70 |
| vsink2 | Fins and small fan | 1.0 | 0.3 / 1.5 (follows CPU load) | $140 |

Coupling to the CPU cooler (`CoolerSpec.vrmAirPerC`): stock heatsink 0.05, tower fan 0.25, **liquid loop 0**. A liquid-cooled CPU therefore leaves the VRM with only its own passive path and the sink, which is why a good CPU cooler can make the VRM the new bottleneck.

## Snapshot (`snapshot.board`)

```ts
board: {
  tier, name, burnt,                       // burnt: the VRM burnt out, the board is dead
  features: { ethernetMbps, usbPorts, displayPorts },
  slots: SlotSnap[],                       // only slots this tier has (same list as snapshot.slots)
  vrm: { phases, ampsPerPhase, tempC, loadRatio, efficiency, throttle, unstable, burnt, errProb, heatW,
         ripple, throttleC, unstableC, damageC, sinkDeviceId: string | null },
  vrmSink: DeviceSnap | null,              // the installed heatsink (also in snapshot.devices)
}
```

`vrm.throttle` is the VRM's own factor in [0.8, 1], `heatW` the loss this tick, `loadRatio` demand over capacity. Temperatures are not saved. `snapshot.power.totalW` includes the VRM loss.

## Save

Version 4 (see [`SAVE.md`](SAVE.md)): `board.burnt` is saved; the VRM temperature is not. Migration 3 to 4 renumbers the board tier: **old tier 0 (2 DIMMs) becomes Basic (1), old tier 1 becomes Mainstream (2)**; inventory `board1` becomes `board2` (the old bigger board).
