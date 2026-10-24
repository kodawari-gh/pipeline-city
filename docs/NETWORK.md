# Network phase: NIC, router, cable, ISP and the network work source

Status: **sim built** (see "Built" below; the renderer and UI are not built). It was built after the level system ([`PROGRESSION.md`](PROGRESSION.md)); the unlock levels below are the ones of that document. All numbers are placeholders. Owner decisions are marked **(owner)**. Background: [`TECHTREE.md`](TECHTREE.md) (notes "Network phase design notes"), [`OS.md`](OS.md) (the kernel and the key ingest this replaces), [`ASSEMBLY.md`](ASSEMBLY.md) (cables, power, `WorkSource` in `src/sim/game/work.ts`), [`BOARD.md`](BOARD.md) / [`VRM.md`](VRM.md) (`BoardFeatures.ethernetMbps`: 0 on Starter, 100 on Basic and Mainstream, 1000 on Enthusiast).

## Decisions (2026-10-24)

Owner decisions. They override the drafts below where they conflict.

1. **The network unlocks at level 4**, right after the OS (level 3), not level 8. The onboard jack of the Basic board (level 2) goes live with `router1` and `isp1` at level 4. The network needs 64K of RAM, which is two `ram1` on the Basic board ($200, level 1). The faster tiers are spread over levels 6 to 18 (see the tables). The price sum to level 4 is in [`PROGRESSION.md`](PROGRESSION.md) "Price check to level 4".
2. **Declining** a waiting job is allowed, at a small reputation cost (one third of an expiry). It applies to network offers and spooled jobs too. See [`PROGRESSION.md`](PROGRESSION.md) "Declining".
3. **USB fallback:** after 300 ticks of a dead link, USB keys come back at one third of the normal rate until the link is up again. See "USB fallback".
4. **Power loss:** everything in RAM is lost; jobs written to the drive survive. The OS spools each job to its drive when the transfer completes; partial downloads restart from zero at the next boot; a running job restarts from its beginning. See "Power loss" and "Spool". This applies to USB keys as well (a change to OS v1, `OS.md`, to be made when this is built).
5. Every other open question is decided as proposed (see "Decided" at the end).

## Built (sim, 2026-10-24): what was implemented, deviations, numbers

Code: `src/sim/net/` (`specs.ts`: routers, ISP plans, job sizes, disk sink rates, `bandwidth()` and the `NET` constants; `source.ts`: `NetworkSource`, the offer list behind the `WorkSource` seam), NIC cards in `src/sim/board/specs.ts` (kind `nic`), the link and feed in `src/sim/game/game.ts` ("internals: the network"), tests in `src/sim/game/net.test.ts`, rig `netRig` in `testkit.ts`.

**Parts.** `nic1..3` are PCIe device specs (1000 / 10000 / 40000 Mbit, power and thermal as the table; a hot card runs at half speed; load watts follow traffic). Routers `router1..4` and ISP plans `isp1..5` have the table's numbers. A **router is bought into the inventory and installed into the single external slot `router`** (a deviation from "purchase places it"; the tutorial step "place the router" needs it): `install(invId, "router")`, allowed **while the PC is on**; a better router replaces the old one (the old returns to the inventory); `uninstall("router")` takes it out at any time. `Snapshot.slots` lists `{ id: "router", type: "router", deviceId: <router spec id> | null }`. An **ISP plan applies at purchase** (no inventory item, `purchase` returns `invId: ""`), a higher plan replaces it, `progress.ispBought`. Unlock levels come from `LEVELS` (router1 and isp1 at 4). Sandbox: every tier free (the `nic` kind joined the sandbox device list).
**Memory.** The network wants 64K: a second stick of the best tier you run is now offered while a DIMM slot is free (`ram1` x2 = 64K on the Basic board, $200), as the design always assumed.

**Cable.** `lan` is a fourth entry of `Snapshot.cables` and of `Cables` (`allCables` keeps it unplugged). `connectCable("lan", port?)`: `port` is `"board"` (default when the board has a jack) or a NIC device id; needs a router; allowed while powered; `disconnectCable("lan")` too; removing the router or the card unplugs it. `missingCables()` and the bot never plug it.

**Link states** (`snapshot.net.state`): `no-device`, `no-cable`, `no-os` (reason: no OS, RAM under 64K, no spool slot), `down` (machine off, tripped, crashed, OS still starting, burnt board or card), `link-up`, `saturated` (all client slots busy or the spool full). `net.reason` is the readable text. `progress.linkUp` and the sticky `networkLinked` (saved) are set the first tick the link is usable. `net.usbFallback` is `off | retired | waiting | fallback` with `deadTicks`, `startsIn`, `keyRateMul`.

**Bandwidth.** As designed: `down = min(port, router, isp down, disk)`, `up = min(port, router, isp up)`, `clients = min(router, plan)`, `binding` in `port | router | isp | disk`. Disk sink: `hdd0` 80, `ssd1` 400, `nvme2` 2000 (`DISK_NET_MBPS`). A game MB per tick is `Mbit / 8` at 1x; transfers split their direction's bandwidth equally. A 24 MB job at 50 Mbit takes 4 ticks.
**Job sizes** (down / up MB): log and calc 24 / 2, checksum 30 / 2, scan 75 x scale / 2.5 x scale (300 / 10 at scale 4), db 400 / 80, web 4 / 25, secure 100 / 10, gpu 2000 / 600, npu 1200 / 40, hpc 3000 / 200.

