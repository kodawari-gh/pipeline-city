# Network phase: NIC, router, cable, ISP and the network work source

Status: **design, not built.** It is built after the level system ([`PROGRESSION.md`](PROGRESSION.md)); the unlock levels below are the ones of that document. All numbers are placeholders. Owner decisions are marked **(owner)**. Background: [`TECHTREE.md`](TECHTREE.md) (notes "Network phase design notes"), [`OS.md`](OS.md) (the kernel and the key ingest this replaces), [`ASSEMBLY.md`](ASSEMBLY.md) (cables, power, `WorkSource` in `src/sim/game/work.ts`), [`BOARD.md`](BOARD.md) / [`VRM.md`](VRM.md) (`BoardFeatures.ethernetMbps`: 0 on Starter, 100 on Basic and Mainstream, 1000 on Enthusiast).

## The idea in one paragraph

Without a network the player is the delivery van: plug a key, wait for the enumerate, unplug, plug again to flash the result. With a network the clients send their jobs over the wire: the OS downloads each job in full in the background, runs it (still one program at a time), and uploads the result; the player does nothing per job. **USB keys stop arriving** once the link is first up (owner). What the player buys now is bandwidth: the slowest of the port, the router and the ISP plan limits how fast jobs come and go, and the router and plan limit how many clients can be served at once. One-off purchases only, no recurring bill (owner).

## Parts

Speeds are in Mbit/s. Sizes of jobs are in "game MB" (fiction units, see "Job sizes"). Levels refer to `PROGRESSION.md`.

### Ethernet port (on the board and on a card)

- **Onboard port (not a part):** present on board tiers 1 and up as a `lan` jack on the board's I/O panel: Basic 100, Mainstream 100, Enthusiast 1000 (`BoardFeatures.ethernetMbps`; Starter has none). It is free, draws nothing extra (the board's idle power already counts it), cannot be bought or burnt separately, and is usable once the network unlocks (level 8). It does not use a PCIe slot.
- **PCIe NIC cards** (new device kind `nic`, slot `pcie`, one card per slot; a NIC card has its own jack and its speed replaces the onboard one for the cable plugged into it):

| Id | Name | Speed | Price | Idle / load W | Thermal (throttle / unstable / damage C) | Unlock |
|---|---|---|---|---|---|---|
| `nic1` | GbE card | 1000 | $120 | 1.5 / 3.5 | 75 / 90 / 105 | level 9 |
| `nic2` | 10GbE card | 10000 | $500 | 5 / 11 | 65 / 80 / 95 | level 13 |
| `nic3` | 40GbE card | 40000 | $1800 | 9 / 22 | 60 / 75 / 90 | level 17 |

  The card's load watts follow its traffic (utilisation of the link), so a busy 40G card is a real power and heat source and counts against the PSU rated load at install time like any part (`heatFactor` 1). Above its throttle temperature the card runs at half speed, above unstable it drops frames (transfers stall, a retry timer), above damage it burns (like any device; replace it). Fast cards want airflow, so cooler and case-fan choices matter again. A card needs a free `pcie` slot (Basic has 1, Mainstream 2, Enthusiast 4), so the network competes for slots with the future GPU, NPU and TPM: a deliberate choice.
- On Basic and Mainstream the onboard 100 Mbit already works, so `nic1` is a reason to move up from 100 to 1000; Enthusiast already has 1 Gbit, and a card is for 10G and 40G.

### The cable (a drag)

An **ethernet cable** is a new cable `lan` in `Snapshot.cables` next to `atx`, `cpu` and `video`. The player drags it from a port (the board jack, or a NIC card jack) to the router. It comes free with the first router purchase (a stock cable sits in the inventory as a cable item, not a part). `connectCable("lan", port)` where `port` is `"board"` or the NIC `deviceId`; the cable stays plugged until `disconnectCable("lan")`. If both an onboard port and a card exist, whichever the cable is plugged into is the **uplink** and its speed counts. **The cable can be plugged and unplugged while the machine is on** (an exception to the "cables only while off" rule: it is an external cable on a hot-pluggable port; open question 5).

