# Progression: client base, levels, unlocks, patience

Status: **design, not built.** Built after this, before the network phase ([`NETWORK.md`](NETWORK.md)). All numbers are placeholders to be tuned by playing, but every one below is derived from the real numbers in `src/sim/game/economy.ts` and `src/sim/board/specs.ts` as of this writing (quoted where used). Owner decisions are marked **(owner)**.

## Decisions (2026-10-24)

Owner decisions. They override the drafts below where they conflict.

1. **The network unlocks at level 4**, right after the OS (level 3), not level 8. Web jobs arrive at level 4 (once a plan is bought); db jobs at level 3. The unlock table, job mix and network prices are re-spaced to match (see "Unlock table" and "Price check to level 4"). Board Basic stays at level 2 ($150). [`NETWORK.md`](NETWORK.md) follows this everywhere.
2. **Declining** is allowed for any job still waiting (an unrunnable one, or any other waiting one), at a small immediate reputation cost of one third of an expiry. Free in the sandbox. See "Declining".
3. **Dead link:** after 300 ticks without a link, USB keys come back at one third of the rate until the link is up again ([`NETWORK.md`](NETWORK.md) "USB fallback").
4. **Power loss:** everything in RAM is lost; jobs written to the drive survive, so the OS spools each job to disk when its transfer completes ([`NETWORK.md`](NETWORK.md) "Power loss" and "Spool").
5. Every other open question is decided as proposed (marked "decided: default accepted" at the end). Only the genuinely open items remain, listed last.
6. **Build order:** (a) level system, job needs, expiry and decline in the sim; (b) UI for levels (milestone screen, locked tiles, HUD bar, level-up); (c) POST-time function; (d) network sim; (e) network render and UI; (f) CPU tier wiring (inorder2, ooo).

## Why this exists

Today a tier unlocks by money plus hardware only, and client patience follows a tick schedule from the first boot (`ECONOMY.patience`: multiplier 4 until tick 900, linear to 0.6 at tick 3000). The owner wants a Cities: Skylines style **level** driven by a **client base** score. The level:

1. gates what the shop offers (locked items stay visible with their level);
2. sets how patient clients are and how much they pay (replaces the tick schedule);
3. shifts which job types arrive, including ones the player cannot run yet (they expire and hurt reputation, which is the reason to buy the device);
4. is a spine for the tutorial, the milestone screen and a short celebration.

Money and the real hardware rules (slots, PSU watts, cooling, VRM, RAM minimum, OS) **still apply on top**: a purchase needs the level AND the money AND a machine that can carry the part. This supersedes the "no research points, only money and hardware" principle of `docs/TECHTREE.md` (updated there).

## The score: CLIENT BASE

```
points(job)  = clamp(reputation at delivery, 0.5, 2.0)
clientBase   = sum of points(job) over every job delivered, lifetime
level        = the highest n with clientBase >= threshold[n]      (thresholds below)
```

- "Delivered" is the moment payout is applied: the key removal today (`ejectKey`), the upload end on the network. A job that expires, is dropped or is aborted gives **0 points and removes nothing**.
- `reputation` is the value of `Game.reputation` at that moment (range 0.4 to 4 in `ECONOMY`, so the clamp [0.5, 2] means a struggling machine still earns half a point per job and a brilliant one at most two; a reputation above 2 does not run the level away).
- **Monotonic by construction**: points are never negative, the score is a running sum, and the level is derived from it. The level can never go down, even after a burnt board, a sold part or a reputation crash. A crash only slows climbing (low reputation means fewer arrivals and 0.5 points per job).
- Late jobs count in full (they are already paid at `lateFactor` 0.5). Open question 4 asks about a late penalty.
- Floating point score, stored as is; thresholds are integers.

### Thresholds and times

Curve: `threshold(n) = round(4 * (n-1)^2.05)`, then rounded to a neat number (to 5 above 40, to 10 above 300, to 50 above 1000). The exponent just above 2 makes each level cost a bit more than the last (increments grow from 13 to 150 points), while the income per second also grows about 1.2x per level (arrivals scale with `demandMul`, reputation rises with better hardware, a level multiplies payouts), so the **time per level stays roughly flat at 15 to 25 minutes** after the first three, and shortens at the end so the last levels do not drag.

Time estimate: for a competent player at 1x (the bots in `patience.test.ts` and `tradeoff.test.ts` are the reference: a first job at 70 to 80 s, about $0.5 per second early, 99 jobs in 4500 s with an OS on a mid rig at reputation 1.2 to 1.8). Points per second modelled as `0.014 * 1.2^(n-2)` (about 1 job per 80 s at weight 1.1 on level 1, about 0.04 at level 8, about 0.2 at level 17). The cumulative times are **estimates, plus or minus 40%**, and depend heavily on how soon the player automates; they have to be re-measured with a bot once the level system exists.