**The feed (how it works).** No new kernel code. The game plays the NIC: when the OS is up and the USB port is free it plugs a **virtual key** carrying the job into the PCH (enumeration and flash waits are zero for it), so the **real kernel ingests it** (CPU and drive work, the copy cost), and later plugs it again to read the result out. The program runs on the OS as ever, one at a time. A real key parked in the port keeps the feed waiting (the tutorial bot ejects it; a hint is a UI task). Tick order: arrivals, expiry, machine, `netTick` (link, transfers, feed), thermal.
**Flow.** Arrival becomes an offer (cap `queueCap`, overflow penalty as for the tray); admission starts a download when a client slot and a spool slot are free (the reservation counts spooled jobs, held USB keys, the key in the port, finished downloads and downloads); download, then rx (RAM), then ingest (the job is now **spooled**), run, result read out, upload, **delivery** (payout, reputation and client base only now; the spool slot frees now). `Key.pluggedAt` is the download start, `doneAt` the result time.

**Arrival channels and USB.** Once `networkLinked`, new work goes to the offers and the tray gets nothing (leftover keys are served as always). After `usbFallbackTicks` = **300** dead ticks (any state but link-up or saturated, power off included) arrivals go back to the tray, thinned to **1/3** of the rate (the same draw is thinned, no extra PRNG use), the web class has no share and no offers come; the link returning resets `deadTicks` at once. Web has no share without a plan; once there is a plan its jobs always go to the offers (they are unrunnable, and expire, until the link has been up). Numbers: `ECONOMY.usbFallbackTicks`, `usbFallbackMul`, `NET.minRamBytes` (64K).

**Spool and power loss.** Spooled jobs are in `Game.spool` (seeds, in ingest order) and, while the kernel is up, in its table. On power-off, reboot or crash (`loseRam`): downloads and finished-unspooled downloads return to the offers with `attempts + 1`, uploads are dropped (the spooled job runs again), the virtual key is dropped, the kernel table is gone with RAM; after the next boot the feed **re-ingests spooled jobs and held USB keys in order**, so the queue is rebuilt. Held USB keys now stay held through a power-off (OS.md changed). `os.spool = { slotBytes, slots, used, freeBytes, full }`; `OsJobSnap.persisted` is always true. A full spool leaves offers waiting (the link shows `saturated`, reason "the spool is full"). Removing the cable drops the transfers (RAM) and keeps the spool. Uninstalling the OS returns held keys to the tray and spooled jobs to the offers.

**Declining.** `declineKey` / `declineJob` accept offers and spooled jobs that have not started (not downloading, running, result or uploading).

**Save.** Additive (still version 4, no bump): optional `net { ispTier, routerTier, lan, networkLinked, deadTicks, offers[], spool[] }` (job seeds), `cables.lan` and the five new progress flags default to false when missing, router items in `inventory` are valid ids. Transfers are never saved; downloads in flight come back as offers; the spool is saved as seeds and re-ingested after the first boot. The sandbox flag is unaffected.

**Deviations and decisions made while building.** (1) The router goes into an inventory slot instead of being placed on purchase. (2) The save keeps spooled jobs (the design said not): it is the cheaper way to keep "jobs survive power loss" across a reload. (3) Level 4 threshold lowered **38 to 14** so the tutorial bot reaches it in under ten minutes after the OS lesson (precedent: level 3 at 12); later thresholds are untouched (see PROGRESSION.md "Built"). (4) The kernel is unchanged. (5) A NIC thermal throttle halves the rate; the unstable and damage states use the generic device model (a burnt card takes the link down). (6) No separate "Next lesson" offer card for the automation lesson: its steps follow the OS lesson in the same tutorial.

**Measured (bot, `tutorial.bot.test.ts`, seed 7: Starter machine, cpu1, HDD, OS, 32K RAM, then Basic board and a second ram1):** each lesson step stays under about 11 minutes; the first network job lands about 10 minutes after the link is up (client arrivals are slow at the floor reputation 0.4). Throughput after the link on that weak machine is the same as before (CPU-bound, one job per 70 to 100 s): a faster line only matters once the machine is faster, as the design intends.

**What the UI and renderer need** (not built): the lists "Visuals the renderer needs" and "UI the picker needs" below, plus these facts: read `Snapshot.net` (state, reason, port, router, isp, bandwidth, transfers with `percent` and `etaTicks`, offers and spooled as `KeySnap` with stages `offer | downloading | spooled | uploading`, `usbRetired`, `usbFallback`, counters); `Snapshot.slots` has the `router` slot; inventory and purchase kinds `router`, `isp`, `nic`; `Progress` has `ispBought routerInstalled lanConnected linkUp firstNetJob`; the store has `connectCable(cable, port?)`.

## The idea in one paragraph

