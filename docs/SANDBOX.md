# Sandbox mode

A sandbox game is a campaign game with the money and the tutorial taken out, and a few tools added for trying ideas fast. **The physics stays.** Slots, watts, cooling, the VRM and the power-off rule all still apply; the sandbox only removes what costs time and money.

Code: `src/sim/game/game.ts` (the `sandbox` option, the sandbox tools, the purchase rules), `src/sim/game/economy.ts` (`SANDBOX_MONEY`, `sandboxOffers`), `src/sim/protocol.ts` (`SANDBOX_SPEEDS`), `src/sim/host.ts` (the 64x refusal and the catch-up cap), `src/sim/game/save.ts` (the optional `sandbox` field), `src/game/store.ts` (`startSim` options and the tool actions), `src/ui/NewGame.tsx` (the dialog), `src/ui/SandboxTools.tsx` (the chip and its tools), `src/ui/Hud.tsx` (the infinity sign), `src/ui/tutorial.ts` (no tutorial). Tests: `src/sim/game/sandbox.test.ts`, `src/ui/tutorial.test.ts` (the sandbox cases).

## Starting one

The **New game** dialog (menu, or the Welcome back prompt's New game) offers two choices:

- **Campaign**: a bare board and the starter crate, the tutorial, money you earn and spend.
- **Sandbox**: then pick **Assembled machine** (every part installed and cabled, powered off, ready for the power button) or **Bare board** (the same crate as the campaign, in the inventory, nothing installed).

In code: `startSim(null, { sandbox: true, preassembled: assembled })`, which becomes `new Game({ sandbox: true, preassembled })`. A new sandbox game starts with every progress flag set. `currentStep` and `offerNextLesson` return nothing for a sandbox game, so no tutorial card and no "Next lesson: the OS" offer appear, even though the flags look like a finished campaign.

## What is unlocked

- **Money** is a constant, `SANDBOX_MONEY` = 1,000,000,000. The sim never spends or earns it (income is added only `if (!sandbox)`), and the HUD shows an infinity sign instead of the number.
- **Prices are free.** `cost()` returns 0 in a sandbox, the picker reads "free" instead of a price, and nothing is unaffordable.
- **Every implemented part can be bought**, at any tier, not only the next one. `sandboxOffers` lists every spec of the buyable kinds (CPU, RAM, cooler, PSU, VRM heatsink), including the ones you already have (a swap). Storage drives (`hdd0`, `ssd1`, `nvme2`) and the OS tiers that are not "later" (`os1`) are listed as well, and can be bought more than once; the slots still limit them.
- **Any motherboard tier directly**: every tier above the installed one, and the same tier as a replacement when the board is burnt (`sandboxOffers`). A board purchase still needs the machine powered off.
- **Nothing else changes in the game rules**: the reputation, demand, keys and patience schedule run as in a campaign.

## What the physics still enforces

- **Slots**: a part fits only a free socket of its type (CPU, DIMM, PCIe, SATA, M.2, USB, cooler, monitor, ATX, ATX+, VRM heatsink). A tier without a slot type has none of it; the drive counts are limited by the free SATA or M.2 slots.
- **Power**: the PSU's watts against the parts' rated load, and the connector (a PSU with the ATX+ connector needs the ATX+ board). The power button is refused without a PSU and the 24-pin cable, as in the campaign.
- **Cooling**: the CPU's heat and throttle rules, the cooler mounts on the CPU, and the VRM heatsink and liquid-cooler rules.
- **VRM limits**: phases, amps and the crash and burn-out behaviour (`docs/VRM.md`). A board that burns out is dead until you buy a board of the same or a higher tier; the sandbox's `repairAll` can revive it instead.
- **Powered-off installs**: parts, cables, boards, storage and the OS change only while the machine is off (`power the machine off first`).
- **OS RAM minimum and drive needs**: an OS needs its minimum RAM in the plan and a drive to install on (`needs 32K of RAM`, `install a storage drive first`).
- **Keys**: one USB key is read at a boot, the tray holds `queueCap` (10) keys, and the OS queue has its own slots.

## What stays locked

- **Later OS tiers** (`os2`, `os3`) are listed as "planned: not available yet" in every game. The sandbox does not unlock them.
- **Things that are not built** are not in the sandbox either: there is no network card, router or GPU yet (see `docs/HANDOVER.md`, next steps).
- The monitor has one spec, so there is nothing to buy for it.

## Sandbox tools

Shown as the **SANDBOX** chip in the HUD bar. Each is a `ToSim` message and a `Game` method, refused with `sandbox mode only` outside a sandbox game (`NOT_SANDBOX`):

| Tool | What it does |
|---|---|
| `spawnKey(template, scale)` | Adds a key with a generator template (for example `cli`, `cli.log`, `cli.scan`) at scale 1 to 16 to the tray. Refused when the tray is full. |
| `clearQueue()` | Throws away every key in the tray. The plugged key and the keys the OS holds stay. |
| `repairAll()` | Un-burns every part and the board, cools everything to ambient, clears a PSU trip. Works powered or not. |
| `setReputation(value)` | Sets reputation within the economy's range (0.4 to 4). The turnaround average is set to match, and it moves as usual afterwards. |

The store actions are `spawnKey`, `clearQueue`, `repairAll` and `setReputation` in `src/game/store.ts`.

## Speed

The speed segment in the HUD offers the campaign speeds (II, 1x, 4x, 16x). A sandbox also has **64x**, toggled from the SANDBOX chip (`SANDBOX_SPEEDS`). `setSpeed(64)` is refused in a campaign game (`64x is for the sandbox only`).

The catch-up cap is `MAX_TICKS_PER_FRAME` = **128** base ticks per call, in every game (`host.ts`). The worker calls every 100 ms, so 64x needs about 6.4 ticks per call; the cap only matters after a throttled tab. **64x has not been benchmarked**: the cost of a 64x tick on a fully built machine is unmeasured.

## Saves

A sandbox game writes an optional top-level field `sandbox: true` (`Game.toSave`). A save without it loads as a campaign game, as before. `SAVE_VERSION` stays **4**: the field is optional and validated as a boolean (`parseSave`), so no migration is needed. Loading a sandbox save sets money back to `SANDBOX_MONEY`. See [`SAVE.md`](SAVE.md).

## Tests

`src/sim/game/sandbox.test.ts` covers the free and constant-money rules, the offers (any tier, replacement of a burnt board), the physics that still applies, the tools and their refusals outside a sandbox, the 64x refusal, the sandbox save field and the assembled and bare starts. `src/ui/tutorial.test.ts` covers "a sandbox game has no tutorial and no offer".