| Level | Name | Threshold (client base) | Increment | Cumulative time (est.) |
|---|---|---|---|---|
| 1 | Garage Bench | 0 | | 0 |
| 2 | Hobby Shop | 4 | 4 | 5 min |
| 3 | Local Gigs | 17 | 13 | 20 min |
| 4 | Small Office | 38 | 21 | 35 min |
| 5 | Storefront | 70 | 32 | 55 min |
| 6 | Neighbourhood | 110 | 40 | 80 min |
| 7 | District | 155 | 45 | 100 min |
| 8 | Town Hub | 215 | 60 | 125 min |
| 9 | Business Park | 285 | 70 | 150 min |
| 10 | Tech Quarter | 360 | 75 | 170 min |
| 11 | Campus | 450 | 90 | 190 min |
| 12 | Data Annex | 550 | 100 | 210 min |
| 13 | Colocation | 650 | 100 | 225 min |
| 14 | Compute Floor | 770 | 120 | 240 min |
| 15 | Enterprise | 900 | 130 | 255 min |
| 16 | Hyperscale | 1050 | 150 | 270 min |
| 17 | Metro Grid | 1200 | 150 | 280 min |
| 18 | Metropolis | 1350 | 150 | 290 min |

18 levels, about 5 hours to the end at 1x for a competent player (a casual one two to three times that). Level 1 to 2 is only 4 points, so the first celebration comes after the first five or six jobs (the first purchase moment). The names are working titles. Level 18 is the cap; the score keeps counting (the HUD shows `1350+`), so the end of the ladder can be extended later without a migration.

## What each level changes (the config row)

```
level  patienceMul  payMul  demandMul   target(s)  deadline(s)
 1     4.00         1.00    1.00        240        720
 2     4.00         1.11    1.12        240        720
 3     3.00         1.23    1.24        180        540
 4     2.40         1.37    1.36        144        432
 5     2.00         1.52    1.48        120        360
 6     1.70         1.69    1.60        102        306
 7     1.45         1.87    1.72         87        261
 8     1.25         2.08    1.84         75        225
 9     1.05         2.30    1.96         63        189
10     0.90         2.56    2.08         54        162
11     0.80         2.84    2.20         48        144
12     0.72         3.15    2.32         43        130
13     0.66         3.50    2.44         40        119
14     0.62         3.88    2.56         37        112
15     0.58         4.31    2.68         35        104
16     0.55         4.78    2.80         33         99
17     0.52         5.31    2.92         31         94
18     0.50         5.90    3.04         30         90
```

- **patienceMul** replaces `patienceMul(cfg, elapsed)`. It scales exactly what it scales today: the reputation target (`targetTurnaround` 60 x mul), the key deadline (`deadlineTicks` 180 x mul, fixed when the key arrives) and the tray-overflow / give-up penalty (`giveUpTurnaround` 180 x mul). The payout's speed bonus keeps the plain `targetTurnaround` 60. Values 4 then falling to 0.6 match the old schedule's endpoints; level 5 (2.0) is where the old schedule stood at tick about 2000 to 2400, level 9 (1.05) around its midpoint tail, and the floor is now 0.5 instead of 0.6 because the end game has a network pipeline that is far faster than the manual loop.
- **payMul** = `round(1.11^(level-1), 2)`: multiplies the final payout after speed and lateness. Compound, not linear, because the later job types are heavier and the planned parts cost more.
- **demandMul** = `1 + 0.12 * (level-1)`: multiplies `baseDemandPerTick` (0.02). More clients arrive as the city grows; without it a rich late machine would be starved. `demandRate = baseDemandPerTick * demandMul(level) * reputation`.
- **Early forgiveness (owner):** levels 1 and 2 keep patience 4: the slow manual no-OS loop (about 75 s per job plus a cold boot each) is fine. The mid-game rig of `patience.test.ts` without an OS fell to reputation 0.5 late; now that happens around levels 5 to 7 (patience 2 to 1.45), the point where an OS is expected. From level 4 (2.4) the network is open and the key loop is still fair. From level 9 (1.05) a hand-fed OS no longer keeps reputation up: with an OS alone a job still waits for a second plug and a power cycle after a crash, and the deadlines of the last levels cannot be met by hand. That is where the network, and its web jobs, carries the load.
- Feasibility check at level 4, the first network level (patienceMul 2.4): target 144 s, deadline 432 s. A `cli.log` job through the network path is download (3.8 s at 50 Mbit) + spool write + about 7 s run on cpu1 + upload (1.6 s at 10 Mbit) = about 15 s. Through the OS and keys it is about 60 s when the player is attentive. Both pass. At level 4 the key loop is still fair, so the network's first pull is removing the plugging and retiring the sticks, and its web jobs, which the key loop cannot serve at all.

## Unlock table

"Buy" means appears in the shop and can be bought if money and hardware allow. Everything listed stays visible from level 1 as a greyed illustrated tile marked `Level N` until reached. Ids in `code` exist in `specs.ts` / `src/sim/os/specs.ts` today; **(planned)** ids are proposed names for items not yet in the catalog (the owner or the engines/GPU agents may rename them). Prices of planned items are orders of magnitude only (about 5 to 15 minutes of income at the level they unlock).

