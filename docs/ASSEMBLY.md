# Assembly, boot and USB keys

Code: `src/sim/game/game.ts` (the API below), `src/sim/board/cables.ts` (cables, boot check), `src/sim/pch/` (PCH device and boot ROM), `src/sim/game/work.ts` (the key tray), `src/sim/game/operator.ts` (a bot player for tests). No DOM imports. The worker protocol and store functions that carry these calls are at the end.

## The loop in one paragraph

The game starts with a bare board and a free **starter crate** (an inventory). The player installs each part into a typed slot, plugs cables, plugs a **USB key** from the tray into the USB port, and presses power (**the machine only looks for a program at boot**). After a cold-boot wait and POST the **boot ROM** (run on the simulated CPU) looks at the USB port **once**: no key means `NO BOOT MEDIA: INSERT A KEY AND RESTART` and the machine halts; a key means the ROM copies its program into RAM, runs it, writes the result back to the key, shows `JOB DONE: REMOVE KEY, THEN POWER OFF/ON` and **halts**. The player removes the key (the client collects the result, the player is paid), then powers off and on again, with the next key plugged, for the next job. That manual loop is slow by design; an OS (see [`OS.md`](OS.md)) reads keys while running. A key plugged into a running no-OS machine after the ROM's look is simply ignored. The machine waits forever for the player at every step: idle time is lost income.

## Start state (`new Game({seed})`)