Without a network the player is the delivery van: plug a key, wait for the enumerate, unplug, plug again to flash the result. With a network the clients send their jobs over the wire: the OS downloads each job in full in the background, runs it (still one program at a time), and uploads the result; the player does nothing per job. **USB keys stop arriving** once the link is first up (owner). What the player buys now is bandwidth: the slowest of the port, the router and the ISP plan limits how fast jobs come and go, and the router and plan limit how many clients can be served at once. One-off purchases only, no recurring bill (owner).

## Parts

Speeds are in Mbit/s. Sizes of jobs are in "game MB" (fiction units, see "Job sizes"). Levels refer to `PROGRESSION.md`.

### Ethernet port (on the board and on a card)

- **Onboard port (not a part):** present on board tiers 1 and up as a `lan` jack on the board's I/O panel: Basic 100, Mainstream 100, Enthusiast 1000 (`BoardFeatures.ethernetMbps`; Starter has none). It is free, draws nothing extra (the board's idle power already counts it), cannot be bought or burnt separately, and is usable once the network unlocks (level 4). It does not use a PCIe slot.
- **PCIe NIC cards** (new device kind `nic`, slot `pcie`, one card per slot; a NIC card has its own jack and its speed replaces the onboard one for the cable plugged into it):

| Id | Name | Speed | Price | Idle / load W | Thermal (throttle / unstable / damage C) | Unlock |
|---|---|---|---|---|---|---|
| `nic1` | GbE card | 1000 | $120 | 1.5 / 3.5 | 75 / 90 / 105 | level 7 |
| `nic2` | 10GbE card | 10000 | $500 | 5 / 11 | 65 / 80 / 95 | level 11 |
| `nic3` | 40GbE card | 40000 | $1800 | 9 / 22 | 60 / 75 / 90 | level 17 |

  The card's load watts follow its traffic (utilisation of the link), so a busy 40G card is a real power and heat source and counts against the PSU rated load at install time like any part (`heatFactor` 1). Above its throttle temperature the card runs at half speed, above unstable it drops frames (transfers stall, a retry timer), above damage it burns (like any device; replace it). Fast cards want airflow, so cooler and case-fan choices matter again. A card needs a free `pcie` slot (Basic has 1, Mainstream 2, Enthusiast 4), so the network competes for slots with the future GPU, NPU and TPM: a deliberate choice.
- On Basic and Mainstream the onboard jack is 100 Mbit, so `nic1` (level 7) is the cheap step from 100 to 1000 without the $700 Enthusiast board (level 9). Enthusiast already has 1 Gbit, and a card is for 10G and 40G.

### The cable (a drag)

An **ethernet cable** is a new cable `lan` in `Snapshot.cables` next to `atx`, `cpu` and `video`. The player drags it from a port (the board jack, or a NIC card jack) to the router. It comes free with the first router purchase (a stock cable sits in the inventory as a cable item, not a part). `connectCable("lan", port)` where `port` is `"board"` or the NIC `deviceId`; the cable stays plugged until `disconnectCable("lan")`. If both an onboard port and a card exist, whichever the cable is plugged into is the **uplink** and its speed counts. **The cable can be plugged and unplugged while the machine is on** (an exception to the "cables only while off" rule: it is an external cable on a hot-pluggable port; decided: default accepted).

### The router (a prop next to the monitor)

A separate external box placed beside the monitor, powered from the wall (no PSU budget, no heat, cannot burn). It is bought, not installed: `purchase("router1")` places it (replacing a lower one; the old one disappears). It is always on, so the link drops when the PC is off only because the PC is off.

| Id | Name | Port speed | Simultaneous clients | Price | Unlock |
|---|---|---|---|---|---|
| `router1` | Home router | 100 | 2 | $60 | level 4 |
| `router2` | Gigabit router | 1000 | 4 | $200 | level 7 |
| `router3` | 10G switch-router | 10000 | 8 | $700 | level 11 |
| `router4` | Core router | 40000 | 16 | $2500 | level 17 |

### The ISP plan (a one-off purchase; the wall jack)

Bought once, not an installed part and not a bill (owner): `purchase("isp1")` sets the plan; a higher plan replaces it (no refund, no downgrade offer). The router is pre-wired to the wall jack, so there is no second cable. The plan caps the download and upload bandwidth and how many clients can be served at once.

| Id | Name | Download / upload (Mbit/s) | Clients at once | Price | Unlock |
|---|---|---|---|---|---|
| `isp1` | Basic DSL | 50 / 10 | 2 | $150 | level 4 |
| `isp2` | Cable | 200 / 50 | 4 | $500 | level 6 |
| `isp3` | Fibre | 1000 / 300 | 8 | $1500 | level 9 |
| `isp4` | Business fibre | 5000 / 1500 | 16 | $5000 | level 14 |
| `isp5` | Backbone | 20000 / 10000 | 32 | $15000 | level 18 |

### Effective bandwidth and clients

```
downMbps  = min(portMbps, routerMbps, ispDown, diskSinkMbps)
upMbps    = min(portMbps, routerMbps, ispUp)
clients   = min(routerClients, ispClients)
```