| Lvl | Buy: devices and tiers | Boards / OS / network | New job types arriving (see mix below) |
|---|---|---|---|
| 1 | start crate: `cpu0`, `ram0`, `psu0`, `cooler0`, `display0`, board 0 Starter. Shop: `cpu1` ($200), `ram1` ($100, buy **two**: 2 x 32K = 64K, the RAM the network needs), `cooler1` ($50), `psu1` ($60), `vsink0` ($30) | none | `cli.log`, `cli.calc`, `cli.checksum`, `cli.scan` (scan ramps in over 300 ticks as today) |
| 2 | `vsink1` ($70), `hdd0` ($40) | board 1 Basic ($150: 2 DIMM, 1 PCIe, 100 Mbit jack, live from level 4) | none new (heavier `cli` scales) |
| 3 | `ssd1` ($150) | `os1` Resident OS ($150: needs a drive and 32K RAM) | **db** (needs an OS and a SATA SSD or better) |
| 4 | | **Network start** ([`NETWORK.md`](NETWORK.md)): `router1` ($60, 100 Mbit), `isp1` ($150, 50/10 Mbit, 2 clients); the Basic jack goes live and the ethernet cable comes free with the router; the automation lesson. Needs `os1` and 64K RAM | **web** (once a plan is bought; needs a live link to run) |
| 5 | `psu2` 250 W ATX+ ($250), `ram2` 64K low-latency ($400) | board 2 Mainstream ($300: 4 DIMM, 2 PCIe, M.2, ATX+, 100 Mbit jack) | db and web grow |
| 6 | `cpu2` ($800; needs the Mainstream VRM), `cooler2` ($300) | `isp2` ($500: 200/50 Mbit, 4 clients) | |
| 7 | `nvme2` ($400, M.2 SSD), `vsink2` ($140), case fans `fan1` (**planned**) | `router2` ($200, 1 Gbit), `nic1` ($120, 1 Gbit PCIe card) | |
| 8 | `cpu3` 2-wide in-order (**planned**, engine `inorder2`; price TBD) | `os2` Cooperative OS (**planned**: `programSlots` 2, $600) | |
| 9 | `tpm1` secure module (**planned**), `ram3` ECC RAM (**planned**) | board 3 Enthusiast ($700: 8 DIMM, 4 PCIe, onboard 1 Gbit), `isp3` ($1500: 1000/300 Mbit, 8 clients) | **secure / TPM job** (needs a TPM) |
| 10 | `gpu1` (**planned**, PCIe + PCIe power connector), `psu3` 500 W (**planned**), `display1` graphics display (**planned**) | | **GPU render** (needs a GPU) |
| 11 | `cpu4` out-of-order (**planned**, engine `ooo`; wants a 250 W+ PSU and liquid cooling), `cooler3` big radiator (**planned**) | `router3` ($700, 10G, 8 clients), `nic2` ($500, 10G card) | |
| 12 | `npu1` (**planned**) | | **NPU inference** (needs an NPU) |
| 13 | `tpm2` (**planned**) | `os3` Preemptive OS (**planned**: `programSlots` 4, $2000) | |
| 14 | `cpu5` multicore (**planned**), `gpu2` (**planned**) | `isp4` ($5000: 5000/1500 Mbit, 16 clients) | **HPC multi-core simulation** (needs a multicore CPU) |
| 15 | `psu4` 1 kW (**planned**) | board 4 server (**planned**: second CPU socket, more PCIe) | |
| 16 | `gpu3`, `npu2` (**planned**), RAID of two NVMe (**planned**) | | |
| 17 | | `nic3` 40 Gbit card ($1800), `router4` ($2500, 40G, 16 clients) | |
| 18 | | `isp5` ($15000: 20000/10000 Mbit, 32 clients); "build a second machine" (far future, not designed) | |

Notes on the table:

