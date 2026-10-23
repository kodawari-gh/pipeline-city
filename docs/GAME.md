# Economy and game loop

Code: `src/sim/game` (import from `src/sim/game`). No DOM imports; it will run inside the sim worker. **All numbers are placeholders** in one object, `ECONOMY` in `economy.ts`.

## API (`game.ts`)

```ts
const g = new Game({ seed, economy? /* Partial<EconomyConfig> */ });
g.advanceBaseTick();            // one base tick = 1 s at 1x
g.purchase("cpu1");             // { ok: true, pending } | { ok: false, reason }
g.setCpuClock(1.5);             // overclock / underclock, range-checked
g.powerCycle();                 // clear a PSU hard trip
g.snapshot();                   // plain JSON-serialisable object
```

Public fields for tests/tools: `money`, `baseTick`, `completed`, `errors`, `dropped`, `lastCompleted`, `board`, `machine`, `thermal`.

Per `advanceBaseTick`: arrivals (one PRNG draw per tick) -> start next request if idle -> `machine.advanceBaseTick()` -> completion check (engine halted and display drained) -> `thermal.step` -> thermal error roll -> `applyRates` (+ scaling, below). Everything random comes from the machine PRNG, so a seed plus a purchase script is fully reproducible.

Starting machine: board tier 0 with `cpu0` (unpipelined), `ram0` (16K), `display0`, `cooler0` (stock), `psu0` (40 W). The Machine's RAM is allocated at 64K regardless of the installed DIMM, because RAM size is fixed at Machine construction; the installed RAM tier changes the cache miss penalty (via `engineConfigFor`) and which jobs arrive (`mix.minRamBytes`, an optional unlock; the starting mix has none, so RAM does not gate any job).

## Requests

`startQueue` (default one `cli.log`) is queued at tick 0 so the first request is the guided tutorial. Afterwards a request arrives with probability `demandRate` per tick. Each is `generate(template, seed)` from `src/sim/gen`; its payout base is the reference instruction count. Queue is capped at `queueCap`: an arrival into a full queue is dropped (`dropped` counter), so the queue is bounded, an under-provisioned machine shows a full queue and falling reputation (which shrinks demand) rather than unbounded growth.

A request runs with a fresh engine (`applyEngine`), blank display. **Purchases are deferred while a request is running** (money is spent now, the board change is applied when the next request starts), which is the "CPU upgrades only between requests" rule; if idle, or the CPU is burnt, they apply at once. Validation uses the board with earlier pending purchases applied.

Completion: engine halted and every display write landed. `payout = round(payPerInstr * work * speed * (late ? lateFactor : 1))`, `speed = clamp(targetTurnaround / turnaround, speedMin, speedMax)`, `late` = past the soft deadline (`deadlineTicks` after arrival; still paid, at `lateFactor`).

**Reputation and demand**: `avgTurnaround` is an EMA (`emaAlpha`) of turnaround (arrival to completion, so queue wait counts), starting at the target. `reputation = clamp(targetTurnaround / avgTurnaround, repMin, repMax)`; `demandRate = baseDemandPerTick * reputation`.

**Thermal errors**: each tick while a request runs, `thermal.errorRoll(cpu)` can fire (only when the CPU is above its unstable temperature). The attempt is thrown away (no payout), the request restarts from its first instruction with a cold engine and blank display, `errors` and the request's `attempts` increment. Turnaround keeps counting from arrival. A burnt CPU (or a tripped/absent PSU) leaves the request stalled until replaced.

## Purchases