`portMbps` is the uplink (board jack or card, thermally throttled). **`diskSinkMbps`** is how fast the OS drive can take the spool writes: a new `netMbps` on the storage specs, `hdd0` 80, `ssd1` 400, `nvme2` 2000, so a slow disk is a real bottleneck on a fast line. The `binding` limiter is reported in the snapshot (`port`, `router`, `isp`, `disk`) so the UI can say what to upgrade. Active transfers split the bandwidth equally (downloads share `downMbps`, uploads share `upMbps`, each direction on its own). At 1x a game MB per tick is `Mbps / 8` per second.

### Power, heat and unlock summary

Only the NIC cards draw from the PSU and make heat (table above). The router and the ISP are wall side. Level unlocks: 4 (`router1`, `isp1`, onboard port usable), 6 (`isp2`), 7 (`nic1`, `router2`), 9 (`isp3`), 11 (`nic2`, `router3`), 14 (`isp4`), 17 (`nic3`, `router4`), 18 (`isp5`). Prices sit at about 2 to 5 minutes of income at their level (the estimate is in `PROGRESSION.md`).

## Requirements on the machine (behaviour)

The network is run by the OS: `os1` has the network stack as an optional part of its kernel (data, `netStack: true` plus `netRamBytes`). Minimum:

- an installed **OS of tier 1 or higher** (`os1`), booted;
- installed RAM of at least **64K** (a `ram2`, or 2 x `ram1` on a Basic or better board, the cheapest at $200 and level 1; `os1` alone needs 32K): the buffers for the NIC rx/tx windows live in RAM;
- the OS drive with at least one free spool slot (**4 KiB**, see "Spool") beyond the OS image, and a drive tier that gives a useful `diskSinkMbps`;
- an uplink port (board jack of tier 1+, or a NIC card) with the cable plugged into the router, a router placed, an ISP plan bought.

Missing any gives a link state with a readable reason (below) and never a refusal at purchase time (the purchases themselves only check level and money).

## Link states

`snapshot.net.state`:

| State | When | What the player sees |
|---|---|---|
| `no-device` | no ISP plan or no router yet | net panel hidden or shows "no service" |
| `no-cable` | router and plan present, no cable plugged | wall jack lit, router link LED off, hint "plug the cable into the board" |
| `no-os` | cable plugged, but no booted OS meeting the minimum (`reason` says which: OS missing, RAM below 64K, no space) | port LED amber |
| `link-up` | cable plugged, OS booted with the stack, plan present, port working | green link LED, traffic pulses |
| `saturated` | `link-up` and every client slot is in use or the offer list is waiting for a free slot or queue place | LED blinks, "bandwidth full" chip with the binding limiter |
| `down` | the machine lost power (power off, PSU trip, brownout), crashed, the board is dead, the uplink NIC is burnt, or the OS is not up (booting) | LED off; the router and the plan stay lit |

`down` and `no-os` differ in cause: `down` is transient (power); `no-os` is a setup problem. A powered machine that reboots goes `down` until the OS is back up (the OS boot takes about 20 to 75 s depending on drive and CPU, `OS.md`).

**USB keys stop (owner).** The first time the state is `link-up`, `progress.networkLinked` becomes true (sticky, saved) and the USB tray stops producing arrivals: all new work comes as network offers. Keys already in the tray, the port, or held by the OS can still be served exactly as today (the player may keep plugging them; payout on removal). A key is always finished by the key path (flash and removal), even with the link up. If the link stays down for `usbFallbackTicks` (300) after having been linked (`no-cable`, `no-os`, no plan, power off, any state but `link-up`), keys come back at one third of the normal rate until the link is up again, so a dead link never leaves the player with no work (see "USB fallback").

## USB fallback (owner decision 3)

Keys retire once the link has been up. The fallback covers a link that dies later:

- **Numbers:** `usbFallbackTicks` 300 (five minutes at 1x) and `usbFallbackMul` 1/3.
- **Counter:** once `networkLinked` is set, `deadTicks` counts the game ticks in which the state is not `link-up` or `saturated`. Power off counts too. A return to `link-up` sets it back to 0 at once.
- **Fallback:** at `deadTicks` 300 the USB key arrivals come back at one third of the normal arrival rate (table below). The fallback ends at once when the link is up again. Nothing else changes: keys use the tray, the cap of 10 and the normal deadlines, and the payout is on removal.
- **Keys already in the tray or held keep being served** in every state.
- Cutting the cable on purpose is a choice with a cost: after five minutes keys come at a third of the rate and no new offers come. Accepted.
- **Tray display** from `net.usbFallback.state`:
  - `off`: never linked, the tray as today.
  - `retired`: linked and up. The tray is dimmed, labelled `NO NEW STICKS`; leftover keys are shown and served.
  - `waiting`: linked and down for under 300 ticks. Label `NET DOWN`, countdown `sticks in M:SS` from `startsIn` (300 minus `deadTicks`).
  - `fallback`: linked and down for 300 ticks or more. Amber banner `NET DOWN: CLIENTS SEND STICKS (1/3 RATE)`; the net panel says `offers paused`.