- **Every item in `specs.ts` is covered**: `cpu0` (start) `cpu1` L1 `cpu2` L6; `ram0` start `ram1` L1 `ram2` L5; `psu0` start `psu1` L1 `psu2` L5; `cooler0` start `cooler1` L1 `cooler2` L6; `vsink0` L1 `vsink1` L2 `vsink2` L7; `hdd0` L2 `ssd1` L3 `nvme2` L7; `display0` start; boards 0 start, 1 L2, 2 L5, 3 L9; `os1` L3, `os2`/`os3` L8 / L13 (still "later" until built; their data entries exist). The engines `inorder2` and `ooo` become `cpu3` (L8) and `cpu4` (L11); `docs/ENGINES.md` says the game does not use them yet, and HANDOVER build step (f) wires them. They need a spec entry, the VRM demand data and picker art before the level only gates them.
- **Ordering rationale.** Level 1 keeps the CPU-versus-RAM first decision intact (`cpu1` and `ram1` both on sale from the start; `tradeoff.test.ts` buys them in the first minutes). The board and the OS come at levels 2 to 3 because that is when the manual loop starts to hurt (patience 3 at level 3). The network starts at level 4, right after the OS (owner decision 1): the Basic jack, a router and a plan are the cheapest step that takes the plugging out of the loop, and the $750 they need is about what a player has earned by then (see the price check below). Mainstream and `cpu2` move to levels 5 and 6, after the network start, so the first level-4 bill stays small. The second 32K stick is a level-1 item, so the 64K the network needs is reachable before level 4. Faster network tiers (1 Gbit card and router, 10G, 40G) and the faster plans are spread over levels 6 to 18.
- **Price check to level 4 (owner decision 1).** The sums a player needs by level 4:
  - network minimum (strict): board 1 $150 + `os1` $150 + two `ram1` $200 + `hdd0` $40 + `router1` $60 + `isp1` $150 = **$750**;
  - typical kit: the minimum plus `cpu1` $200, `psu1` $60, `vsink0` $30 = **$1,040**;
  - everything in the level 1 to 4 rows: the typical kit plus `cooler1` $50, `vsink1` $70, `ssd1` $150 = **$1,310**.
  - Income estimate (an estimate, plus or minus 40%; `docs/GAME.md` gives the starting machine about $0.6/s, the first $100 at a median of about 165 s): about **$0.6/s until the OS** (about $720 by 20 minutes), then about **$1.2/s** with the OS and a second stick (about $1,100 more by 35 minutes): about **$1,800 by level 4** (range $1,100 to $2,600).
  - Result: the strict network set is affordable at about 21 minutes, the typical kit at about 25 and the whole level 1 to 4 list at about 28 minutes, all before level 4 (35 minutes). At the low end of the range the strict set is done at about 27 minutes and the whole list at about 40, so `ssd1` and `vsink1` slip about five minutes past level 4; the network does not. The network items are cheap for their level: `isp1` is about 2 minutes of income at level 4.
  - Later bands (estimate): level 5 ($950 of board, PSU and RAM) is about 50% of a 20 minute band at $1.5/s; level 6 ($1,300) about 45% of a 25 minute band at $2/s; level 7 ($1,160) about 40% of a 20 minute band at $2.5/s. Re-measure with the Operator bot (test 9).
- **Level only gates what the player can buy.** A part already installed (a loaded old save, a sandbox, the start crate) keeps working whatever the level.
- **Hardware stays honest.** Example: at level 5 the player sees `nvme2` open but it still shows blocked "needs the M.2 slot (Mainstream board)" until board 2 is in the plan. The shop shows the **level lock first**, then the first hardware reason.
- Purchase refusal reasons: `needs Level 5 (Storefront)`; the game refuses it with the same text (like `PurchaseSnap.blocked` today).

## Job types per level and what they need

A **job class** groups templates and carries `needs`. The four existing classes are generated by `cli.log`, `cli.calc`, `cli.checksum` (the `cli` pick by seed) and `cli.scan` (scale 4, `payMul` 2, RAM-bound). The rest do not exist yet: each needs a generator template (docs/GEN.md "Adding a template") and, for the accelerators, the device and its ISA.

| Class (template) | State | Needs to run | First level | Notes |
|---|---|---|---|---|
| `cli` (log, calc, checksum) | built | nothing | 1 | the bulk early |
| `scan` | built | nothing (RAM speeds it) | 1 | ramp over 300 ticks as today |
| `db` | planned | an OS and a drive of tier SATA SSD or better | 3 | many block reads; slow on HDD is not allowed, so it needs `ssd1`+ |
| `web` | planned | a plan bought and a live link (any OS with the net stack) | 4 | small request, big response; upload-bound. No share until a plan is bought, none during the USB fallback (`NETWORK.md`) |
| `secure` | planned | a TPM / secure module | 9 | attestation and encrypted memory steps, extra cycles |
| `gpu` | planned | a GPU of at least the job's tier (scale 1 to 2 needs `gpu1`, scale 3 and up `gpu2`) | 10 | CPU prepares, GPU kernel, ARCHITECTURE "Accelerators" |
| `npu` | planned | an NPU | 12 | |
| `hpc` | planned | a multicore CPU (at least 2 cores) | 14 | the multi-core simulation template |

Needs are one of: `{kind: "os", min}`, `{kind: "storage", minTier}`, `{kind: "net"}`, `{kind: "tpm"}`, `{kind: "gpu", minTier}`, `{kind: "npu"}`, `{kind: "cores", min}`. A need is **met** when the matching device is installed and working (not burnt) at the moment the job would be picked to run (and for `net` while the link is up).

### The arrival mix (percent of arrivals)

Shares per level; a class's share ramps linearly from 0 to its value over **600 ticks** after the level that introduces it is reached (as `rampTicks` 300 does for scan today), so a new class starts as a trickle. Rows sum to 100.

