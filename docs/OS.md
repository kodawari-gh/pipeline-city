# Storage and the OS (v1)

Code: `src/sim/machine/storage.ts` (block device), `src/sim/os/` (OS ladder data, kernel in toy-ISA asm, shared block-I/O asm), `src/sim/pch/` (ROM boot path, USB timers), `src/sim/game/game.ts` (install, queue view, snapshot). Tests: `src/sim/game/os.test.ts`, `src/sim/machine/storage.test.ts`. All numbers are placeholders.

## Storage devices

Storage is a device kind (`storage`) with a tier ladder (details in [`BOARD.md`](BOARD.md)): `hdd0` HDD 96K (SATA), `ssd1` SATA SSD 64K, `nvme2` NVMe SSD 128K (M.2). A drive is installed into a typed `sata` or `m2` slot like any part. The board has fixed bus windows for the three possible storage slots (`sata0`, `sata1`, `m20`, `STORAGE_PORTS`); installing a drive attaches its media to the port of its slot.

A port is a **memory-mapped block device** (`StoragePort`, window `STORAGE_BASE + k * 0x1000`), blocks of 256 bytes (64 words):

| Offset | Name | |
|---|---|---|
| 0x00 | STATUS | ro: bit0 busy, bit1 error (bad block, no media, command while busy), bit2 media present |
| 0x04 | LBA | rw: block address (written byte-wise, so a full word store works) |
| 0x08 | CMD | wo: 1 read LBA into the buffer, 2 write the buffer to LBA. Fires on the write |
| 0x0C | BLOCKS | ro: capacity in blocks |
| 0x100 | buffer | 256-byte data window |