- Board tier 0 (**Starter**: 1 DIMM, 1 SATA, 1 USB, 1 display, ATX, a `vrm-sink` slot, no PCIe or M.2), **empty sockets**, nothing mounted. The stock cooler (`cooler0`) is in the crate: a cooler mounts on the CPU, so it is a real install step.
- Powered off, phase `off`. Money `ECONOMY.startMoney` = $0. No cables connected. No progress flags.
- **Inventory (the crate)**: `inv1` `cpu0` (unpipelined), `inv2` `psu0` (40 W), `inv3` `ram0` (16K), `inv4` `display0` (CLI monitor), `inv5` `cooler0` (stock heatsink and fan; last, so the older ids did not shift).
- **Cooler rules**: `install` of a cooler is refused with `install the CPU first: the cooler mounts on it` while no CPU is installed (the inventory item shows that reason). `uninstall` of the last CPU also takes the mounted cooler back to the inventory (a second inventory item, noted in the log). Swapping the CPU for another keeps the cooler mounted. A better cooler goes through the normal swap and the old one returns to the inventory. Power-on without a working cooler is a POST error (like a missing CPU): phase `error`, `phaseReason` / `postBlocker` `no CPU cooler installed: it mounts on the CPU`, the monitor shows `NO CPU COOLER` and the machine stays halted until powered off and fixed. `new Game({preassembled: true})` is still fully assembled, cooler included.
- The tray holds one key (a `cli.log` job, the guided first job). Its clock starts at the first real boot, see "Keys".
- `new Game({seed, preassembled: true})` is the dev/test shortcut: everything installed, all cables connected, all milestones reached, power already on, the same single starter key in the tray.
- `new Game({seed, sandbox: true})` (the New game dialog's Sandbox): all milestones reached, free purchases, the bare crate unless `preassembled: true` (then assembled and **powered off**, waiting for the power button). See [`SANDBOX.md`](SANDBOX.md). `src/sim/game/operator.ts` has a bot (`Operator`, `play`) that drives the machine like a patient player; the economy and trade-off tests use it.

## Game API

All actions return `{ok: true, ...}` or `{ok: false, reason}` with a human-readable reason. Nothing throws.

| Call | What it does |
|---|---|
| `install(invId, slotId?)` | Put an inventory item into the machine. With `slotId`: a free compatible slot, or an occupied slot of the **same kind** (swap: the old part returns to the inventory, a burnt one is scrapped). Without: the first free compatible slot, else swap with the installed part of that kind. A board item (`board1`...) upgrades the board (or replaces a burnt one of the same tier) and carries every part and cable over (slot id `"board"`, the old board is not kept). Validates slot type and the PSU rules (connector, watts vs rated load); on a refusal nothing changes. Returns `{deviceId, slot}`. |
| `uninstall(deviceId)` | Remove an installed part; it goes to the inventory (a burnt part is scrapped). Returns `{invId}`. Unplugs the cables that ran from it. |
| `connectCable(cable)` / `disconnectCable(cable)` | `cable` is `"atx"` (24-pin, PSU to board), `"cpu"` (8-pin, PSU to the CPU socket) or `"video"` (board display output to the monitor). Connecting needs the source part installed (PSU for atx/cpu, monitor for video). A `"pcie"` cable arrives with GPUs. |
| `powerButton()` | Off to on (refused only without a PSU and the ATX cable); powered in any phase (posting, running, halted, error) it is an immediate hard power-off. See "Power and POST". Returns `{powered}`. |
| `plugKey(keyId)` / `ejectKey()` | See "Keys". `ejectKey` returns `{payout, done}`. |
| `purchase(specId)` | Buy a catalog item (`cpu1`, `ram1`, `cooler1`, `psu1`, `board1`, ...). Money is spent now and the item goes to the **inventory**; nothing is installed. Returns `{invId}`. In a sandbox game the price is 0, and any tier is offered (see [`SANDBOX.md`](SANDBOX.md)); the install and power rules are the same. A board (`board<tier>`, only the next tier, or the same tier while the board is burnt) can be bought **only while powered off** (reason "powered off required"); `vsink0..2` are the VRM heatsinks. Only upgrades over what you own (installed or in the inventory) are offered; the plan must pass the board's rules (cpu2 needs a 100 W PSU somewhere in the plan). |
| `setCpuClock(clock)` | Overclock/underclock the installed CPU (allowed while on). |
| `powerCycle()` | Clear a PSU trip and cold-reboot (the key stays plugged, the job restarts). |
| `advanceBaseTick()` | One second of game time. |
| `snapshot()` | Plain JSON, see below. `toSave()` / `Game.fromSave()` see [`SAVE.md`](SAVE.md). |

**Parts and cables only change while the machine is off** (`reason: "power the machine off first"` otherwise). This replaces the old deferred-purchase mechanism: a purchase never touches the running machine. Purchases themselves are allowed any time.

Test and bot helpers on `Game`: `currentPhase()`, `trayKeyIds()` (only keys the machine can run), `pluggedKey()`, `inventoryItems()`, `canInstall(invId)` (ignores power), `missingCables()`, `hasOs()`, `osHeld()`, `pluggedIngested()`.

## Phases

`snapshot.phase` is one of:

| Phase | Meaning |
|---|---|
| `off` | Not powered. The monitor is dark (`display` is empty). |
| `posting` | Powered on and booting: first the cold-boot wait (the POST time, 30 ticks on the Starter machine, see below; the monitor stays black and the CPU idles), then the ROM's power-on self-test printing lines. |
| `loading` | POST passed and a key was in the port at the ROM's one look: it copies the program into RAM. `bootProgress` moves from 0.4 to 1. |
| `running` | The job runs. |
| `writing` | The job finished; the ROM copies the result line to the key. |
| `halted` | The ROM stopped for good until the player power-cycles. `haltReason` says why: `"job-done"` (the key holds its result, the monitor says `JOB DONE` / `REMOVE KEY, THEN POWER OFF/ON`) or `"no-boot-media"` (no key at the look; `NO BOOT MEDIA` / `INSERT A KEY AND RESTART`). `bootProgress` is 1 for job-done and 0.4 for no media. The phase is set only once the whole message is on the monitor: the ROM writes the message before it sets the halt phase, and `currentPhase()` reports `writing` while the monitor's write queue (one tick per character) still holds characters. A halted snapshot always shows the whole message. |
| `error` | Powered but stopped; `phaseReason` says why (below). A POST error has `postFailed: true`. |
| `waiting-for-key`, `done-remove-key` | The old per-job-reboot phases. Kept in the type for old consumers, **never produced any more**. |
| `booting-os`, `idle-os`, `ingesting`, `running-os`, `flashing` | Only with an OS installed, see [`OS.md`](OS.md). |

Order for one job (no OS): `posting`, `loading`, `running`, `writing`, `halted` (job-done); with no key: `posting`, `halted` (no-boot-media). Then nothing happens until the player powers off and on. The phase is the ROM's own `PHASE` register (its stores: `Halted` 12 and `NoMedia` 13 are new), except `off` and `error`, which the game decides.

## Power and POST

- **Power button, off to on**: refused (`ok: false`, nothing happens, `noPowerReason` in the snapshot) **only** when a PSU is missing or burnt, the board is dead, or the 24-pin ATX cable is not connected. This is "no power at all": nothing lights. Everything else is a POST error, reported after the press.
- **POST errors are reported by the firmware** (the PCH's own self-test, before the CPU is released; there is no CPU to run asm when the CPU is the missing part, so this check is the PCH hardware, `bootCheck` in `board/cables.ts` and `Game.coldBoot`). Checked in this order, each with a distinct reason: no CPU (`NO CPU`), burnt CPU (`CPU FAILED`), no cooler (`NO CPU COOLER`), no 8-pin CPU power (`NO CPU POWER`), no working RAM (`NO RAM`). The machine is powered but stopped in phase `error` (`postFailed: true`, `phaseReason` = the readable reason, no CPU activity so `pipe` is null) and, after the cold-boot wait below, the PCH prints `POST FAILED: <SHORT>` and `POWER OFF TO FIX` on the monitor **when a video path exists** (monitor installed and cable connected; without it the screen is dark and the status chip is the only message). The player powers off, fixes it and powers on. `postBlocker` in the snapshot says what would fail, live. The UI shows these as `POST error: <reason>`, never as a refusal.
- **Cold boot wait**: after every power-on (and crash reboot) the machine waits its **POST time** (`postTicks(cfg, board)`, placeholder: PSU power-good, fans, BIOS init, counting the RAM, spinning up the drives) before the CPU runs the ROM. It is `22 + min(40, 0.25 x RAM KiB) + 2 x sticks + init ticks (cpu 1, display 1, hdd 4, SATA SSD 2, NVMe 1)`, capped at 90, so the Starter machine is exactly 30 and a bigger build takes longer (cpu2, 64K stick, NVMe, monitor: 43); `Snapshot.postTicks` shows it and `EconomyConfig.coldBootTicks` overrides it (tests set 0). The monitor is black, the thermal load is idle, and a faster CPU does not shorten it. It is the fixed price of every boot, which is why a no-OS machine (one boot per job) is slow and an OS machine (one boot) is not. A failed POST gets the same wait: the phase `error` and `phaseReason` show at once (the UI chip reads them), but the monitor stays black through the wait and the `POST FAILED` text appears only when it ends (`Game.showPostError`). With no wait configured (the `coldBootTicks` override at 0) the text is there at once.
- **Monitor**: decision: a missing monitor or video cable does **not** stop the boot. The machine powers on and runs headless; `monitorLive` is false and `display` is empty. (The PCH error text is also invisible then.) The tutorial gates on `videoConnected`.
- **Other `error` causes at run time**: PSU overload trip (`phaseReason` mentions power cycle; `powerButton()` off or `powerCycle()` clears it), burnt CPU or PSU. All need a power-off to repair.
- **Power button, on to off**: always works, in any phase, **immediately** (hard power-off): a job in progress is lost, but its key keeps its data, **stays plugged** (`attempts++` if it was loading, running or writing) and the job restarts at the next boot while the key is still in the port. A finished key stays finished and shows `JOB DONE` again at the next boot.
- A **thermal error** (CPU in its unstable range) crashes the machine: it cold-reboots, the plugged key's job restarts, `errors` and the key's `attempts` count up, no payout for the attempt.
- Boot time and heat: while POST runs, loading, running or writing the CPU is at full load; during the cold-boot wait, when halted, or in error the thermal model gets `idleLoad`. Powered off, nothing draws and the parts cool.

## The PCH and the boot ROM

`src/sim/pch/pch.ts` is a device on the bus at `PCH_BASE` 0x4002_0000 (constants in `src/sim/isa/memmap.ts`). It holds the **boot ROM** (`rom.ts`, a loader written in the toy ISA as asm text in the repo, assembled at import), the **USB host controller** registers and key windows, and the **display routing** (blank-screen control, POST error text).

Boot ROM: at power-on the PCH shadows the ROM image into RAM at address 0 (the engines fetch from RAM only) and the CPU starts there, so everything the ROM does is real instructions on the real engine and **boot time depends on the CPU** (cpu0 reaches the key prompt in about 10 s, cpu1 in 2 to 5 s). The ROM is about 165 words, below `USER_BASE` 0x1000.

Registers (word access, offsets from `PCH_BASE`):

| Offset | Name | |
|---|---|---|
| 0x00 | STATUS | ro: bit0 key plugged, bit1 key holds a result, bit2 a key was pulled since the last acknowledge |
| 0x04 | KEY_LEN | ro: program length in words |
| 0x08 | PHASE | rw: the ROM writes the phase (1 posting, 2 waiting, 3 loading, 4 running, 5 writing, 6 done) |
| 0x0C | CTRL | wo: bit0 blank the display, bit1 acknowledge a removal (clears STATUS bit2) |
| 0x10 | RAM_KB | ro: installed RAM in KiB (the ROM prints it) |
| 0x14 | CPU_TIER | ro: CPU tier (the ROM prints it) |
| 0x18 | RESULT_LEN | wo: result length in words |
| 0x1C | DONE | wo: 1 = the job is done; the controller captures the result text into the key |
| 0x20 | PROGRESS | rw: POST progress mark 0..4 |
| 0x1000 | key window | ro: the plugged key's program, word reads |
| 0x4000 | result window | wo: 8 words (32 characters) copied back to the key |

ROM flow (`src/sim/pch/rom.ts`): `reset`/`boot` blanks the screen, acknowledges any earlier removal and writes PHASE=posting. POST prints `PCH BIOS 1.0`, `CPU T<tier> OK`, `RAM <kb>K OK` (packed word stores to the display, RAM size through the `print_dec` kernel) and `USB OK`. With a bootable OS drive it loads the kernel instead (see [`OS.md`](OS.md)). Otherwise the one key check: no key writes `NO BOOT MEDIA` / `INSERT A KEY AND RESTART`, then PHASE=NoMedia, then halts. With a key: PHASE=loading, `LOADING JOB`, copies `KEY_LEN` words from the key window to RAM at `USER_BASE` (lw/sw loop), PHASE=running, `RUNNING JOB`, `jalr` to the program. The program ends by jumping to `ROM_DONE_VECTOR` (0x10), the `epilogue`: PHASE=writing, copies the job's output line (display row `JOB_ROW` 8, 8 words) into the result window, writes RESULT_LEN and DONE. Then `finished` writes `JOB DONE` / `REMOVE KEY, THEN POWER OFF/ON`, and PHASE=halted is written **last**, before the ROM spins. Every halt message is on the monitor before its halt phase is set (see the `halted` row above). A key that already holds a result at boot (power cycled before removal) goes straight to `finished`.

The display rows during a job: 0-3 POST lines, 5 status line, 8 the job's own output.

### Generator convention (hosted programs)

`generate(template, seed, {hosted: true, row: JOB_ROW})` ends the program with `li t0, ROM_DONE_VECTOR; jalr zero, t0, 0` instead of `ecall`. Standalone programs (default) still end with `ecall` and run on the reference interpreter; all generator tests are unchanged. Payout `work` is the standalone instruction count. Hosted code is at most `MAX_CODE_BYTES` = 0x3000 so it ends below the scan buffer at 0x4000.

## Keys and the queue

- **Arrivals** (existing generator/economy, rates and mix in `ECONOMY`): a key arrives with probability `demandRate` per tick. It carries its job (`template`, `seed`, `scale`), a number the program prints on the monitor (`jobNo`, `#NN`), a type (`log`, `calc`, `checksum`, `scan`) and arrival/deadline ticks. Label: `#72 scan`. The program is generated when the key is plugged in.
- **The tray** is the queue, capped at `queueCap` (10). **Overflow**: an arrival into a full tray is dropped (`dropped++`); the client takes the key back, and that counts as a `giveUpTurnaround` (180 s) in the turnaround average, so reputation drops.
- **No clients before the first boot**: random arrivals start when `progress.poweredOn` first becomes true, and the keys waiting from the start get `arrival` = that tick. So assembling the PC does not cost reputation or lateness. After that the market does not wait for the player.
- `plugKey(keyId)`: moves the key from the tray into the USB port. **One program at a time**: refused while a key is plugged. Allowed in any phase, but without an OS **it only counts if it is in the port when the ROM takes its one look** (machine off, or still in POST). A key the machine cannot run (its `needs` are not met: a `db` job without an OS and a SATA SSD, any `gpu` / `web` placeholder) is refused with `cannot run this job: it needs ...`; with an OS that is the refusal at ingest. Plugged into a running machine after that, the key is ignored: no LED activity (`keyActivity` stays `"none"`), nothing is read, and `keyIgnored` is true while the machine is halted. The UI shows a hint; power off and on to load it.
- A running job writes its result into the key. When the ROM signals done the key holds `result` (the exact output line, e.g. `#72 mul=31 OK`).
- `ejectKey()`: if the key holds a result, **the client collects it: payout and reputation are applied now**. `turnaround = removal tick - arrival`, `payout = round((payBase + payPerInstr * work * payMul) * speed * (late ? lateFactor : 1))`, `speed = clamp(targetTurnaround / turnaround, 0.5, 2)`. The reputation EMA takes this turnaround. If the job is **not finished**, the key goes back to the tray unserved (no payout, `attempts++`) and a machine that was loading, running or writing crashes and cold-reboots (finding no key, it halts with `NO BOOT MEDIA`).
- **Waits forever**: the machine never times out waiting for a key or for the removal. Reputation and demand decay while keys sit unserved: `reputation = clamp(target / max(avgTurnaround, age of the oldest waiting key))`, so an old key drags reputation down before it is even served. Idle time is lost income.
- **After the result is written the machine stays halted** (`halted` / `job-done`): no auto-reboot, no waiting for a key. Payout comes when the player removes the key; the next job needs a manual cycle (remove key, power off, plug the next key, power on; `progress.firstManualCycle` is set the first time a key is plugged at a power-on after a hand-back). **The OS is the way out**: it boots once, reads keys while running (hot-plug ingest), and an OS machine powered on with a key already in the port notices it at idle and ingests it. The seam is the ROM's key check (`keyloader` in `pch/rom.ts`, which runs only without an OS) and `Game.plugKey`/`ejectKey`.
- **Offline catch-up does not apply**: without automation nothing runs while the player is away (the host already drops time beyond one frame). A later router/ethernet downloads workloads directly and uploads results. That seam is `WorkSource` in `src/sim/game/work.ts` (`offer`, `waiting`, `take`, `giveBack`); the USB tray (`UsbTray`) is the first implementation. The Game only uses the interface for arrivals and the waiting list.

## Storage and the OS (summary; the full description is [`OS.md`](OS.md))

Storage drives (`hdd0`, `ssd1`, `nvme2`) are bought into the inventory and installed into `sata` / `m2` slots (machine off). An OS (`os1`) is bought, then installed **onto a storage drive** (`install(invId, storageSlotId)`). Without an OS everything above (reboot per job, one key at a time) is unchanged. With an OS the ROM loads the kernel from the drive after POST and the machine boots **once**: phases `booting-os` -> `idle-os`, then `ingesting` (kernel copies a plugged key's job to disk; the player may unplug it), `running-os` (one program at a time), `flashing` (the finished key is plugged again and gets its result). Payout and reputation happen when the flashed key is removed. `Snapshot` additions: `storage[]`, `os` (tier, `programSlots`, `queueSlots`, queue), `held[]` (ingested keys the player holds), `keyActivity` (USB LED), `KeySnap.stage`, phases above, `inventory[].kind` / `purchases[].kind` may be `storage` or `os` (OS rows also carry `later`, `description`), progress flags `storageInstalled`, `osInstalled`, `firstOsJob`. New call `uninstallOs()` (message `uninstallOs`); new PCH registers `BOOT_DEV`, `OS_MODE`, `KEY_ID` and STATUS bits 3 (key enumerated) and 4 (flashing), only meaningful once the ROM handed over to a kernel.

## Snapshot (new fields; the rest is in [`GAME.md`](GAME.md))

```ts
phase: "off" | "posting" | "loading" | "running" | "writing" | "halted" | "error"  // plus the OS phases; "waiting-for-key"/"done-remove-key" are never produced
phaseReason: string | null          // for "error"
haltReason: "job-done" | "no-boot-media" | null   // for "halted"
postFailed: boolean                 // the "error" is a POST error (a missing part)
keyIgnored: boolean                 // a key sits in the port of a halted no-OS machine: it is never read until a power cycle
patience: { mul, targetTurnaround, deadlineTicks, sinceFirstBoot }   // the client patience of the player's level now (GAME.md)
level: LevelSnap                    // client base, level, thresholds, progress, upcoming levels (GAME.md, PROGRESSION.md)
expired, declined: number           // lifetime counters
postTicks: number                   // the POST time of the machine as built
powered: boolean
bootProgress: number                // 0..1: POST 0..0.4, no media 0.4, loading 0.4..1, 1 once the program runs and when job-done
display: string                     // the monitor text; "" when off or the monitor is not live
monitorLive: boolean                // monitor installed + video cable + not burnt
noPowerReason: string | null        // why the power button would do nothing
postBlocker: string | null          // why POST would fail now
devices: DeviceSnap[]               // installed parts (id, spec, kind, name, slot, burnt, clocks, temp, power...)
inventory: { id, spec, kind, name, freeSlots: string[], swapSlots: string[], installable: boolean, reason? }[]
slots: { id, type, deviceId: string | null }[]      // every slot of the board, filled or empty
cables: { id: "atx"|"cpu"|"video", name, connected, blocked? }[]
tray: KeySnap[]                     // keys in the tray, oldest first
plugged: KeySnap | null             // the key in the USB port
progress: Progress                  // tutorial milestones
log: { tick, kind, text }[]         // last 16 notable events, oldest first
queueLength, queueCap, completed, dropped, errors, lastCompleted, reputation, demandRate, avgTurnaround, money, ...
KeySnap = { id, template, type, jobNo, label, arrivalTick, deadlineTick, age, late, payoutEstimate, attempts, done, result, stage,
            cls, needs: string[], runnable, missing: string[], expiresTick, declinable }   // job class, what it needs, whether the machine can run it
```

- **Drop-target highlighting**: for an inventory item, `freeSlots` are the slot ids it fits right now (validated, including PSU watts) and `swapSlots` the occupied slots of the same kind it could replace. Both empty means it cannot be installed (see `reason`). `installable` is true if there is a target **and the machine is off**. For a board item `freeSlots` is `["board"]`. `slots` gives every slot with its occupant; the renderer matches `devices[].slot` to `slots[].id`.
- The old `request` (the plugged key's job), `queueLength` (tray size), `pipe` (pipeline stages while powered), `purchases` and `cpuClock` fields are kept. `pendingPurchases` is deprecated and always empty.

## Progress flags (tutorial)

`snapshot.progress`, persistent (saved), sticky once true, set only by real successful events:

`cpuInstalled`, `coolerInstalled` (a cooler was mounted; derived from the board when loading a save that lacks it), `psuInstalled`, `ramInstalled`, `monitorInstalled`, `storageInstalled` (an install of that kind succeeded), `atxConnected`, `cpuPowerConnected`, `videoConnected` (that cable connected), `poweredOn` (a real boot started: the power button was accepted and POST passed, not a refused press or a POST error), `firstKeyPlugged`, `firstJobDone` (the ROM wrote DONE to the key), `firstKeyEjected` (a finished key removed, paid), `firstManualCycle` (a power-on with an unfinished key plugged, after the first hand-back: the manual loop was done once; derived from `firstKeyEjected` when loading a save that lacks it), `firstPurchase` (a purchase succeeded), `osInstalled` (an OS was installed on a drive), `firstOsJob` (a job ingested by the OS was delivered). The last three were added in save v3 and stay false for migrated and preassembled games. The guided tutorial gates on these; `completed` is the job count.

## Pacing (starting machine, 1x)

Measured over 30 seeds with a bot that runs the manual loop with 2 s per step (`game.test.ts`): from power-on to the first payout **about 70-80 s** (cold boot 30 s, POST ~10 s, then load ~19 s, run ~6 s, write ~9 s; plus the remove), first payout about **$37-50**, the first $100 within about 560 s. Before the cold-boot wait the first job was 45-48 s. The wait is the POST-time function now; the Starter value (30) is unchanged, so this timing is too. The `Operator` bot (`operator.ts`) now follows the manual cycle (or the OS routine). Because every job pays a flat `payBase` and boots first, the CPU is the big upgrade for log/calc/checksum jobs and RAM for scan jobs; see [`GAME.md`](GAME.md).

## Worker protocol and store

`ToSim` additions (`uninstallOs` came with the OS, see OS.md): `install {invId, slotId?}`, `uninstall {deviceId}`, `connectCable {cable}`, `disconnectCable {cable}`, `powerButton`, `plugKey {keyId}`, `ejectKey`. Each replies with a `snapshot`, preceded by an `error {message}` if it was refused (`"<call>: <reason>"`). `purchase` now means "buy to the inventory". Store functions (`src/game/store.ts`): `install`, `uninstall`, `connectCable`, `disconnectCable`, `powerButton`, `plugKey`, `ejectKey` (plus the existing `purchase`, `setCpuClock`, `powerCycle`, `setSpeed`, `exportSave`, `importSave`); a refusal lands in the `lastError` signal. Levels added `declineKey {keyId}` and `declineJob {id}` (decline a waiting job, see GAME.md) and the sandbox tool `setLevel {level}`; the store has `declineKey(id)`, `declineJob(id)`, `setLevel(n)`.

`src/ui/Shop.tsx` has a minimal "Machine" section (power, cables, install and remove buttons, plug/remove key) so the old UI stays playable until the drag-and-drop UI exists.

## Board ladder and the VRM (see [`VRM.md`](VRM.md))

The board has four tiers (Starter, Basic, Mainstream, Enthusiast); `Snapshot.board` holds the tier name, `features`, the slots it has, the `vrm` state and the installed heatsink. The VRM can crash the machine ("VRM voltage droop", same path as a thermal error, logged) and burn out: a burnt board gives phase `error` with reason **"board dead: replace the board"**, the power button refuses, the installed parts stay in their slots, and the fix is buying a board of the same or a higher tier (powered off) and installing it. The tutorial installs one RAM stick, which fits the Starter board's single DIMM slot (tested by the tutorial bot).