- **Snapshot:** `net.usbFallback: { state: "off" | "retired" | "waiting" | "fallback"; deadTicks: number; startsIn: number | null; keyRateMul: number }`, where `keyRateMul` is 1 when off or retired (no change, the tray is handled by the state), 1/3 in fallback and 0 while waiting. `deadTicks` is saved (optional, `net.deadTicks`) so a save does not restart the wait.

## Jobs over the network

### Job sizes (placeholder, game MB)

Each template (and class, `PROGRESSION.md`) has a download size (program plus data) and an upload size (result). Times below are for one transfer alone at the stated bandwidth.

| Template / class | Down MB | Up MB | Down at 50 Mbit | Up at 10 Mbit | Down at 1000 Mbit |
|---|---|---|---|---|---|
| `cli.log`, `cli.calc` | 24 | 2 | 3.8 s | 1.6 s | 0.2 s |
| `cli.checksum` | 30 | 2 | 4.8 s | 1.6 s | 0.2 s |
| `cli.scan` (scale 4) | 300 | 10 | 48 s | 8 s | 2.4 s |
| `db` (planned) | 400 | 80 | 64 s | 64 s | 3.2 s |
| `web` (planned) | 4 | 25 | 0.6 s | 20 s | 0.03 s |
| `secure` (planned) | 100 | 10 | 16 s | 8 s | 0.8 s |
| `gpu` (planned) | 2000 | 600 | 320 s | 480 s | 16 s |
| `npu` (planned) | 1200 | 40 | 192 s | 32 s | 9.6 s |
| `hpc` (planned) | 3000 | 200 | 480 s | 160 s | 24 s |

`size` scales with the job's generator `scale` (linear). A web request is the only upload-heavy class, which makes the upload cap of the plan matter. A GPU or HPC job is hopeless on a 50 Mbit line (minutes of download), which is the pressure to buy `isp3` and above, and also a reason a level-10 player needs more than `isp2`.

### Arrival channels

Every arrival is drawn from the level's mix (`PROGRESSION.md`) and goes to one channel, decided by the network state:

| State | USB keys (tray) | Network offers | Web class |
|---|---|---|---|
| never linked (setup) | normal rate (non-web classes) | none | offers (wait, and expire, until the first link) |
| linked, link up (`link-up`, `saturated`) | none (retired) | normal rate | offers |
| linked, link down under 300 ticks | none | normal rate (they pile up to the cap: clients see a dead server) | offers |
| linked, link down 300 ticks or more (fallback) | one third of the normal rate | none (existing offers age and expire) | none |

The web class has no share until a plan is bought, and none in fallback (no client is on the wire). The other classes are renormalised over the share that is left.

### The flow of a job (one source, the OS does the work)

1. **Arrival.** With the link up (or down because of power), an arrival (probability `demandRate` per tick, the same economy and mix as keys, `PROGRESSION.md`) becomes an **offer** in the ISP-side offer list (cap `queueCap` 10, same overflow rule as the tray: a dropped offer feeds `giveUpTurnaround x patienceMul`). An offer whose needs are unmet stays and expires (the rule of `PROGRESSION.md`); the label shows what it needs.
2. **Admission.** Each tick, while fewer than `clients` downloads are active, an OS queue slot is free (`queueSlots` of the OS, further limited by free disk; the slot is **reserved at the start of the download**, so in-flight downloads count against the bound) and the offer's needs are met, the oldest runnable offer starts downloading. The OS queue is the bound: a full queue leaves offers waiting (and aging toward their deadline).
3. **Download.** `doneMB += (downMbps / 8) / activeDownloads` per tick for each active download; the time is size over bandwidth, so concurrent downloads slow each other.
4. **Ingest (spool).** When a download completes, the kernel writes the job to a spool slot on the drive (see "Spool") and queues it, exactly like a key (`OS.md`), without the USB enumerate wait (`usbEnumTicks` does not apply). The OS is one-program-at-a-time, so the write happens **between programs**: the NIC rx window holds one finished download until then, and only the spool write makes the job persistent. A long running job therefore delays ingest of keys and downloads alike, as today. The copy is real CPU work, so a slow CPU still slows the pipeline.
5. **Run.** The oldest queued job runs. One program at a time.
6. **Upload.** When the program ends, the kernel copies the result into the NIC tx window and starts the upload (no `usbFlashTicks`). Active uploads share `upMbps`.
7. **Delivery.** When the upload completes the client has the result: payout and reputation apply at that moment (the old removal time). Turnaround = arrival to upload end, so download, queue wait, run and upload all count. The score of `PROGRESSION.md` is credited.

No manual plug or unplug happens at any step. The kernel's USB paths stay for keys.

### What an OS step looks like to the kernel

New registers at `NET_BASE` in the memory map (a device on the bus, present when a NIC or the board port is cabled; the PCH forwards): `STATUS` (link up, rx ready, tx busy), `RX_LEN` / `RX_ID` and a read window for the finished download, `TX_LEN` / `TX_ID` and a write window for the result, `CTRL` (ack rx, start tx). The kernel adds a poll for `rx ready` beside its USB poll and a tx start after `kdone`. The transfer timing (the download and upload) is simulated in the game layer (`Game`/`net`) as plain counters, not as CPU instructions: only the copies are instructions. The boot header gains a `netStack` flag.