| Lvl | cli | scan | db | web | secure | gpu | npu | hpc |
|---|---|---|---|---|---|---|---|---|
| 1 | 67 | 33 | | | | | | |
| 2 | 67 | 33 | | | | | | |
| 3 | 60 | 30 | 10 | | | | | |
| 4 | 45 | 25 | 15 | 15 | | | | |
| 5 | 40 | 25 | 20 | 15 | | | | |
| 6 | 37 | 23 | 22 | 18 | | | | |
| 7 | 33 | 22 | 24 | 21 | | | | |
| 8 | 28 | 22 | 25 | 25 | | | | |
| 9 | 25 | 18 | 20 | 22 | 15 | | | |
| 10 | 20 | 15 | 15 | 18 | 12 | 20 | | |
| 11 | 18 | 12 | 14 | 18 | 12 | 26 | | |
| 12 | 15 | 10 | 12 | 18 | 10 | 20 | 15 | |
| 13 | 12 | 8 | 12 | 18 | 10 | 20 | 20 | |
| 14 | 10 | 8 | 10 | 16 | 10 | 18 | 16 | 12 |
| 15 | 8 | 6 | 10 | 16 | 10 | 18 | 16 | 16 |
| 16 | 6 | 5 | 9 | 16 | 10 | 18 | 17 | 19 |
| 17 | 5 | 4 | 8 | 15 | 10 | 18 | 18 | 22 |
| 18 | 4 | 3 | 7 | 14 | 10 | 18 | 18 | 26 |

Level 1 and 2 match today's `ECONOMY.mix` (cli weight 1, scan weight 0.5 = one in three), so the existing onboarding tests keep their meaning.

**Shift with reputation (owner: the mix shifts with reputation and level).** After the level row, every class from `db` on (the "heavy" classes) is multiplied by `clamp(reputation, 0.5, 1.5)` and the shares are renormalised. A reputation of 1.5 or more sends 50% more heavy work than the table; 0.5 or less sends half as much. Good service attracts bigger clients; bad service leaves you with the easy ones.

### Jobs the machine cannot run: arrive, wait, expire

**Rule (owner):** every arrival is generated from the mix, whether or not the player owns the needed device. A job whose needs are unmet:

1. **arrives and sits** in the tray (or the network offer list), occupying a slot of the queue cap (`queueCap` 10);
2. is **shown** with its need: the label carries a chip such as `#72 gpu  NEEDS GPU` (see UI);
3. **expires at its deadline** (`arrival + deadlineTicks x patienceMul`): the client takes it back. That feeds `giveUpTurnaround x patienceMul` into the turnaround average, exactly like a tray-overflow drop today, counts in a new `expired` counter, pays nothing and gives **no client-base points**;
4. is **excluded from the "age of the oldest waiting key"** term of reputation, so the player is punished once (at expiry), not twice;
5. if the player buys the device in time, the job becomes runnable at once and is served normally (a good reason to buy before it expires).

An unrunnable job can also be **declined** by the player at once, for a smaller penalty than an expiry (see "Declining" below).

### Declining (owner decision 2)

The player may **decline** any job that is still waiting: an unrunnable job, or any other waiting job (a tray key not yet plugged, an ingested job not yet running, a network offer not yet downloading). A running job, a plugged or held key, a result waiting for collection, a download and an upload cannot be declined; the refusal names the reason.

- **Penalty (proposed number):** the decline feeds `targetTurnaround x patienceMul(level)` into the turnaround average, once, the way an expiry feeds `giveUpTurnaround x patienceMul`. That is exactly **one third** of an expiry's feed at every level (60 x mul against 180 x mul). It is not an expiry: the job leaves at once, `expired` does not count it, it pays nothing and gives no client-base points, and the slot frees immediately.
- Worked, level 10 (patienceMul 0.90, target 54): average 50, reputation 54 / 50 = 1.08. A decline feeds 54: average 0.3 x 54 + 0.7 x 50 = 51.2, reputation **1.05**. An expiry at the same moment drops it to 0.65 (the worked example above). Recovery is one normal job.
- Worked, level 4 (patienceMul 2.4, target 144), the case where it hurts most: a fast machine with average 60 has reputation 2.4 (not clamped). A decline feeds 144: average 85, reputation **1.7**. Five normal jobs of about 60 s bring it back to about 2.3. This is the honest cost of declining a waiting job for a fast machine.
- **Control:** a **Decline** button on each waiting tile (the key tile in the tray, the queue row of a spooled job, a network offer), shown on every unrunnable job with its needs chip and dimmer on a runnable waiting one. The first click arms `Decline -rep?` for 3 seconds; the second click declines. Tooltip: `Client leaves. Small reputation cost, no payout.` A running, held or downloading job shows no button.
- **Protocol:** `declineKey { id }` for a USB key (tray, or ingested and not yet running) and `declineJob { id }` for a network offer or spooled network job; the same shape as `ejectKey`. Store actions `declineKey(id)` and `declineJob(id)`. Refusals: `running`, `plugged`, `result waiting`, `downloading`, `uploading`.
- **Sim rule:** `Game.declineKey` / `declineJob` remove the job from the tray, the queue or the offer list at once; feed the average as above; add 1 to the lifetime counter `declined` (snapshot `declined`, save optional); pay nothing. A declined job never comes back, and the arrival that would have filled its slot is generated as usual.
- **Tutorial hint** (once, flag `declineHintSeen`, optional and additive): the first time an unrunnable job is on screen, `This client needs a GPU. Buy one before it expires, or decline it: a small reputation cost, and the slot is free now.` (The text names the missing device.)
- **Sandbox:** declining is free. The job leaves and `declined` counts, but the sandbox feeds no turnaround (no reputation cost). Same refusal rules.
- **Snapshot:** `KeySnap.declinable: boolean` and the `declined` counter; `OfferSnap` (network) carries the same flag.