### The router (a prop next to the monitor)

A separate external box placed beside the monitor, powered from the wall (no PSU budget, no heat, cannot burn). It is bought, not installed: `purchase("router1")` places it (replacing a lower one; the old one disappears). It is always on, so the link drops when the PC is off only because the PC is off.

| Id | Name | Port speed | Simultaneous clients | Price | Unlock |
|---|---|---|---|---|---|
| `router1` | Home router | 100 | 2 | $60 | level 8 |
| `router2` | Gigabit router | 1000 | 4 | $200 | level 9 |
| `router3` | 10G switch-router | 10000 | 8 | $700 | level 13 |
| `router4` | Core router | 40000 | 16 | $2500 | level 17 |

### The ISP plan (a one-off purchase; the wall jack)

Bought once, not an installed part and not a bill (owner): `purchase("isp1")` sets the plan; a higher plan replaces it (no refund, no downgrade offer). The router is pre-wired to the wall jack, so there is no second cable. The plan caps the download and upload bandwidth and how many clients can be served at once.

| Id | Name | Download / upload (Mbit/s) | Clients at once | Price | Unlock |
|---|---|---|---|---|---|
| `isp1` | Basic DSL | 50 / 10 | 2 | $150 | level 8 |
| `isp2` | Cable | 200 / 50 | 4 | $500 | level 9 |
| `isp3` | Fibre | 1000 / 300 | 8 | $1500 | level 12 |
| `isp4` | Business fibre | 5000 / 1500 | 16 | $5000 | level 15 |
| `isp5` | Backbone | 20000 / 10000 | 32 | $15000 | level 18 |

### Effective bandwidth and clients

```
downMbps  = min(portMbps, routerMbps, ispDown, diskSinkMbps)
upMbps    = min(portMbps, routerMbps, ispUp)
clients   = min(routerClients, ispClients)
```

`portMbps` is the uplink (board jack or card, thermally throttled). **`diskSinkMbps`** is how fast the OS drive can take the spool writes: a new `netMbps` on the storage specs, `hdd0` 80, `ssd1` 400, `nvme2` 2000, so a slow disk is a real bottleneck on a fast line. The `binding` limiter is reported in the snapshot (`port`, `router`, `isp`, `disk`) so the UI can say what to upgrade. Active transfers split the bandwidth equally (downloads share `downMbps`, uploads share `upMbps`, each direction on its own). At 1x a game MB per tick is `Mbps / 8` per second.

### Power, heat and unlock summary

Only the NIC cards draw from the PSU and make heat (table above). The router and the ISP are wall side. Level unlocks: level 8 (`router1`, `isp1`, onboard port usable), 9 (`nic1`, `router2`, `isp2`), 12 (`isp3`), 13 (`nic2`, `router3`), 15 (`isp4`), 17 (`nic3`, `router4`), 18 (`isp5`).

## Requirements on the machine (behaviour)

The network is run by the OS: `os1` has the network stack as an optional part of its kernel (data, `netStack: true` plus `netRamBytes`). Minimum:

- an installed **OS of tier 1 or higher** (`os1`), booted;
- installed RAM of at least **64K** (a `ram2`, or 2 x `ram1` on a Basic or better board; `os1` alone needs 32K): the buffers for the NIC rx/tx windows live in RAM;
- the OS drive with at least **4K free** beyond the spool of `os1` (the net spool) and a drive tier that gives a useful `diskSinkMbps`;
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

**USB keys stop (owner).** The first time the state is `link-up`, `progress.networkLinked` becomes true (sticky, saved) and the USB tray stops producing arrivals: all new work comes as network offers. Keys already in the tray, the port, or held by the OS can still be served exactly as today (the player may keep plugging them; payout on removal). A key is always finished by the key path (flash and removal), even with the link up. If the network has been unusable for `usbFallbackTicks` (default 300, `no-cable`, `no-os`, no plan, or powered off) after having been linked, arrivals resume as keys again until the link is up once more, so cutting the cable never leaves the player with no work (open question 6).

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

### The flow of a job (one source, the OS does the work)