### Power loss (owner decision 4)

Everything in RAM is lost on power loss (power off, PSU trip, crash, burnt board); anything written to the drive survives. The OS writes each job to its spool when its transfer completes, so the rule is about where the bytes are:

| Item | Where it lives | On power loss |
|---|---|---|
| Spooled job: queued, running, or result waiting for upload | drive (spool slot) | **survives.** The queue is rebuilt from the spool headers at boot, in ingest order. A running job restarts from its beginning. A finished result that was only in RAM is lost, so the job runs again. Attempts unchanged (nothing was resent) |
| Finished download not yet written to the spool | RAM (rx window) | lost. The offer returns to the offer list with `attempts++` and its original arrival tick |
| Download in progress | RAM | lost. The offer returns the same way and restarts from zero at the next boot, once the link is up |
| Upload in progress | RAM (tx window) | the result is lost; the job is still spooled and runs again. Attempts unchanged |
| Offers waiting | client side | survive and keep aging; while the machine is down they expire at their deadline like unserved keys (this punishes long outages and rewards booting once and staying up) |
| Keys in the tray | client side | survive, as today |
| Keys ingested (queued, held, or result waiting) | drive | survive like spooled jobs. This changes OS v1 (`OS.md`): today the kernel queue is RAM and held keys return to the tray; with decision 4 they stay spooled |

- The link goes `down` on any of those losses. Removing the cable mid-transfer is the same as power off for the transfers (state `no-cable`); the spool is kept.
- On reboot the link comes back up when the OS is up (`down` to `link-up`); the offer list is served from the oldest, and the spooled jobs are served before new ones.
- **Paid once:** the payout applies at delivery (upload end, key removal). The spool slot is freed only then, so a restart can neither pay twice nor lose a credited job.
- **Save and load** (config-only, `SAVE.md`) do not store the spool: a loaded game starts its queue fresh, like the other in-flight requests. The survival rule is for power loss in play, not for save files.

### Spool (the disk side of decision 4)