Worked example. Level 10 (the first level with `gpu` jobs): patienceMul 0.90, so target 54 s, deadline 162 ticks, give-up turnaround 162. The turnaround average is 50, so reputation = 54 / 50 = 1.08 (`reputation()` in economy.ts). At tick 1000 a `gpu` job arrives and the player has no GPU.

| Event | avgTurnaround (EMA 0.3) | reputation = 54 / avg |
|---|---|---|
| before | 50 | 1.08 |
| tick 1162: the gpu job expires, feeds 162 | 0.3 x 162 + 0.7 x 50 = 83.6 | 0.65 |
| next normal job delivered after 40 s | 0.3 x 40 + 0.7 x 83.6 = 70.5 | 0.77 |
| second | 61.4 | 0.88 |
| third | 55.0 | 0.98 |
| fourth | 50.5 | 1.07 |

One expiry costs about four normal jobs of recovery and about 40% of demand while it lasts; those jobs also earn only about 0.5 to 0.8 points each instead of about 1.1, so a repeatedly unserved type visibly slows the level climb. With the 20% share and the 600-tick ramp, the player who buys the GPU within the level keeps losing only a few jobs. A player who never buys it loses about a fifth of all arrivals and sits near reputation 0.8: the pressure is real but not fatal.

## Sandbox (owner: everything unlocked, levels irrelevant)

- `sandbox: true` games ignore the level for **unlocks**: every item of every kind and tier is offered (the existing `sandboxOffers` extends to NIC, router, ISP and the planned kinds). No locked tiles, no milestone screen, no celebration, no client base accumulation (`clientBase` stays 0 and is hidden).
- The level is not used for the game rules **except through a pinned rules level**: the sandbox pins `rulesLevel` (patience, payout, demand and the arrival mix) at a default of **8**, changeable by a new sandbox tool `setLevel(n)` (1 to 18), so a sandbox player can try the harsh late game or the forgiving early one without grinding. Open question 5.
- Jobs the machine cannot run still arrive and expire in the sandbox (the physics stays, like the rest of `docs/SANDBOX.md`); `spawnKey` accepts the new templates.
- Items above the player's level are never locked in a sandbox; installed parts are never affected by the level in any mode.
- Declining is free in the sandbox (no turnaround feed, so no reputation cost); the job leaves and `declined` counts. See "Declining".

## POST time as a function of the machine

The fixed `coldBootTicks` 30 becomes a function so a bigger machine takes longer to start (more RAM to count, drives to spin up, cards to initialise), which also makes an upgrade a small trade-off at power-on and rewards the OS (one boot) more.

```
coldBoot(machine) = min(90, 22
                        + min(40, 0.25 * totalRamKiB)
                        + 2 * ramSticks
                        + sum over installed devices of initTicks(device))

initTicks:  cpu 1, display 1, hdd 4 (spin-up), sata ssd 2, nvme 1,
            nic card 2, tpm 1, gpu 3, npu 2, vsink fan 0, others 0
```

- **The Starter machine is exactly 30**: 22 + 0.25 x 16 (ram0 16 KiB) = 4 + 2 x 1 stick + cpu 1 + display 1 = **30** (psu, cooler, board add nothing). Tests that expect 30 ticks keep passing without changes.
- Examples: cpu2, one `ram2` (64K), NVMe and the monitor: 22 + 16 + 2 + 1 + 1 + 1 = 43. The same with an HDD instead of the NVMe: 46. A full Enthusiast build (4 sticks of 64K = 256K, GPU, NIC card, TPM, NVMe, cpu, display): 22 + 40 (capped) + 8 + 1 + 1 + 1 + 3 + 2 + 1 = 79. The cap is 90.
- **API:** `EconomyConfig.coldBoot = {base: 22, perKiB: 0.25, kiBCap: 40, perStick: 2, max: 90, init: {...}}`. The existing `coldBootTicks` becomes an optional **override**: when defined it replaces the function (tests set `coldBootTicks: 0`). `Snapshot.postTicks` (or `coldBootTicks`) shows the computed value for the UI ("POST about 43 s").
- A crash reboot pays the same function (it is a cold reboot). Under an OS the machine boots once, so the cost is paid once per power-on, not per job.

## Data shapes the sim needs

New file `src/sim/game/levels.ts` (pure data plus helpers), and one optional block in the save.

