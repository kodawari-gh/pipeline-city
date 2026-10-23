# Assembly, boot and USB keys

Code: `src/sim/game/game.ts` (the API below), `src/sim/board/cables.ts` (cables, boot check), `src/sim/pch/` (PCH device and boot ROM), `src/sim/game/work.ts` (the key tray), `src/sim/game/operator.ts` (a bot player for tests). No DOM imports. The worker protocol and store functions that carry these calls are at the end.

## The loop in one paragraph

The game starts with a bare board and a free **starter crate** (an inventory). The player installs each part into a typed slot, plugs cables, and presses power. The machine runs its **boot ROM** on the simulated CPU (POST, then wait for a key). Clients leave **USB keys** in a tray; the player plugs one into the USB port. The ROM copies the key's program into RAM, runs it, writes the result back to the key and shows REMOVE KEY. The player removes the key, the client collects the result, and the player is paid. The machine then **reboots by itself** (POST runs again, visibly) and waits for the next key. The machine waits forever for the player at every step: idle time is lost income.

## Start state (`new Game({seed})`)

- Board tier 0 (**Starter**: 1 DIMM, 1 SATA, 1 USB, 1 display, ATX, a `vrm-sink` slot, no PCIe or M.2), **empty sockets**, nothing mounted. The stock cooler (`cooler0`) is in the crate: a cooler mounts on the CPU, so it is a real install step.
- Powered off, phase `off`. Money `ECONOMY.startMoney` = $0. No cables connected. No progress flags.
- **Inventory (the crate)**: `inv1` `cpu0` (unpipelined), `inv2` `psu0` (40 W), `inv3` `ram0` (16K), `inv4` `display0` (CLI monitor), `inv5` `cooler0` (stock heatsink and fan; last, so the older ids did not shift).
- **Cooler rules**: `install` of a cooler is refused with `install the CPU first: the cooler mounts on it` while no CPU is installed (the inventory item shows that reason). `uninstall` of the last CPU also takes the mounted cooler back to the inventory (a second inventory item, noted in the log). Swapping the CPU for another keeps the cooler mounted. A better cooler goes through the normal swap and the old one returns to the inventory. Power-on without a working cooler is a POST error (like a missing CPU): phase `error`, `phaseReason` / `postBlocker` `no CPU cooler installed: it mounts on the CPU`, the monitor shows `NO CPU COOLER` and the machine stays halted until powered off and fixed. `new Game({preassembled: true})` is still fully assembled, cooler included.
- The tray holds one key (a `cli.log` job, the guided first job). Its clock starts at the first real boot, see "Keys".
- `new Game({seed, preassembled: true})` is the dev/test shortcut: everything installed, all cables connected, all milestones reached, power already on, the same single starter key in the tray. `src/sim/game/operator.ts` has a bot (`Operator`, `play`) that drives the machine like a patient player; the economy and trade-off tests use it.

## Game API

All actions return `{ok: true, ...}` or `{ok: false, reason}` with a human-readable reason. Nothing throws.

| Call | What it does |
|---|---|
| `install(invId, slotId?)` | Put an inventory item into the machine. With `slotId`: a free compatible slot, or an occupied slot of the **same kind** (swap: the old part returns to the inventory, a burnt one is scrapped). Without: the first free compatible slot, else swap with the installed part of that kind. A board item (`board1`...) upgrades the board (or replaces a burnt one of the same tier) and carries every part and cable over (slot id `"board"`, the old board is not kept). Validates slot type and the PSU rules (connector, watts vs rated load); on a refusal nothing changes. Returns `{deviceId, slot}`. |
| `uninstall(deviceId)` | Remove an installed part; it goes to the inventory (a burnt part is scrapped). Returns `{invId}`. Unplugs the cables that ran from it. |
| `connectCable(cable)` / `disconnectCable(cable)` | `cable` is `"atx"` (24-pin, PSU to board), `"cpu"` (8-pin, PSU to the CPU socket) or `"video"` (board display output to the monitor). Connecting needs the source part installed (PSU for atx/cpu, monitor for video). A `"pcie"` cable arrives with GPUs. |
| `powerButton()` | Off to on or on to off, see "Power and POST". Returns `{powered}`. |
| `plugKey(keyId)` / `ejectKey()` | See "Keys". `ejectKey` returns `{payout, done}`. |
| `purchase(specId)` | Buy a catalog item (`cpu1`, `ram1`, `cooler1`, `psu1`, `board1`, ...). Money is spent now and the item goes to the **inventory**; nothing is installed. Returns `{invId}`. A board (`board<tier>`, only the next tier, or the same tier while the board is burnt) can be bought **only while powered off** (reason "powered off required"); `vsink0..2` are the VRM heatsinks. Only upgrades over what you own (installed or in the inventory) are offered; the plan must pass the board's rules (cpu2 needs a 100 W PSU somewhere in the plan). |
| `setCpuClock(clock)` | Overclock/underclock the installed CPU (allowed while on). |
| `powerCycle()` | Clear a PSU trip and reboot. |
| `advanceBaseTick()` | One second of game time. |
| `snapshot()` | Plain JSON, see below. `toSave()` / `Game.fromSave()` see [`SAVE.md`](SAVE.md). |