Timing is simulated in the drive's **own clock domain** (named after the slot): a command is busy for `latencyTicks` (skipped when the block is the one right after the previous command, i.e. sequential access) plus `blockTicks`. The domain runs at the part's (thermally throttled) clock times `cpuCyclesPerClock` (36), like the CPU, so a device tick is about one toy-CPU cycle. Reads/writes only happen when the busy count runs out; the CPU polls STATUS. Stats (`bytesRead`, `bytesWritten`, used blocks, busy ticks) are counted from real commands. Measured sequential read of 8 blocks: HDD roughly 36 s, SATA SSD 5 s, NVMe 1 s (the HDD's seek alone is 20 s).

Power and heat: the drive's `idleW/loadW` count against the PSU rated load at install time and in the thermal model (load follows port activity). **SATA power/data rule (kept simple):** a SATA drive only needs a free `sata` slot and PSU watts; there is no separate connector count. NVMe needs the `m2` slot (ATX+ board). A burnt drive drops off the bus; if it holds the OS the machine goes to `error`.

## The OS ladder

`OS_SPECS` in `src/sim/os/specs.ts` is data: `{id, tier, name, description, price, minRamBytes, diskBytes, programSlots, queueSlots, later?}`.

| id | tier | state | RAM | disk | programSlots | queueSlots |
|---|---|---|---|---|---|---|
| `os1` Resident OS 1.0 | 1 | **implemented** | 32K | 12K | **1** | 4 |
| `os2` Cooperative OS | 2 | `later`: description only, cannot be bought or installed | 64K | 24K | 2 | 8 |
| `os3` Preemptive OS | 3 | `later` | 64K | 48K | 4 | 16 |

An OS is bought into the inventory like a part, then **installed onto a storage device** (`install(invId, slotId)` where `slotId` is the storage slot, or omitted for the first drive that qualifies). Requirements (checked at install, and shown as `blocked` reasons on the purchase): installed RAM >= `minRamBytes`, a working drive with `diskBytes` plus one job's spool area free. Install is instant and only while the machine is off; it writes the boot image and reserves `diskBytes` of the drive (capacity used, `bytesWritten`). One OS at a time. `uninstallOs()` (off only) wipes the drive's OS and returns the item to the inventory. A drive that holds the OS cannot be uninstalled or swapped. Progress flags: `storageInstalled`, `osInstalled`, `firstOsJob`.

**Slot seam:** the number of concurrent programs is the data field `programSlots` (always 1 for v1). It is written into the boot header and the kernel checks it before starting a job. The queue bound is `queueSlots` further limited by free disk (`queueSlotsFor`, each job reserves a 4 KiB spool area) and by the kernel table (8).

## Boot: the PCH ROM loads the kernel

POST is unchanged (a failed POST waits out the cold-boot wait before its text, see [`ASSEMBLY.md`](ASSEMBLY.md)). Then the ROM reads `PCH_REG.BOOT_DEV` (the port base of the OS drive, or 0). With 0 the ROM runs the per-key loader exactly as before (`ASSEMBLY.md`). Otherwise phase `OsBoot` ("BOOTING OS"): the ROM reads **block 0 (boot header)** with real loads/stores on the block device, checks the magic, then reads the remaining blocks sequentially into RAM at `OS_HEADER_BASE` 0xC000 (header) / `KERNEL_BASE` 0xC100 (kernel image), sets `OS_MODE` and jumps to the kernel. Boot time therefore depends on the CPU (copy loops), the drive (seek once, then per block) and the clock. Measured (kernel 276 words, 6 blocks): cpu1 boots in 74 s from HDD, 46 s from SATA SSD, 43 s from NVMe; cpu2: 52, 24, 21 s. Tested ordering NVMe < SSD < HDD.

Boot header (block 0, words): magic `OVS1`, total blocks, queue slots, program slots, spool start block, spool blocks per job, OS tier.

## The kernel (`src/sim/os/kernel.ts`)

Written in toy-ISA asm, assembled at import. Vectors: `KERNEL_BASE+0` boot, `+4` job-done (the ROM epilogue jumps there when `OS_MODE` is set, so jobs still end with the usual jump to `ROM_DONE_VECTOR`). It keeps a **job table in RAM** at `KDATA_BASE` 0xE000: 8 slots of 64 bytes (`state, key id, length in words, spool block, 8 result words, sequence`). States: free, queued (2), running (3), result (4). Loop, forever:

1. A key is plugged and **enumerated** (USB latency, see below): if its id has a slot with a result and the flash has not landed, **flash** it (copy result to the PCH result window, write DONE); if the flash landed (STATUS bit1), free the slot. A key with a slot that is queued/running is left alone. An unknown key without a result is **ingested**: if a slot is free and the queue is under its bound, the kernel copies the key's program from the PCH key window into the **spool on disk** (`blk_write` per block), then fills the slot and queues it. If the key is pulled during the copy, or the queue is full, nothing is queued.
2. Otherwise run the **oldest queued job** (lowest sequence) if fewer than `programSlots` jobs run: read its blocks from the spool into RAM at `USER_BASE`, clear the job's output row, `jalr` into it. Non-preemptive: **one program at a time**; ingest and flash wait until it ends (a long job delays ingest, which is the cost of a single-task OS).
3. `kdone` saves the job's output line (display row `JOB_ROW`) into the slot as the result, state = result.

The kernel writes the PCH `PHASE` register (`OsBoot 7, OsIdle 8, OsIngest 9, OsRun 10, OsFlash 11`), which the game maps to the phases below. The kernel table lives in RAM: **the table is RAM, but the jobs are spooled on the drive** (changed with the network phase, [`NETWORK.md`](NETWORK.md) "Power loss"): network jobs the OS ingested stay spooled through a power-off or a crash, and at the next boot the game re-ingests them in order through a virtual key, so the queue is rebuilt without the player; a running job restarts from its beginning and a finished result that was only in RAM is produced again.

## The output step (the rule chosen)

**The key stays in while the OS works (2026-10-24: held keys are gone).** The player plugs a key; the OS ingests it (enumerate and copy to disk), runs the job and flashes the result back onto the same key; `autoEject` then pops the key out by itself a few ticks after the flash, the client collects it and **payout and reputation are applied then**. The machine stays on and takes the next key as soon as it is plugged. `ejectKey` is refused while the OS has the job (`the OS is working on this job`); with the machine off the key can be pulled and returns to the tray, and its job runs again later. There is no rack of held keys and no second plug, and `Snapshot.held` and the rack art are gone. The single port means one USB job at a time; the queue slots are for network jobs (`WorkSource`), which need no key.

**Unrunnable jobs and declining** (docs/PROGRESSION.md): a key whose `needs` are not met (a `db` job needs an OS and a SATA SSD or better; the placeholder classes need devices that do not exist) is refused at the port by `plugKey` (`cannot run this job: ...`), which is the refusal at ingest; it waits in the tray and expires. A key the OS has ingested but not started (`queued`) can be declined (`declineKey` / `declineJob` by key id): the kernel's slot is freed and the OS goes on. A running job and a result waiting for collection cannot be declined. The OS behaviour itself is unchanged by levels. The spool survival rule is above; the network feed uses the same ingest path (a virtual key), see NETWORK.md "Built".

**USB latency** (what the network unlock removes): a plugged key needs `usbEnumTicks` (3 s) to enumerate before the kernel may read it; a flash takes `usbFlashTicks` (2 s) to land. Both are 0 without an OS. LED: snapshot `keyActivity` = `none | enumerating | ingesting | flashing | done`.

## Phases (OS mode)

`booting-os` (ROM loading the kernel; `bootProgress` 0.4..1 by blocks read), `idle-os` (kernel polling), `ingesting`, `running-os`, `flashing`. Plus `off`, `posting`, `error`. The no-OS phases (`loading`, `running`, `writing`, `halted`) only occur without an OS; there the ROM looks at the USB port once at boot and halts after the job (see [`ASSEMBLY.md`](ASSEMBLY.md)). With an OS the machine boots once; there is no reboot per job. A key already plugged when an OS machine is powered on is enumerated and ingested at idle like a hot-plugged one (`os.test.ts`). **Why buy the OS**: it removes the per-job cold boot (`ECONOMY.coldBootTicks`), the manual power cycle and the one-key-at-boot rule; the patience schedule (GAME.md) makes the manual loop unsustainable later.

## Snapshot and API additions

- `purchase("hdd0"|"ssd1"|"nvme2"|"os1")` (+ locked `os2`, `os3` in `purchases` with `later: true`, `description`, `blocked`). `PurchaseSnap.kind` may be `storage` or `os`.
- `install(invId, slotId?)`: storage into `sata`/`m2` slots as usual; for an OS item `slotId` is a storage slot id. `InventorySnap.kind` may be `storage` or `os`; for an OS, `freeSlots` are the storage slots it can go on. New `Game.uninstallOs()`; worker/store message `uninstallOs`.
- `Snapshot.storage[]`: `{deviceId, slot, spec, name, burnt, capacityBytes, usedBytes, bytesRead, bytesWritten, busy, latencyTicks, blockTicks, bytesPerSecond, hasOs}`.
- `Snapshot.os`: `null` or `{spec, tier, name, deviceId, slot, programSlots, queueSlots, up, queue[], runningKeyId}`; `queue[]` rows `{slot, keyId, label, state: queued|running|result, ahead}` in run order (running, queued by ingest order, results awaiting delivery with `ahead: -1`).
- `KeySnap.stage` (`tray | ingesting | queued | running | result | flashing | done`), `Snapshot.keyActivity`, new `phase` values, new `progress` flags.

## Test coverage

`os.test.ts`: buying/installing gating, boot by tier and by CPU, kernel image in RAM, no-OS flow unchanged with a drive installed, ingest/run/flash/deliver, boot once, ingest time by tier, key pulled mid-ingest, result pulled mid-flash, one-at-a-time and FIFO and queue bound, power loss, determinism, save round trip. `storage.test.ts`: registers, latency, sequential access, errors, tier ordering of latency and throughput.

## What the renderer and UI still need (next phase)

Renderer (`src/render`): drive art for `hdd`, `ssd-sata`, `ssd-nvme` (visual keys on the specs) in the `sata0`/`sata1`/`m20` slots of both board tiers (the slot ids now exist in `Snapshot.slots` with types `sata` and `m2`); activity on `storage[].busy` (platter spin / flash LEDs) and the SATA/M.2 traces to the chipset; the new boot flow on the monitor (`BOOTING OS`, `OS READY`, `INGESTING`, `RUNNING JOB`, `FLASHING` lines are real display text); USB port LED from `keyActivity` (enumerating, ingesting, flashing, done); bus flow for phases `booting-os` (drive to RAM), `ingesting` (key to drive), `running-os`, `flashing` (drive to key).

UI (`src/ui`): shop and inventory rows for kinds `storage` and `os` (OS rows have `later`, `description`, `blocked`; show `os2`/`os3` locked with their description); drop targets for an OS are the storage slots in `InventorySnap.freeSlots` (drag an OS onto a drive); picker/stats for storage (capacity, used, latency, throughput `bytesPerSecond`, read/written) from `Snapshot.storage`; status chip texts for the five new phases (stubbed); an OS panel from `Snapshot.os` (name, tier, `programSlots`, `queueSlots`, the queue rows with state/`ahead`, which job runs); an "uninstall OS" action (`uninstallOs`); tutorial steps for the three new progress flags; hints for a full queue (a plugged key stays `stage: "tray"` while the queue is at `queueSlots`).

## Memory protection

A small **MPU** (`src/sim/machine/mpu.ts`, registers at `MPU_BASE`, `docs/CPU.md` map) keeps jobs out of the OS. The kernel programs two protected ranges at boot (the boot ROM `[0, USER_BASE)`, and the OS header, kernel and job table `[OS_HEADER_BASE, end of the table)`) and switches the unit on just before it jumps to a job; it is off while the kernel runs (`kdone` and `kfault` switch it off first). A store into a protected range is **dropped** and trips the unit; the machine stops fetching, lets the pipeline drain (what the job still has in flight does not land either), and sends the CPU to `KERNEL_FAULT` (`KERNEL_BASE + 8`). `kfault` ends the job the way an OS kills a process: the slot's result becomes `SEGFAULT`, the state is `Result`, and the kernel loop goes on (the result is flashed to the key like any other, and does not match the expected output, so the client is not paid). The game counts the fault (`Snapshot.faults`, this session only: not saved) and logs it. Everything else a job writes is its own: it claims memory by writing it (docs/DIE.md "Memory"). Generated jobs never fault (tested); `fault.test.ts` runs a job that scribbles over the kernel.