1. **Arrival.** With the link up (or down because of power), an arrival (probability `demandRate` per tick, the same economy and mix as keys, `PROGRESSION.md`) becomes an **offer** in the ISP-side offer list (cap `queueCap` 10, same overflow rule as the tray: a dropped offer feeds `giveUpTurnaround x patienceMul`). An offer whose needs are unmet stays and expires (the rule of `PROGRESSION.md`); the label shows what it needs.
2. **Admission.** Each tick, while fewer than `clients` downloads are active, an OS queue slot is free (`queueSlots` of the OS, further limited by free disk; the slot is **reserved at the start of the download**, so in-flight downloads count against the bound) and the offer's needs are met, the oldest runnable offer starts downloading. The OS queue is the bound: a full queue leaves offers waiting (and aging toward their deadline).
3. **Download.** `doneMB += (downMbps / 8) / activeDownloads` per tick for each active download; the time is size over bandwidth, so concurrent downloads slow each other.
4. **Ingest.** A finished download sits in the NIC rx window. The kernel ingests it **when it is idle** (the OS is one-program-at-a-time, so a long running job delays ingest as it delays key ingest today): it copies the program from the NIC rx window into the disk spool and queues it, exactly like a key (`OS.md`), without the USB enumerate wait (`usbEnumTicks` does not apply). The copy is real CPU work, so a slow CPU still slows the pipeline.
5. **Run.** The oldest queued job runs. One program at a time.
6. **Upload.** When the program ends, the kernel copies the result into the NIC tx window and starts the upload (no `usbFlashTicks`). Active uploads share `upMbps`.
7. **Delivery.** When the upload completes the client has the result: payout and reputation apply at that moment (the old removal time). Turnaround = arrival to upload end, so download, queue wait, run and upload all count. The score of `PROGRESSION.md` is credited.

No manual plug or unplug happens at any step. The kernel's USB paths stay for keys.

### What an OS step looks like to the kernel

New registers at `NET_BASE` in the memory map (a device on the bus, present when a NIC or the board port is cabled; the PCH forwards): `STATUS` (link up, rx ready, tx busy), `RX_LEN` / `RX_ID` and a read window for the finished download, `TX_LEN` / `TX_ID` and a write window for the result, `CTRL` (ack rx, start tx). The kernel adds a poll for `rx ready` beside its USB poll and a tx start after `kdone`. The transfer timing (the download and upload) is simulated in the game layer (`Game`/`net`) as plain counters, not as CPU instructions: only the copies are instructions. The boot header gains a `netStack` flag.

### Power-off, crash and in-flight transfers