**Parts and cables only change while the machine is off** (`reason: "power the machine off first"` otherwise). This replaces the old deferred-purchase mechanism: a purchase never touches the running machine. Purchases themselves are allowed any time.

Test helpers on `Game`: `currentPhase()`, `trayKeyIds()`, `pluggedKey()`, `inventoryItems()`, `canInstall(invId)` (ignores power), `missingCables()`.

## Phases

`snapshot.phase` is one of:

| Phase | Meaning |
|---|---|
| `off` | Not powered. The monitor is dark (`display` is empty). |
| `posting` | The ROM is running its power-on self-test and printing lines. Also shown during the reboot after every job. |
| `waiting-for-key` | POST done, the monitor says INSERT KEY, the ROM polls the USB status register. |
| `loading` | A key is plugged: the ROM copies its program into RAM. `bootProgress` moves from 0.4 to 1. |
| `running` | The job runs. |
| `writing` | The job finished; the ROM copies the result line to the key. |
| `done-remove-key` | The key holds its result, the monitor says REMOVE KEY, the ROM polls for removal. |
| `error` | Powered but stopped; `phaseReason` says why (below). |
| `booting-os`, `idle-os`, `ingesting`, `running-os`, `flashing` | Only with an OS installed, see [`OS.md`](OS.md). |

Order for one job: `posting`, `waiting-for-key`, `loading`, `running`, `writing`, `done-remove-key`, then (key removed) `posting` again. The phase is the ROM's own `PHASE` register (its stores), except `off` and `error`, which the game decides.

## Power and POST