```ts
export type Need =
  | { kind: "os"; min: number } | { kind: "storage"; minTier: number } | { kind: "net" }
  | { kind: "tpm" } | { kind: "gpu"; minTier: number } | { kind: "npu" } | { kind: "cores"; min: number };

export interface JobClassDef {
  id: "cli" | "scan" | "db" | "web" | "secure" | "gpu" | "npu" | "hpc";
  templates: string[];              // generator templates ("cli" picks log/calc/checksum by seed)
  scale?: number; payMul?: number;
  needs: Need[];
  firstLevel: number;               // the share ramps from here
  netMB?: { down: number; up: number };   // NETWORK.md job sizes
}

export interface LevelDef {
  level: number; name: string;
  threshold: number;                // client base needed
  patienceMul: number; payMul: number; demandMul: number;
  mix: Partial<Record<JobClassDef["id"], number>>;   // percent; rows sum to 100
  unlocks: string[];                // offer ids: spec ids, "board3", "os2", "isp1"...
}

export const LEVELS: readonly LevelDef[];                 // 18 rows
export const JOB_CLASSES: readonly JobClassDef[];
export function levelFor(clientBase: number): number;     // monotonic
export function unlockLevelOf(offerId: string): number;   // 1 for the start crate, else the row that lists it
export function pointsFor(reputation: number): number;    // clamp(rep, 0.5, 2)
export function jobMix(level: number, reputation: number, sinceLevelTicks: Record<number, number>): [JobClassDef, number][];
export function needsMet(needs: Need[], machine): { ok: boolean; missing: string[] };
export function coldBootTicks(board, devices, cfg): number;
```

- `EconomyConfig.patience` (the schedule) and `patienceMul()` are **replaced** by `patienceMul(level)` reading `LEVELS`; keep the function name so call sites change little. `Snapshot.patience.sinceFirstBoot` stays in the snapshot for old consumers (always the real value) but no longer drives anything; `firstBootTick` stays in the save (it still marks when clients start arriving).
- `Game` gets `clientBase: number`, `level` (derived, memoised) and `levelTicks: Record<number, number>` (base tick at which each level was first reached; it drives the class ramp and the "just levelled up" flag). Hooks: after every delivery `clientBase += pointsFor(reputation)`, then `if (levelFor(clientBase) > this.level) levelUp()`. Purchases check `unlockLevelOf(id) <= level` unless sandbox. Arrivals use `jobMix`.
- `KeySnap` gets `needs: string[]` (e.g. `["gpu"]`), `runnable: boolean`, `missing: string[]`, `expiresTick` and `declinable`. `Snapshot.expired` and `Snapshot.declined` counters, `Snapshot.level` (below), `PurchaseSnap.locked?: { level, name }`, `PurchaseSnap.blocked` unchanged (hardware).
- Snapshot block:

```ts
level: {
  level: number; name: string; clientBase: number;
  floor: number; next: number | null;          // thresholds of this level and the next (null at 18)
  progress: number;                             // 0..1 within the level
  patienceMul: number; payMul: number; demandMul: number;
  leveledUpAt: number | null;                   // base tick of the latest level-up, for the celebration
  upcoming: { level: number; name: string; unlocks: { id: string; name: string; kind: string }[] }[];  // every level, for the milestone screen
}
```

- **Save (additive, no version bump for this phase):** optional `clientBase: number`, `levelTicks: Record<string, number>` and `declined: number` (a missing `declined` loads as 0). A save without them (every existing v4 save) is migrated on load by `clientBase = completed * 1.1` (the average point per job early) and `levelTicks` = the load tick for the derived level; parts already installed are never removed or hidden, whatever the level. `parseSave` validates `clientBase` as a finite non-negative number. The network phase bumps the save to v5 ([`NETWORK.md`](NETWORK.md)); this block rides along.
- `Operator` bots: take an optional `level` so tests can start at any level (`new Game({startLevel})` for tests and sandbox; sets `clientBase = threshold(level)`).

## UI the level system needs

- **HUD level bar:** next to money. Shows `Lv 5 Storefront` and a thin progress bar (`snapshot.level.progress`); hover shows `70 / 110 client base`, the current patience (`clients wait 120 s`), pay bonus (`payouts x1.52`) and the next unlock names. At level 18 shows `Lv 18 +` with the raw score.
- **Locked tiles:** in the picker, a locked offer is a greyed illustrated tile (the same art as an unlocked one, desaturated 70%, a small padlock and the text `Level 4`) in its normal shelf position. Hover: `Unlocks at Level 4, Small Office (client base 38)` plus the real hardware reasons that will apply. Not clickable (a click opens the milestone screen at that level). Items you can reach this level but not afford show the price in red as today; items at the NEXT level carry a subtle outline so the player sees what is coming.
- **Milestone screen** (a panel from the HUD level bar): a vertical list of all 18 levels, Skylines style. Each row: level number, name, threshold, patience and pay line, the unlock thumbnails (item art with names), the job types that start arriving. Reached levels are normal, the current one is highlighted with the progress bar, the future ones are dimmed but readable. Scrolls to the current level on open.
- **Level-up celebration (short):** about 3 seconds, non-blocking: the HUD bar fills and flashes, a banner `LEVEL 5: STOREFRONT` with the unlocked item thumbnails slides in at the top, a soft burst on the board, then it parks as a small `NEW` badge on the shop button and the unlocked tiles pulse until first seen. `snapshot.level.leveledUpAt` drives it (the UI shows it once per tick value; `seenLevel` is a per-viewer localStorage value so a reload does not replay it). No audio (POC).
- **Queue and key labels:** a job that needs a device the player lacks shows a chip (`NEEDS GPU`) on the key tile and the tray/queue row; hover explains `Cannot run: no GPU. Buy one at Level 10. Expires in 120 s: -reputation`; its deadline bar is drawn red. The OS queue and (later) network offer list use the same chip. A hint toast on the first expiry. The decline control (see "Declining") sits on each waiting tile: a click arms `Decline -rep?` for 3 s, a second click declines.
- **Shop:** items are sorted unlocked first within their shelf, then locked by level; the picker's existing "blocked" line shows the level first.
- **Tutorial:** unchanged until the network lesson; add a one-line step after `firstKeyEjected`: "Open the level bar: serve clients to unlock more" (flag `levelBarSeen`, optional and additive). The decline hint (flag `declineHintSeen`) is the one-time text under "Declining".