Items are device spec ids: CPU `cpu1`, `cpu2`; RAM `ram1`, `ram2`; cooler `cooler1`, `cooler2`; PSU `psu1` (`psu2` needs the ATX+ board, no board purchase yet, so it shows as blocked). Each replaces the installed part of that kind (`swapPart`, through `install`'s slot and PSU-watt validation; failure restores the board exactly). Only higher tiers are offered, plus a same-tier replacement of a burnt part. The clock setting is free via `setCpuClock`; the new part starts at its base clock. Example refusal: `cpu2` needs 41 W of rated load, so `psu1` must be bought first.

## Snapshot (`Snapshot`)

`money, cycle` (total CPU cycles), `baseTick, queueLength, queueCap, request` (null or `{id, template, arrivalTick, deadlineTick, payoutEstimate, engineCycle, attempts}`), `display` (text), `counters` (engine view counters by name: cycles, retired, stallLoad, ..., cacheMisses), `completed, errors, dropped, lastCompleted` (`{id, template, payout, turnaround, execTicks, late, attempts, completedAt}`), `avgTurnaround, reputation, demandRate`, `devices[]` (`id, spec, kind, name, burnt, requestedClock, effectiveClock, tempC, powerW, throttle, unstable`), `power` (`totalW, budgetW, psuFactor, off, tripped`), `cpuClock` (`{value, min, max}`), `purchases[]` (`id, name, kind, price, affordable, blocked?`), `pendingPurchases[]`.

## Pacing: the "1 tick = 1 second" caveat

The unpipelined engine takes about 5 cycles per instruction, so a `cli.log` request is ~110 cycles, and `calc`/`checksum` ~200. At the board's CPU clock of 1 tick per base tick that is 110 to 200 s, over the 20-40 s target. **Settled decision (owner): pacing stays as is.** Base tick 1 s, and `cpuCyclesPerClock = 4`. The world clock is unchanged (1 base tick = 1 s at 1x), but the CPU and display domains run **4 engine cycles per spec clock unit per base tick** (`syncRates` multiplies the rate that `applyRates` computes). So the starting CPU does 4 cycles/s, and the other tiers (clock 2, 3) do 8 and 12 cycles/s. The board specs are untouched.

Measured at 1x on the starting machine (see `game.test.ts`): first request (`cli.log`) done at tick 28, payout $53; the cheapest part ($50 cooler) is affordable at ~tick 30, `ram1` ($100) at ~100 s, `cpu1` ($200) at ~190 s in a no-spend run. `payPerInstr = 1.2` was tuned to get those (the starting `cli.log` is still the first request). `calc`/`checksum` take 45-51 s, so with the default demand the queue grows and reputation drops towards `repMin` until the player upgrades.

## CPU vs RAM

The starting traffic is a mix (`ECONOMY.mix`): `cli` (log/calc/checksum, weight 1) and `cli.scan` scale 1 (weight 0.5, so one request in three, `payMul` 3 because it is heavier work per request). Scan walks a RAM table with a 64 or 128 byte stride, so **every load misses** the data cache: its time is mostly RAM latency. Log/calc/checksum have no cacheable loads, so RAM does nothing for them.

RAM specs: `ram0` latency 100 (RAM ticks), `ram1` 12 at twice the RAM clock, `ram2` 4. The miss penalty is `ceil(latency * cpuClock / ramClock)`: a fast CPU on slow RAM waits twice as many cycles per miss (`cpu1` on `ram0`: 200 cycles), so a faster CPU alone barely helps scan.

Measured execution time (ticks) of one request, nothing else running (tests assert the ratios):

| profile | base | +cpu1 | +ram1 | +cpu1+ram1 |
|---|---|---|---|---|
| `cli.log` | 28 | 9 | 28 | 9 |
| `cli.scan` scale 2 | ~370 | ~230 | ~185 | ~45 |

So CPU is the big win for log, RAM is the big win for scan, and scan needs both to really fly. Which first purchase pays more over time depends on the mix (`tradeoff.test.ts`, 800 ticks, mean of 6 seeds, income = money earned including what was spent on the two parts; first purchase bought as soon as affordable, then the other):

| mix | nothing | cpu1 only | ram1 only | cpu1 then ram1 | ram1 then cpu1 |
|---|---|---|---|---|---|
| log only | $301 | $836 | $388 | $1407 | $709 |
| starting (33% scan) | $312 | $450 | $422 | $1112 | $1222 |
| scan heavy (80% scan) | $321 | $415 | $429 | $789 | $985 |

Log-heavy traffic: CPU first by a wide margin. Starting mix: nearly a tie (CPU slightly ahead alone, RAM first slightly ahead in the sequence, since it is cheaper and gets bought earlier). Scan-heavy: RAM first. Balance numbers (`payMul`, scan scale, RAM latencies and prices) are placeholders.

## Overclock and heat

`setCpuClock` raises throughput until the stock cooler cannot keep up: on `cpu2` + `psu1` + stock cooler, clock 3 (base) settles ~75 C with light throttling and is the best performer; clock 4 reaches the unstable range, makes errors and burns the CPU about 70 ticks in, completing far fewer requests over 500 ticks (tested). The throttle only trims 20%, so the machine can settle at the unstable edge on a moderate overclock and errors are then rare.