- **Power button, off to on**: refused (`ok: false`, nothing happens, `noPowerReason` in the snapshot) unless a PSU is installed (not burnt) and the 24-pin ATX cable is connected. This is "no power at all".
- **POST** (the PCH's own self-test, before the CPU is released): needs a working CPU, the 8-pin CPU power cable, and at least one working RAM stick. If one is missing the machine is powered but halted in phase `error`, no CPU activity (`pipe` is null), and the PCH prints `POST FAILED: NO CPU` / `NO CPU POWER` / `NO RAM` on the monitor if the video cable is connected. The player powers off, fixes it and powers on. `postBlocker` in the snapshot says what would fail, live.
- **Monitor**: decision: a missing monitor or video cable does **not** stop the boot. The machine powers on and runs headless; `monitorLive` is false and `display` is empty. (The PCH error text is also invisible then.) The tutorial gates on `videoConnected`.
- **Other `error` causes at run time**: PSU overload trip (`phaseReason` mentions power cycle; `powerButton()` off or `powerCycle()` clears it), burnt CPU or PSU. All need a power-off to repair.
- **Power button, on to off**: always works, in any phase. A plugged key stays plugged; its job restarts from boot at the next power-on (a finished key stays finished and shows REMOVE KEY).
- A **thermal error** (CPU in its unstable range) crashes the machine: it cold-reboots, the plugged key's job restarts, `errors` and the key's `attempts` count up, no payout for the attempt.
- Boot time and heat: while posting/loading/running/writing the CPU is at full load; while waiting for a key, showing REMOVE KEY, or in error, the thermal model gets `idleLoad`. Powered off, nothing draws and the parts cool.

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

ROM flow: `reset`/`boot` blanks the screen and acknowledges any earlier removal, writes PHASE=posting, prints `PCH BIOS 1.0`, `CPU T<tier> OK`, `RAM <kb>K OK`, `USB OK` (packed word stores to the display, RAM size through the `print_dec` kernel), sets PHASE=waiting and prints `INSERT KEY`, then polls STATUS. With a key: PHASE=loading, `LOADING JOB`, copies `KEY_LEN` words from the key window to RAM at `USER_BASE` (lw/sw loop), PHASE=running, `RUNNING JOB`, `jalr` to the program. The program ends by jumping to `ROM_DONE_VECTOR` (0x10), the `epilogue`: PHASE=writing, copies the job's output line (display row `JOB_ROW` 8, 8 words) into the result window, writes RESULT_LEN and DONE, PHASE=done, `REMOVE KEY`, polls STATUS until the key is gone (bit0 clear or the removal latch set), then `j reset`: the reboot. If the key already holds a result at boot (power cycled before removal) the ROM skips straight to REMOVE KEY.

The display rows during a job: 0-3 POST lines, 5 status line, 8 the job's own output.

### Generator convention (hosted programs)

`generate(template, seed, {hosted: true, row: JOB_ROW})` ends the program with `li t0, ROM_DONE_VECTOR; jalr zero, t0, 0` instead of `ecall`. Standalone programs (default) still end with `ecall` and run on the reference interpreter; all generator tests are unchanged. Payout `work` is the standalone instruction count. Hosted code is at most `MAX_CODE_BYTES` = 0x3000 so it ends below the scan buffer at 0x4000.

## Keys and the queue

- **Arrivals** (existing generator/economy, rates and mix in `ECONOMY`): a key arrives with probability `demandRate` per tick. It carries its job (`template`, `seed`, `scale`), a number the program prints on the monitor (`jobNo`, `#NN`), a type (`log`, `calc`, `checksum`, `scan`) and arrival/deadline ticks. Label: `#72 scan`. The program is generated when the key is plugged in.
- **The tray** is the queue, capped at `queueCap` (10). **Overflow**: an arrival into a full tray is dropped (`dropped++`); the client takes the key back, and that counts as a `giveUpTurnaround` (180 s) in the turnaround average, so reputation drops.
- **No clients before the first boot**: random arrivals start when `progress.poweredOn` first becomes true, and the keys waiting from the start get `arrival` = that tick. So assembling the PC does not cost reputation or lateness. After that the market does not wait for the player.
- `plugKey(keyId)`: moves the key from the tray into the USB port. **One program at a time**: refused while a key is plugged. Allowed in any phase including `off` (the ROM finds it at boot).
- A running job writes its result into the key. When the ROM signals done the key holds `result` (the exact output line, e.g. `#72 mul=31 OK`).
- `ejectKey()`: if the key holds a result, **the client collects it: payout and reputation are applied now**. `turnaround = removal tick - arrival`, `payout = round((payBase + payPerInstr * work * payMul) * speed * (late ? lateFactor : 1))`, `speed = clamp(targetTurnaround / turnaround, 0.5, 2)`. The reputation EMA takes this turnaround. If the job is **not finished**, the key goes back to the tray unserved (no payout, `attempts++`) and a machine that was loading, running or writing crashes and reboots.
- **Waits forever**: the machine never times out waiting for a key or for the removal. Reputation and demand decay while keys sit unserved: `reputation = clamp(target / max(avgTurnaround, age of the oldest waiting key))`, so an old key drags reputation down before it is even served. Idle time is lost income.
- **After removal** the ROM reboots the machine (POST visibly runs again) and waits for the next key. Decision: no power press between jobs (the loop stays short), but the reboot is per job, and **this is the seam for an OS later**: an OS removes the reboot (`done` would return to the OS instead of `j reset`) and allows concurrency (several programs/keys). The reboot lives only in the ROM's last instruction and in `Game.ejectKey`.
- **Offline catch-up does not apply**: without automation nothing runs while the player is away (the host already drops time beyond one frame). A later router/ethernet downloads workloads directly and uploads results. That seam is `WorkSource` in `src/sim/game/work.ts` (`offer`, `waiting`, `take`, `giveBack`); the USB tray (`UsbTray`) is the first implementation. The Game only uses the interface for arrivals and the waiting list.

## Storage and the OS (summary; the full description is [`OS.md`](OS.md))

Storage drives (`hdd0`, `ssd1`, `nvme2`) are bought into the inventory and installed into `sata` / `m2` slots (machine off). An OS (`os1`) is bought, then installed **onto a storage drive** (`install(invId, storageSlotId)`). Without an OS everything above (reboot per job, one key at a time) is unchanged. With an OS the ROM loads the kernel from the drive after POST and the machine boots **once**: phases `booting-os` -> `idle-os`, then `ingesting` (kernel copies a plugged key's job to disk; the player may unplug it), `running-os` (one program at a time), `flashing` (the finished key is plugged again and gets its result). Payout and reputation happen when the flashed key is removed. `Snapshot` additions: `storage[]`, `os` (tier, `programSlots`, `queueSlots`, queue), `held[]` (ingested keys the player holds), `keyActivity` (USB LED), `KeySnap.stage`, phases above, `inventory[].kind` / `purchases[].kind` may be `storage` or `os` (OS rows also carry `later`, `description`), progress flags `storageInstalled`, `osInstalled`, `firstOsJob`. New call `uninstallOs()` (message `uninstallOs`); new PCH registers `BOOT_DEV`, `OS_MODE`, `KEY_ID` and STATUS bits 3 (key enumerated) and 4 (flashing), only meaningful once the ROM handed over to a kernel.

## Snapshot (new fields; the rest is in [`GAME.md`](GAME.md))

```ts
phase: "off" | "posting" | "waiting-for-key" | "loading" | "running" | "writing" | "done-remove-key" | "error"
phaseReason: string | null          // for "error"
powered: boolean
bootProgress: number                // 0..1: POST 0..0.4, waiting 0.4, loading 0.4..1, 1 once the program runs
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
KeySnap = { id, template, type, jobNo, label, arrivalTick, deadlineTick, age, late, payoutEstimate, attempts, done, result }
```

- **Drop-target highlighting**: for an inventory item, `freeSlots` are the slot ids it fits right now (validated, including PSU watts) and `swapSlots` the occupied slots of the same kind it could replace. Both empty means it cannot be installed (see `reason`). `installable` is true if there is a target **and the machine is off**. For a board item `freeSlots` is `["board"]`. `slots` gives every slot with its occupant; the renderer matches `devices[].slot` to `slots[].id`.
- The old `request` (the plugged key's job), `queueLength` (tray size), `pipe` (pipeline stages while powered), `purchases` and `cpuClock` fields are kept. `pendingPurchases` is deprecated and always empty.

## Progress flags (tutorial)

`snapshot.progress`, persistent (saved), sticky once true, set only by real successful events:

`cpuInstalled`, `coolerInstalled` (a cooler was mounted; derived from the board when loading a save that lacks it), `psuInstalled`, `ramInstalled`, `monitorInstalled`, `storageInstalled` (an install of that kind succeeded), `atxConnected`, `cpuPowerConnected`, `videoConnected` (that cable connected), `poweredOn` (a real boot started: the power button was accepted and POST passed, not a refused press or a POST error), `firstKeyPlugged`, `firstJobDone` (the ROM wrote DONE to the key), `firstKeyEjected` (a finished key removed, paid), `firstPurchase` (a purchase succeeded), `osInstalled` (an OS was installed on a drive), `firstOsJob` (a job ingested by the OS was delivered). The last three were added in save v3 and stay false for migrated and preassembled games. The guided tutorial gates on these; `completed` is the job count.

## Pacing (starting machine, 1x)

Measured over 30 seeds with a bot that needs 2 s per manual step (`game.test.ts`): from power-on to the first payout **45-48 s** (POST ~10 s, then plugging the key to its result ~35 s: load ~19 s, run ~6 s, write ~9 s; plus the plug and unplug), first payout **$49-50** on every seed, the first $100 at **105-323 s** (median ~165 s). Because every job pays a flat `payBase` and boots first, the CPU is the big upgrade for log/calc/checksum jobs and RAM for scan jobs; see [`GAME.md`](GAME.md).

## Worker protocol and store

`ToSim` additions (`uninstallOs` came with the OS, see OS.md): `install {invId, slotId?}`, `uninstall {deviceId}`, `connectCable {cable}`, `disconnectCable {cable}`, `powerButton`, `plugKey {keyId}`, `ejectKey`. Each replies with a `snapshot`, preceded by an `error {message}` if it was refused (`"<call>: <reason>"`). `purchase` now means "buy to the inventory". Store functions (`src/game/store.ts`): `install`, `uninstall`, `connectCable`, `disconnectCable`, `powerButton`, `plugKey`, `ejectKey` (plus the existing `purchase`, `setCpuClock`, `powerCycle`, `setSpeed`, `exportSave`, `importSave`); a refusal lands in the `lastError` signal.

`src/ui/Shop.tsx` has a minimal "Machine" section (power, cables, install and remove buttons, plug/remove key) so the old UI stays playable until the drag-and-drop UI exists.

## Board ladder and the VRM (see [`VRM.md`](VRM.md))

The board has four tiers (Starter, Basic, Mainstream, Enthusiast); `Snapshot.board` holds the tier name, `features`, the slots it has, the `vrm` state and the installed heatsink. The VRM can crash the machine ("VRM voltage droop", same path as a thermal error, logged) and burn out: a burnt board gives phase `error` with reason **"board dead: replace the board"**, the power button refuses, the installed parts stay in their slots, and the fix is buying a board of the same or a higher tier (powered off) and installing it. The tutorial installs one RAM stick, which fits the Starter board's single DIMM slot (tested by the tutorial bot).