- **Slot:** one 4 KiB spool slot per job (`SPOOL_BLOCKS_PER_JOB` 16 blocks of 256 bytes; `queueSlotsFor` in `src/sim/os/specs.ts`). The spool sits after the OS image on the OS drive (`spool start block` in the boot header).
- **Format:** the program and its data in the slot's blocks, then a **header block written last**: magic `SPL1`, job id, class, `sequence` (ingest order), arrival tick, attempts, deadline tick and program length. The header is the commit point: a slot whose header is not valid (power lost during the write) is free at boot.
- **Written** when a transfer completes (a download, or a key's copy from the key window), before the job is queued. **Freed** at delivery (upload end, key removal).
- **Capacity:** slots = `min(queueSlots of the OS, free bytes / 4 KiB, 8)`, as today. The download rate is capped by the drive (`diskSinkMbps`), so the write keeps up with the wire. A game MB is a time unit for transfers; the spool is measured in real bytes.
- **Disk full** (no free slot): nothing is refused at the door. A new offer or tray key waits, counts against the queue cap and expires at its deadline. A hint says the spool is full and that a bigger drive, or a bigger OS, holds more jobs.
- **Boot:** the kernel scans the slot headers and rebuilds the queue in `sequence` order (a valid header is a queued job). A job that was running is queued again from its beginning.
- **Snapshot:** `os.spool = { slotBytes: 4096, slots: number, used: number, freeBytes: number, full: boolean }`; each `os.queue[]` row gets `persisted: true` (queued, running and result rows are all spooled). `net.transfers[].persisted` is `false`: downloads and uploads are RAM.

### Interaction with the queue bound and the single program

- The OS still runs one program at a time (`programSlots` 1 for `os1`); the network only fills the queue and drains results, so a fast line with `os1` simply keeps `queueSlots` (4) full and the rest wait in the offer list. More bandwidth than the OS can consume is wasted; that is when the player wants `os2` / `os3` and a faster CPU, not more bandwidth. The UI shows the queue full chip as today.
- Reservation prevents over-commit: the bound is `queueSlots` counting jobs queued, running, awaiting upload, **and downloading**.

## Snapshot and protocol

Additive fields (all optional for old consumers):

```ts
net: null | {
  state: "no-device" | "no-cable" | "no-os" | "link-up" | "saturated" | "down";
  reason: string | null;                     // readable cause for no-os / down / saturated
  port: { kind: "board" | "nic" | null; deviceId: string | null; mbps: number };
  router: { id: string; name: string; mbps: number; clients: number } | null;
  isp: { id: string; name: string; downMbps: number; upMbps: number; clients: number } | null;
  bandwidth: { downMbps: number; upMbps: number; clients: number; binding: "port" | "router" | "isp" | "disk" | null };
  transfers: { jobId: number; label: string; dir: "down" | "up"; totalMB: number; doneMB: number; etaTicks: number }[];
  offers: OfferSnap[];                        // KeySnap-like: id, label, type, arrivalTick, deadlineTick, age, late, payoutEstimate, needs, runnable, missing
  usbRetired: boolean;                        // progress.networkLinked
  usbFallback: { state: "off" | "retired" | "waiting" | "fallback"; deadTicks: number; startsIn: number | null; keyRateMul: number };  // see "USB fallback"
};
cables: [... , { id: "lan", name: "Ethernet", connected: boolean, blocked?: string }]
// purchases[] / inventory[] kinds: "nic" | "router" | "isp" are added; PurchaseSnap.locked (PROGRESSION.md)
// progress: ispBought, routerPlaced, lanConnected, linkUp, firstNetJob (see tutorial)
// devices[]: the NIC card as a normal DeviceSnap (temp, power, burnt) plus `linkUtil` 0..1
```

`ToSim` additions: `connectCable { cable: "lan", port?: string }` (the `port` field is new; absent for the other cables) and `disconnectCable { cable: "lan" }`. **Buying the plan or the router is `purchase`** with `isp1` / `router1` ids (kinds `isp` / `router`, applied immediately, not to the inventory). The `install` of a NIC card is the normal `install` into a `pcie` slot. No new message type is needed for the network itself; the decline action for a waiting key or network job is `declineKey` / `declineJob` (`PROGRESSION.md` "Declining"). Sandbox: `sandboxOffers` also lists all `nic`, `router`, `isp` items; a tool `spawnOffer(template, scale)` is the sandbox's `spawnKey` for the network.

`WorkSource` (`src/sim/game/work.ts`): a `NetSource` implements `offer`, `waiting` (the pending offers not yet started), `take` (start a download) and `giveBack` (abort); `Game` picks the key tray or the network source by `progress.networkLinked`, so the arrival code stays unchanged. New folder `src/sim/net/` with `specs.ts` (NIC, router, ISP records and `netMbps` of drives), `link.ts` (state machine and bandwidth) and `source.ts`.

### Save

Additive and a **version bump to v5** (shared with the level block): `net?: { routerTier, ispTier, lan: null | "board" | <deviceId>, networkLinked: boolean, deadTicks: number }`, the `declined` counter and `clientBase` / `levelTicks` from `PROGRESSION.md`. The `devices` list may now hold kind `nic` and `cables` may list `lan`, which a v4 loader would reject, hence the bump; the migration from v4 only fills defaults (no router, no plan, no cable, `networkLinked` false). Offers and in-flight transfers are **not saved**: on load pending offers restart as new seeds like the other in-flight requests (`SAVE.md`), and no transfer survives. A save from a game that had already linked keeps `networkLinked` and `usbRetired` so the load does not bring keys back.

## Tutorial (the automation lesson)

A lesson after the OS lesson (offered like "Next lesson: the OS" via `offerNextLesson`), steps gated by progress flags, only shown at level 4 (the network level) or when the pieces are on sale:

1. "Clients are tired of sticks. Buy a plan." (`ispBought`: any `isp*` purchase).
2. "Place a router next to the screen." (`routerPlaced`).
3. "Drag the cable from the board jack to the router." (`lanConnected`; the machine may be on).
4. "The OS brings the link up." (`linkUp`; if no OS or RAM below 64K the step shows the exact missing piece.)
5. "Watch a job arrive on its own." (`firstNetJob`: a job delivered over the network).

Hints (first occurrence): link `down` after a power-off (and that the spooled jobs survive it), `saturated` with the binding limiter, NIC overheat, queue full, USB fallback started (`fallback`), spool full.

## Visuals the renderer needs

- **Router prop** by the monitor: a box with antenna stubs, ports and 4 to 5 status LEDs (power, WAN, LAN, activity). Four looks, one per tier (bigger, more ports, a rack look at `router4`). Wall-powered: no cable to the PSU.
- **The cable**: a draggable lead from the board jack (or the NIC jack) to the router, with a slack curve; a drop target highlight on valid jacks (`cables[].connected`, `Snapshot.slots`), the plug click animation, and a taut or removed state when unplugged.
- **Wall jack and ISP**: a wall plate with a jack and a lit dot once a plan exists, a thin line to the router, and a small plan label on hover.
- **Link lights**: the board jack LED (off, amber, green, blinking when saturated) and the router LEDs, read from `net.state`.
- **Traffic pulses**: dots travelling along the cable towards the machine for downloads and away for uploads, density by utilisation, colour by direction; a job packet (the key icon but "blue") appears at the board jack when a download completes and enters the drive during ingest.
- **NIC card art** in the PCIe slots for `visual` keys `nic-gbe`, `nic-10g`, `nic-40g` (a bigger heatsink and fan from 10G); activity LED from `devices[].linkUtil`; heat glow as other parts.
- **Board jack art** on every board tier with a port (and a blank cover on Starter); **no USB tray activity** once `usbRetired`: the tray area shows a "retired" dim state with any leftover keys. The fallback states from `net.usbFallback` are drawn on the tray: the `waiting` countdown and the amber `fallback` banner (see "USB fallback").
- Monitor lines: `NET: LINK UP 1000 MBIT` at OS idle (real display text from the kernel), `NET: DOWN` on loss.

## UI the picker needs

- Shelf tiles for `nic` (installable into `pcie`), `router` and `isp` (applied on purchase; "placed" and "plan active" states, an owned-badge, no inventory entry). Locked tiles marked `Level N` (`PROGRESSION.md`).
- A **net panel** (from the router prop or a HUD chip): state chip with reason, `down` / `up` bandwidth and the binding limiter (`limited by: router`), clients in use of max, the transfers list with progress bars and ETA, the offer list (same tile look as keys with needs chips), and what an upgrade would add (`Plan isp2: 200 down, scan 12 s`).
- The existing tray and key tiles show `retired` after the link; the queue list shows `downloading`, `ingest`, `running`, `uploading` rows.
- Cable section of the Machine panel gains Ethernet with its port choice (board or each NIC).
- Refusal reasons: `needs Level 4`, `needs a router`, `needs 64K of RAM`, `needs an OS`, `no free PCIe slot`.
- Offers and queued rows carry the decline control (`PROGRESSION.md` "Declining"): on a waiting offer or a spooled job that has not started. A running, downloading or uploading job shows none.
- The queue shows `persisted` rows as spooled (a small disk icon), and a `spool full` chip when `os.spool.full` is set.

## Tests the sim needs

1. `net/specs`: the tiers are strictly increasing in speed, price and level; effective bandwidth is the minimum and `binding` names the right limiter in each case (port, router, ISP, disk); client slots are the minimum of router and plan.
2. Link states: every row of the state table, including the reasons (`no-os` for missing OS, RAM 32K, no space); power-off, trip, crash and burnt board go `down`; reboot returns to `link-up` only after the OS is up; unplugging the cable and plugging it back while on.
3. Transfers: download time equals size over bandwidth; two concurrent downloads take twice as long; upload uses its own bandwidth; a slow drive caps the download rate (`diskSinkMbps`); thermal throttle halves a NIC card's rate.
4. Flow: a job goes arrival, offer, admission, download, ingest, run, upload, delivery with payout and client-base points only at delivery; one program runs at a time; no `usbEnumTicks` or `usbFlashTicks` applied.
5. Queue bound: reservation counts downloads; a full queue keeps offers waiting and expiring; the bound never exceeds `queueSlots`.
6. USB retirement and fallback: after the first `link-up` no key arrives; keys in the tray or held are still served; `deadTicks` reaching 300 starts keys at one third of the normal rate (counted over a long run within a tolerance); a return to `link-up` ends the fallback at once; the web class has no share in fallback and none before a plan; `deadTicks` and the retirement are sticky across save and load.
7. Power loss: a spooled job survives (the queue is rebuilt from the headers in `sequence` order; a running one restarts from zero); a finished download still in the rx window and a download in progress return to the offer list with `attempts++`; an upload in progress and a result that was only in RAM run again; the offers expire while `down`; money and score are not credited twice.
11. Spool: a slot with no valid header after a power cut is free at boot; a full spool keeps offers and tray keys waiting (not refused) until they expire; the bound never exceeds the free space; delivery frees the slot and only then pays; `os.spool` and `queue[].persisted` match the state.
8. Needs and expiry: an unrunnable offer is shown, never started, expires with the penalty of `PROGRESSION.md`, and is excluded from the oldest-age term.
9. Save: v4 loads into v5 with defaults; round trip of router, plan, lan and `networkLinked`; offers and transfers are not saved; determinism with the same seed.
10. Protocol and store: `connectCable("lan", port)` and `disconnectCable("lan")` while on; `purchase("isp2")` and `purchase("router2")` apply immediately and respect level and money; the snapshot's `net` block matches the game state; an operator bot test that sets up the network and compares the income and reputation with and without it.

## Decided (2026-10-24)

Owner decisions 1 to 4 are at the top. Every other proposal is accepted as written: **decided: default accepted**.

1. Prices, speeds and sizes: decided: default accepted (5 ISP tiers, 4 routers, 3 NIC cards), re-spaced to level 4 by decision 1.
2. Disk sink: decided: default accepted (the OS drive caps the download with `diskSinkMbps`).
3. CPU cost of the stack: decided: default accepted (only the spool and copy work is CPU; no per-Mbit tax on the running program).
4. Minimum RAM 64K for the stack: decided: default accepted (two `ram1` on the Basic board, $200).
5. Hot-plug of the ethernet cable: decided: default accepted (the one exception to "cables only while off").
6. USB fallback: decided by owner decision 3 (300 ticks, one third of the rate).
7. Power-off cost: decided by owner decision 4 (spooled jobs survive; RAM-only work is lost).
8. Several ports: decided: default accepted (one uplink: the board jack or one card).
9. Wi-Fi or a second router for several machines: decided: not designed until a second machine exists.
10. Router power: decided: default accepted (wall-powered and always on; no switch, no UPS item).

## Still undecided

- Nothing blocks the build. Not designed yet, so not decided: a second machine or Wi-Fi, a UPS item for the router, and the spool size of a planned drive tier (RAID, `nvme3`).
- Prices and disk rates of the planned items are placeholders until the engines and GPU work set them, and the time and income estimates are re-measured by the bots.