## Tests the sim needs

1. `levels.test.ts`: `LEVELS` has 18 rows, thresholds strictly increasing and starting at 0, every row's mix sums to 100, patience non-increasing, payMul and demandMul non-decreasing; every spec id in `DEVICE_SPECS`, every board tier and every OS id appears in exactly one `unlocks` list or in the start crate (so nothing is forgotten when a spec is added).
2. Score: `pointsFor` clamps at 0.5 and 2; `clientBase` increases by exactly that at each delivery and not at an expiry, drop or abort; the level never decreases over a random play with crashes, burns and reputation at the floor (property test over seeds).
3. Gating: `purchase` refuses a locked item with the level reason first, then hardware reasons; accepts at the exact threshold; sandbox ignores it; an installed part from a save above the player's level keeps working; `PurchaseSnap.locked` lists every locked item with the right level.
4. Patience and payout by level: `patienceMul(level)` drives the key deadline, the reputation target and the give-up turnaround at arrival; payout equals the old formula times `payMul`; the old tick-schedule tests (`patience.test.ts`) are rewritten against levels (the bot at level 1, 5, 9 with and without an OS).
5. Mix: counts over many seeds match the row within a tolerance; a class ramps from 0 over 600 ticks after its level; high reputation raises heavy-class share, low lowers it; levels 1 and 2 keep the old one-in-three scan mix (existing onboarding tests stay green).
6. Expiry: an unrunnable job arrives, sits, shows `missing`, expires at exactly `arrival + deadline`, feeds `giveUpTurnaround x mul`, increments `expired`, gives no points, and is excluded from the oldest-age term; buying the device before the deadline makes it runnable; the worked example above is a test with its numbers.
7. Cold boot: `coldBootTicks` function equals 30 for the Starter machine and the examples above for the other builds; the override wins; the cap holds.
8. Save: round trip of `clientBase` and `levelTicks`; a v4 save without them loads, derives a level from `completed`, and does not hide installed parts; determinism with the same seed and level start.
9. Bot pacing: with the `Operator` at 1x, the time to each of levels 2, 3 and 4 is within a wide band of the table (the table is re-measured with the bots and the doc is updated).
10. Declining: `declineKey` / `declineJob` remove a waiting job at once, feed exactly `targetTurnaround x mul` to the average (the level 10 and level 4 worked numbers above are tests), pay nothing, add no points, count in `declined` and not in `expired`; refused for running, plugged, result-waiting, downloading and uploading jobs with the reason; free of any feed in the sandbox; a declined slot is refilled by the next arrival; the counter round-trips through save.

## Decided (2026-10-24)

Owner decisions are at the top. Every other proposal is accepted as written: **decided: default accepted**.

1. Level names (Garage Bench ... Metropolis): decided: default accepted (working titles, kept).
2. Score per job: decided: default accepted (pure reputation weight, no class weight).
3. Unlock spacing: decided by owner decision 1 (the network at level 4, Mainstream at 5, cpu2 at 6); `cpu1` and `ram1` on sale from level 1, default accepted.
4. Late jobs: decided: default accepted (full points).
5. Sandbox rules level: decided: default accepted (pinned at 8, with a `setLevel` tool).
6. Declining: decided by owner decision 2 (allowed, one third of an expiry, see "Declining").
7. Expired job strength: decided: default accepted (about four normal jobs of recovery, harsher than a tray overflow).
8. Job scale with level: decided: default accepted (`scale` stays as generated; levels change the mix, patience, pay and demand).
9. Time budget: decided: default accepted (about 5 hours to level 18 at 1x, to be re-measured by the bots).
10. Legacy saves: decided: default accepted (`clientBase = completed x 1.1`, celebration suppressed).
11. Planned item names and ids: decided: default accepted (ids kept as listed; the engines and GPU work may rename them).
12. TPM: decided: default accepted (a small `tpm` header on Mainstream and up, not a PCIe card, so PCIe slots stay free for NICs and GPUs).

## Still undecided

- Prices and final names of the planned items (`cpu3` to `cpu5`, `gpu1` to `gpu3`, `npu1` and `npu2`, `tpm1` and `tpm2`, `psu3` and `psu4`, `fan1`, `cooler3`, `board4`, `nvme3`, `ram3`): orders of magnitude only until the engines and GPU work set them.
- Level 18 is the cap. Extending the ladder past it is not designed.
- Every time and income estimate here (the table's times, the price check) is a placeholder until the Operator bot measures it.