- **Power off / trip / crash / board burnt:** the link goes `down`. **Active downloads are aborted and the partial data is lost**: each such job returns to the offer list with `attempts++` and its original arrival tick (the client resends; the time already lost counts toward its deadline). **Uploads in progress are aborted**; because the OS queue lives in RAM and is lost on power loss (`OS.md`), jobs that were queued, running, or waiting for upload return to the offer list the same way (result lost, rerun). The held-key rule is the existing one.
- While `down`, new offers keep arriving into the offer list (clients see a dead server) up to the cap; they age and expire at their deadline like unserved keys, which punishes long outages and rewards booting once and staying up.
- On reboot the link comes back up when the OS is up (`down` to `link-up`); the offer list is served from the oldest.
- Removing the cable mid-transfer is the same as power off for the transfers (state `no-cable`).

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
};
cables: [... , { id: "lan", name: "Ethernet", connected: boolean, blocked?: string }]
// purchases[] / inventory[] kinds: "nic" | "router" | "isp" are added; PurchaseSnap.locked (PROGRESSION.md)
// progress: ispBought, routerPlaced, lanConnected, linkUp, firstNetJob (see tutorial)
// devices[]: the NIC card as a normal DeviceSnap (temp, power, burnt) plus `linkUtil` 0..1
```

`ToSim` additions: `connectCable { cable: "lan", port?: string }` (the `port` field is new; absent for the other cables) and `disconnectCable { cable: "lan" }`. **Buying the plan or the router is `purchase`** with `isp1` / `router1` ids (kinds `isp` / `router`, applied immediately, not to the inventory). The `install` of a NIC card is the normal `install` into a `pcie` slot. No new message type is needed. Sandbox: `sandboxOffers` also lists all `nic`, `router`, `isp` items; a tool `spawnOffer(template, scale)` is the sandbox's `spawnKey` for the network.

`WorkSource` (`src/sim/game/work.ts`): a `NetSource` implements `offer`, `waiting` (the pending offers not yet started), `take` (start a download) and `giveBack` (abort); `Game` picks the key tray or the network source by `progress.networkLinked`, so the arrival code stays unchanged. New folder `src/sim/net/` with `specs.ts` (NIC, router, ISP records and `netMbps` of drives), `link.ts` (state machine and bandwidth) and `source.ts`.

### Save

Additive and a **version bump to v5** (shared with the level block): `net?: { routerTier, ispTier, lan: null | "board" | <deviceId>, networkLinked: boolean }` and `clientBase` / `levelTicks` from `PROGRESSION.md`. The `devices` list may now hold kind `nic` and `cables` may list `lan`, which a v4 loader would reject, hence the bump; the migration from v4 only fills defaults (no router, no plan, no cable, `networkLinked` false). Offers and in-flight transfers are **not saved**: on load pending offers restart as new seeds like the other in-flight requests (`SAVE.md`), and no transfer survives. A save from a game that had already linked keeps `networkLinked` and `usbRetired` so the load does not bring keys back.

## Tutorial (the automation lesson)

A lesson after the OS lesson (offered like "Next lesson: the OS" via `offerNextLesson`), steps gated by progress flags, only shown at level 8 or when the pieces are on sale:

1. "Clients are tired of sticks. Buy a plan." (`ispBought`: any `isp*` purchase).
2. "Place a router next to the screen." (`routerPlaced`).
3. "Drag the cable from the board jack to the router." (`lanConnected`; the machine may be on).
4. "The OS brings the link up." (`linkUp`; if no OS or RAM below 64K the step shows the exact missing piece.)
5. "Watch a job arrive on its own." (`firstNetJob`: a job delivered over the network).

Hints (first occurrence): link `down` after a power-off, `saturated` with the binding limiter, NIC overheat, queue full.

## Visuals the renderer needs

- **Router prop** by the monitor: a box with antenna stubs, ports and 4 to 5 status LEDs (power, WAN, LAN, activity). Four looks, one per tier (bigger, more ports, a rack look at `router4`). Wall-powered: no cable to the PSU.
- **The cable**: a draggable lead from the board jack (or the NIC jack) to the router, with a slack curve; a drop target highlight on valid jacks (`cables[].connected`, `Snapshot.slots`), the plug click animation, and a taut or removed state when unplugged.
- **Wall jack and ISP**: a wall plate with a jack and a lit dot once a plan exists, a thin line to the router, and a small plan label on hover.
- **Link lights**: the board jack LED (off, amber, green, blinking when saturated) and the router LEDs, read from `net.state`.
- **Traffic pulses**: dots travelling along the cable towards the machine for downloads and away for uploads, density by utilisation, colour by direction; a job packet (the key icon but "blue") appears at the board jack when a download completes and enters the drive during ingest.
- **NIC card art** in the PCIe slots for `visual` keys `nic-gbe`, `nic-10g`, `nic-40g` (a bigger heatsink and fan from 10G); activity LED from `devices[].linkUtil`; heat glow as other parts.
- **Board jack art** on every board tier with a port (and a blank cover on Starter); **no USB tray activity** once `usbRetired`: the tray area shows a "retired" dim state with any leftover keys.
- Monitor lines: `NET: LINK UP 1000 MBIT` at OS idle (real display text from the kernel), `NET: DOWN` on loss.

## UI the picker needs

- Shelf tiles for `nic` (installable into `pcie`), `router` and `isp` (applied on purchase; "placed" and "plan active" states, an owned-badge, no inventory entry). Locked tiles marked `Level N` (`PROGRESSION.md`).
- A **net panel** (from the router prop or a HUD chip): state chip with reason, `down` / `up` bandwidth and the binding limiter (`limited by: router`), clients in use of max, the transfers list with progress bars and ETA, the offer list (same tile look as keys with needs chips), and what an upgrade would add (`Plan isp2: 200 down, scan 12 s`).
- The existing tray and key tiles show `retired` after the link; the queue list shows `downloading`, `ingest`, `running`, `uploading` rows.
- Cable section of the Machine panel gains Ethernet with its port choice (board or each NIC).
- Refusal reasons: `needs Level 8`, `needs a router`, `needs 64K of RAM`, `needs an OS`, `no free PCIe slot`.

## Tests the sim needs

1. `net/specs`: the tiers are strictly increasing in speed, price and level; effective bandwidth is the minimum and `binding` names the right limiter in each case (port, router, ISP, disk); client slots are the minimum of router and plan.
2. Link states: every row of the state table, including the reasons (`no-os` for missing OS, RAM 32K, no space); power-off, trip, crash and burnt board go `down`; reboot returns to `link-up` only after the OS is up; unplugging the cable and plugging it back while on.
3. Transfers: download time equals size over bandwidth; two concurrent downloads take twice as long; upload uses its own bandwidth; a slow drive caps the download rate (`diskSinkMbps`); thermal throttle halves a NIC card's rate.
4. Flow: a job goes arrival, offer, admission, download, ingest, run, upload, delivery with payout and client-base points only at delivery; one program runs at a time; no `usbEnumTicks` or `usbFlashTicks` applied.
5. Queue bound: reservation counts downloads; a full queue keeps offers waiting and expiring; the bound never exceeds `queueSlots`.
6. USB retirement: after the first `link-up` no key arrives; keys in the tray or held are still served; the fallback after `usbFallbackTicks`; sticky across save and load.
7. Power-off in flight: downloads and uploads abort, jobs return to the offer list with `attempts++` and their original arrival; results of queued jobs are lost and rerun; the offers expire while `down`; money and score are not credited twice.
8. Needs and expiry: an unrunnable offer is shown, never started, expires with the penalty of `PROGRESSION.md`, and is excluded from the oldest-age term.
9. Save: v4 loads into v5 with defaults; round trip of router, plan, lan and `networkLinked`; offers and transfers are not saved; determinism with the same seed.
10. Protocol and store: `connectCable("lan", port)` and `disconnectCable("lan")` while on; `purchase("isp2")` and `purchase("router2")` apply immediately and respect level and money; the snapshot's `net` block matches the game state; an operator bot test that sets up the network and compares the income and reputation with and without it.

## Open questions (owner, please answer)

1. **Prices, speeds and sizes** are placeholders (a sanity check: `isp1` $150 at level 8 is about 25 minutes of income there). Are the 5 ISP tiers, 4 routers and 3 NIC cards the right amount, or should it be fewer?
2. **Disk sink**: should the OS drive limit the download (proposed, rewards a faster drive), or is that one limiter too many?
3. **Does the network stack cost CPU?** Proposed: only the ingest/egress copies are CPU work; an alternative is a per-Mbit tax on the running program (more realistic, harder to tune).
4. **Minimum RAM 64K** for the stack: OK, or keep 32K with `os1` (so the network is open to the 32K machines of level 8)?
5. **Hot-plug of the ethernet cable** (proposed) versus "cables only while off" for consistency.
6. **USB fallback** after `usbFallbackTicks` of a dead link (proposed, so a cut cable cannot strand the player), or strictly never again?
7. **Power-off cost**: lost queue and lost partial downloads (proposed, consistent with OS v1) or should downloads resume and results be journaled to disk? (A natural `os2` feature if you prefer the harsher `os1`.)
8. **Several ports**: can two cables (board and a card) be plugged at once to the same router for aggregate bandwidth? Proposed no (one uplink).
9. **Wi-Fi** or a second router for multiple machines: not designed; ignore until a second machine exists.
10. **Router power**: it stays on when the PC is off (proposed); does it need its own switch or a UPS item later?
