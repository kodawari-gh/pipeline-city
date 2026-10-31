// Game feature: building the machine. Install and uninstall parts, the queued swap, cables, the inventory and its
// snapshot, clocks, and the sandbox's maximum rig. Every export is a `Game` method (see game.ts).

import {
  boardFromJson, boardSlots, boardToJson, BOARD_TIERS, cableName, cablesOf, cableNeeded, CASE_TIERS, cableBlocked, caseFor, caseHolds,
  connectCable as boardConnect, deviceSpec, disconnectCable as boardDisconnect,
  findDevices, freeSlots, getSpec, install as boardInstall, pruneCables, setClock, slotAccepts, slotFitsWidth, slotRefusal,
  specsOfKind, uninstall as boardUninstall, upgradeBoard, upgradeCase,
  type Board, type CableId, type DeviceKind, type DisplaySpec, type InstalledDevice,
} from "..";
import { getRouterSpec, ISP_SPECS, ROUTER_SPECS, routerByTier, type RouterSpec } from "@/features/network/sim";
import { getOsSpec, OS_SPECS } from "@/features/os/sim";
import { boardTierOf, caseTierOf, caseTooSmall, sellValue } from "@/features/economy/sim/economy";
import type { Game } from "@/worker/game/game";
import type { InvItem } from "@/worker/game/internal";
import type { Progress } from "@/worker/game/save";
import type { InventorySnap, Result } from "@/worker/game/types";

/**
 * The most powerful machine the game supports, built from the starter one with the sandbox's free purchases: the biggest case and board, the best CPU, cooler,
 * PSU and heatsinks, every DIMM slot filled with the best RAM, every M.2 slot with the fastest drive, the fastest network card, the best OS that is implemented, the
 * best router and ISP plan, and the ethernet cable on the card. Left powered off, with the other cables connected. "Best" is the top of each part's ladder
 * (`specsOfKind`, the tier tables), so a new tier is picked up without touching this.
 */
export function buildMaxRig(this: Game): void {
  const ok = <T>(what: string, r: Result<T>): T => {
    if (!r.ok) throw new Error(`maximum machine: ${what}: ${r.reason}`);
    return r;
  };
  const put = (spec: string, slot?: string) => ok(`install ${spec}`, this.install(ok(`buy ${spec}`, this.purchase(spec)).invId, slot));
  const top = (kind: DeviceKind): string => { const l = specsOfKind(kind as "cpu"); return l[l.length - 1]!.id; };
  const boardTier = BOARD_TIERS.length - 1, slots = BOARD_TIERS[boardTier]!.slots;
  put(`case${CASE_TIERS.length - 1}`);
  put(`board${boardTier}`);
  for (const kind of ["psu", "cpu", "cooler", "vrm-sink", "ram-sink"] as const) put(top(kind));
  put(top("radiator"), "rad-top");
  for (let i = 0; i < (slots.dimm ?? 0); i++) put(top("ram"), `dimm${i}`);
  // the top plain drive: a RAID module cannot hold the OS
  const bootDrive = specsOfKind("storage").filter((s) => !s.mirror).pop()!.id;
  for (let i = 0; i < (slots.m2 ?? 0); i++) put(bootDrive, `m2${i}`);
  put(top("nic"));
  const os = [...OS_SPECS].reverse().find((o) => !o.later);
  if (os) put(os.id);
  put(ROUTER_SPECS[ROUTER_SPECS.length - 1]!.id);
  ok("buy the ISP plan", this.purchase(ISP_SPECS[ISP_SPECS.length - 1]!.id));
  const nic = this.board.devices.find((d) => deviceSpec(d).kind === "nic");
  if (nic) ok("plug the ethernet cable", this.connectCable("lan", nic.id));
  // swaps can unplug a cable whose source part changed: plug the others again
  for (const c of cablesOf(this.board)) if (c.id !== "lan" && !this.cables[c.id] && cableNeeded(this.board, c.id)) ok(`plug ${c.id}`, this.connectCable(c.id));
  this.log = [];
}

/**
 * Install an inventory item. With a `slotId` it goes there (a free slot, or an occupied slot of the same kind to
 * swap: the old part returns to the inventory, a burnt one is scrapped). Without, the first free compatible slot,
 * else it swaps with the installed part of its kind. A board item (`board1`) upgrades the board in place and
 * carries every part over. Only while the machine is off. Unplugs cables whose source part left.
 */
export function install(this: Game, invId: string, slotId?: string): Result<{ deviceId: string | null; slot: string }> {
  const item = this.inventory.find((i) => i.id === invId);
  if (!item) return { ok: false, reason: `no inventory item "${invId}"` };
  const routerSpec = getRouterSpec(item.spec);
  if (routerSpec) return this.installRouter(item, routerSpec, slotId);
  if (this.powered) return { ok: false, reason: "power the machine off first" };
  const osSpec = getOsSpec(item.spec);
  if (osSpec) return this.installOs(item, osSpec, slotId);
  const caseTier = caseTierOf(item.spec);
  if (caseTier !== undefined) {
    const was = this.board.caseTier;
    const r = upgradeCase(this.board, caseTier);
    if (!r.ok) return r;
    this.removeItem(item.id);
    this.inventory.push({ id: `inv${this.nextInvId++}`, spec: `case${was}` }); // the case it replaced is a spare now
    this.note("install", `${CASE_TIERS[caseTier]!.name} installed: the board and every part moved in`);
    return { ok: true, deviceId: null, slot: "case" };
  }
  const tier = boardTierOf(item.spec);
  if (tier !== undefined) {
    const was = this.board.tier, dead = !!this.board.burnt;
    if (this.caseGated() && !caseHolds(this.board, tier)) return { ok: false, reason: caseTooSmall(this.board, tier) };
    const r = upgradeBoard(this.board, tier);
    if (!r.ok) return r;
    if (!caseHolds(this.board, tier)) this.board.caseTier = caseFor(tier); // ungated: the case follows the board
    this.removeItem(item.id);
    if (!dead) this.inventory.push({ id: `inv${this.nextInvId++}`, spec: `board${was}` }); // the board it replaced is a spare now (a dead one is scrapped)
    this.note("install", `${BOARD_TIERS[tier]!.name} installed`);
    return { ok: true, deviceId: null, slot: "board" };
  }
  const r = this.placeInto(this.board, item.spec, slotId);
  if (!r.ok) return r;
  this.removeItem(item.id);
  if (r.replaced) {
    const old = r.replaced;
    this.disks.delete(old.id);
    if (!old.burnt) this.inventory.push({ id: `inv${this.nextInvId++}`, spec: old.spec });
  }
  this.afterBoardChange();
  this.flagInstalled(getSpec(item.spec)!.kind);
  this.note("install", `${getSpec(item.spec)!.name} installed in ${r.slot}`);
  return { ok: true, deviceId: r.id, slot: r.slot };
}

/**
 * The player's install: no manual power cycling. Off: install. On and idle: power off, install, power back on (a
 * refusal to boot is reported). On and working a job: queue the swap, it happens the moment the job is done
 * (`pendingSwap` in the snapshot). `install` stays the strict, powered-off primitive.
 */
export function swapInstall(this: Game, invId: string, slotId?: string): Result<{ pending: boolean }> {
  const item = this.inventory.find((i) => i.id === invId);
  if (!item) return { ok: false, reason: `no inventory item "${invId}"` };
  if (getRouterSpec(item.spec) || !this.powered) {
    const r = this.install(invId, slotId);
    return r.ok ? { ok: true, pending: false } : r;
  }
  const snap = this.inventorySnap().find((i) => i.id === invId)!;
  if (!snap.installable) return { ok: false, reason: snap.reason ?? "nowhere to put this" };
  if (this.jobInFlight()) {
    this.pendingSwap = { invId, slotId };
    this.note("install", `${snap.name} will be swapped in as soon as the job is done`);
    return { ok: true, pending: true };
  }
  return this.swapNow(invId, slotId, snap.name);
}

/** A job the machine would lose (or hold up) if it powered off now. */
export function jobInFlight(this: Game): boolean {
  if (this.netKey) return true;
  if (this.os && this.kernelJobs().length > 0) return true;
  return !!this.plugged && !this.plugged.done;
}

/** Power off (paying a finished key first), install, and power back on when it was on. */
export function swapNow(this: Game, invId: string, slotId: string | undefined, name: string): Result<{ pending: boolean }> {
  if (this.plugged?.done) this.ejectKey();
  const wasOn = this.powered;
  if (wasOn) this.powerButton();
  const r = this.install(invId, slotId);
  if (!r.ok) {
    if (wasOn) this.powerButton();
    return r;
  }
  if (wasOn) {
    const on = this.powerButton();
    if (!on.ok) return { ok: false, reason: `${name} installed, but the machine cannot start: ${on.reason}` };
  }
  return { ok: true, pending: false };
}

export function applyPendingSwap(this: Game): void {
  const p = this.pendingSwap;
  if (!p || this.jobInFlight()) return;
  this.pendingSwap = null;
  const snap = this.inventorySnap().find((i) => i.id === p.invId);
  if (!snap || !snap.installable) { this.note("install", "the queued swap was dropped: it no longer fits"); return; }
  const r = this.swapNow(p.invId, p.slotId, snap.name);
  if (!r.ok) this.note("fault", r.reason);
}

/** The router is external (own power): it goes into its spot, or comes out, whether the PC is on or off. */
export function installRouter(this: Game, item: InvItem, r: RouterSpec, slotId?: string): Result<{ deviceId: string | null; slot: string }> {
  if (slotId !== undefined && slotId !== "router") return { ok: false, reason: `${r.name} goes into the router spot next to the monitor, not "${slotId}"` };
  if (this.routerTier === r.tier) return { ok: false, reason: `a ${routerByTier(this.routerTier)!.name} is already in the router spot` };
  const old = routerByTier(this.routerTier);
  if (old) this.inventory.push({ id: `inv${this.nextInvId++}`, spec: old.id });
  this.removeItem(item.id);
  this.routerTier = r.tier;
  this.progress.routerInstalled = true;
  this.note("install", `${r.name} placed next to the monitor`);
  return { ok: true, deviceId: null, slot: "router" };
}

/** Take an installed part out; it goes to the inventory (a burnt part is scrapped). Only while off ("router" comes out any time). */
export function uninstall(this: Game, deviceId: string): Result<{ invId: string | null }> {
  if (deviceId === "router") {
    const old = routerByTier(this.routerTier);
    if (!old) return { ok: false, reason: "no router is installed" };
    this.routerTier = 0;
    this.cables.lan = false;
    this.lan = null;
    const invId = `inv${this.nextInvId++}`;
    this.inventory.push({ id: invId, spec: old.id });
    this.note("install", `${old.name} removed`);
    return { ok: true, invId };
  }
  if (this.powered) return { ok: false, reason: "power the machine off first" };
  const dev = this.board.devices.find((d) => d.id === deviceId);
  if (!dev) return { ok: false, reason: `no installed device "${deviceId}"` };
  if (this.os?.deviceId === deviceId) return { ok: false, reason: `the OS is installed on ${deviceSpec(dev).name}: uninstall the OS first` };
  const r = boardUninstall(this.board, deviceId);
  if (!r.ok) return r;
  this.disks.delete(deviceId);
  let invId: string | null = null;
  if (!dev.burnt) {
    invId = `inv${this.nextInvId++}`;
    this.inventory.push({ id: invId, spec: dev.spec });
  }
  // The cooler mounts on the CPU: taking the CPU out takes the cooler with it, back into the inventory.
  if (deviceSpec(dev).kind === "cpu" && !findDevices(this.board, "cpu").length) {
    for (const c of findDevices(this.board, "cooler")) {
      boardUninstall(this.board, c.id);
      if (!c.burnt) this.inventory.push({ id: `inv${this.nextInvId++}`, spec: c.spec });
      this.note("install", `${deviceSpec(c).name} removed with the CPU`);
    }
  }
  this.afterBoardChange();
  this.note("install", `${deviceSpec(dev).name} removed`);
  return { ok: true, invId };
}

/** Plug a cable in (needs its source part installed). Only while off. */
export function connectCable(this: Game, cable: string, port?: string): Result<{ cable: CableId }> {
  if (cable === "lan") return this.connectLan(port);
  const wall = cable === "pcmains" || cable === "monmains";
  if (this.powered && !wall) return { ok: false, reason: "power the machine off first" };
  // The video cable goes to the board's HDMI port, or to a display port on a GPU's bracket (graphics display only).
  const to = cable === "video" ? (port ?? "board") : "board";
  if (to !== "board") {
    const card = this.board.devices.find((d) => d.slot === to && deviceSpec(d).kind === "gpu");
    if (!card || card.burnt) return { ok: false, reason: `no working graphics card in "${to}"` };
    const disp = findDevices(this.board, "display")[0];
    if (!disp || !(deviceSpec(disp) as DisplaySpec).graphics) return { ok: false, reason: "a text monitor has no picture to show a graphics card: install the graphics display" };
  }
  const r = boardConnect(this.board, this.cables, cable);
  if (!r.ok) return r;
  if (cable === "video") this.video = to;
  const flag = ({ atx: "atxConnected", cpu: "cpuPowerConnected", video: "videoConnected" } as Record<string, string>)[r.cable] as keyof Progress | undefined;
  if (flag) this.progress[flag] = true;
  if (wall) {
    this.machine.display.connected = this.monitorLive();
    if (this.cables.pcmains && this.cables.monmains) this.progress.mainsConnected = true;
  }
  this.note("cable", `${cableName(r.cable)} connected`);
  return r;
}

/** The ethernet cable runs from a port (the board jack, or a NIC card jack) to the router. Allowed while the machine is on. */
export function connectLan(this: Game, port?: string): Result<{ cable: CableId }> {
  if (this.cables.lan) return { ok: false, reason: "Ethernet cable is already connected" };
  if (!this.routerTier) return { ok: false, reason: "needs a router: install one next to the monitor first" };
  const nics = this.board.devices.filter((d) => deviceSpec(d).kind === "nic" && !d.burnt);
  const onboard = BOARD_TIERS[this.board.tier]!.features.ethernetMbps > 0;
  const pick = port ?? (onboard ? "board" : nics[0]?.id);
  if (!pick) return { ok: false, reason: "no network port: this board has no ethernet jack and no network card is installed" };
  if (pick === "board") {
    if (!onboard) return { ok: false, reason: `the ${BOARD_TIERS[this.board.tier]!.name} board has no ethernet jack` };
  } else if (!nics.some((d) => d.id === pick)) {
    return { ok: false, reason: `no working network card "${pick}"` };
  }
  this.cables.lan = true;
  this.lan = pick;
  this.progress.lanConnected = true;
  this.note("cable", `Ethernet cable connected to ${pick === "board" ? "the board jack" : pick}`);
  return { ok: true, cable: "lan" };
}

export function disconnectCable(this: Game, cable: string): Result<{ cable: CableId }> {
  if (cable === "lan") {
    if (!this.cables.lan) return { ok: false, reason: "Ethernet cable is not connected" };
    this.cables.lan = false;
    this.lan = null;
    this.note("cable", "Ethernet cable disconnected");
    return { ok: true, cable: "lan" };
  }
  const wall = cable === "pcmains" || cable === "monmains";
  if (this.powered && !wall) return { ok: false, reason: "power the machine off first" };
  const r = boardDisconnect(this.cables, cable, this.board);
  if (!r.ok) return r;
  if (r.cable === "video") this.video = "board";
  this.note("cable", `${cableName(r.cable)} disconnected`);
  if (wall) this.machine.display.connected = this.monitorLive();
  // pulling the PC's cord on a running machine cuts its power: the same hard power-off as the button
  if (r.cable === "pcmains" && this.powered) {
    this.powerButton();
    this.note("fault", "the power cord was pulled: the machine lost power");
  }
  return r;
}

/** Set the requested CPU clock (overclock/underclock), in the spec's range. Takes effect on the next tick. */
export function setCpuClock(this: Game, clock: number): { ok: true } | { ok: false; reason: string } {
  const cpu = findDevices(this.board, "cpu")[0];
  if (!cpu) return { ok: false, reason: "no CPU" };
  const r = setClock(this.board, cpu.id, clock);
  if (r.ok) this.syncRates(this.powered);
  return r;
}

/** Set the requested clock of one memory stick (RAM overclock/underclock), in its spec's range. */
export function setRamClock(this: Game, deviceId: string, clock: number): { ok: true } | { ok: false; reason: string } {
  const d = this.board.devices.find((x) => x.id === deviceId);
  if (!d || getSpec(d.spec)?.kind !== "ram") return { ok: false, reason: "no such memory stick" };
  const r = setClock(this.board, d.id, clock);
  if (r.ok) this.syncRates(this.powered);
  return r;
}

/** Whether `install(invId)` would succeed now (the machine must be off, so a powered one says no). */
export function canInstall(this: Game, invId: string): boolean {
  const it = this.inventorySnap().find((i) => i.id === invId);
  return !!it && it.installable;
}

/** Cables that could be plugged in (source part installed) but are not. */
export function missingCables(this: Game): CableId[] {
  // The ethernet cable is the player's choice (a port, a router): never part of the bot's assembly.
  return cablesOf(this.board).filter((c) => c.id !== "lan" && !this.cables[c.id] && !cableBlocked(this.board, c.id) && cableNeeded(this.board, c.id)).map((c) => c.id);
}

/** Items in the inventory (ids and spec ids). */
export function inventoryItems(this: Game): readonly { id: string; spec: string }[] {
  return this.inventory;
}

export function mustInstall(this: Game, spec: string, invId?: string): void {
  const r = boardInstall(this.board, spec);
  if (!r.ok) throw new Error(`starting board: ${r.reason}`);
  if (invId) this.removeItem(invId);
  this.flagInstalled(getSpec(spec)!.kind);
}

export function removeItem(this: Game, invId: string): void {
  this.inventory = this.inventory.filter((i) => i.id !== invId);
}

export function flagInstalled(this: Game, kind: DeviceKind): void {
  const flag: Partial<Record<DeviceKind, keyof Progress>> = { cpu: "cpuInstalled", psu: "psuInstalled", ram: "ramInstalled", display: "monitorInstalled", storage: "storageInstalled", cooler: "coolerInstalled" };
  const f = flag[kind];
  if (f) this.progress[f] = true;
}

/** Unplug cables whose source part is gone. */
export function afterBoardChange(this: Game): void {
  // A cable plugged into a network card that left the board comes out with it.
  if (this.lan && this.lan !== "board" && !this.board.devices.some((d) => d.id === this.lan)) {
    this.lan = null;
    this.cables.lan = false;
    this.note("cable", "Ethernet cable came unplugged");
  }
  // A video cable plugged into a card that left the board (or into a card while the display is no longer a graphics one) comes out too.
  if (this.video !== "board") {
    const disp = findDevices(this.board, "display")[0];
    if (!this.videoCard() || !disp || !(deviceSpec(disp) as DisplaySpec).graphics) {
      this.video = "board";
      this.cables.video = false;
      this.note("cable", "Video cable came unplugged");
    }
  }
  for (const c of pruneCables(this.board, this.cables)) this.note("cable", `${cableName(c)} came unplugged`);
  if (!this.cables.video) this.video = "board";
}

/**
 * Put `specId` into a slot of `board` (mutates it, restoring it exactly on failure): the given slot, else the first
 * free compatible one, else swap with the installed part of the same kind. Returns the swapped-out device, if any.
 */
export function placeInto(this: Game, board: Board, specId: string, slotId?: string): Result<{ id: string; slot: string; replaced?: InstalledDevice }> {
  const spec = getSpec(specId);
  if (!spec) return { ok: false, reason: `unknown device "${specId}"` };
  let slot = slotId;
  let occupant: InstalledDevice | undefined;
  if (slot !== undefined) {
    const info = boardSlots(board).find((s) => s.id === slot);
    if (!info) return { ok: false, reason: `board has no slot "${slot}"` };
    const refusal = slotRefusal(info, spec);
    if (refusal) return { ok: false, reason: refusal };
    occupant = board.devices.find((d) => d.slot === slot);
    if (occupant && deviceSpec(occupant).kind !== spec.kind) return { ok: false, reason: `slot "${slot}" is occupied by ${deviceSpec(occupant).name}` };
  } else {
    slot = freeSlots(board, spec.slot, spec)[0]?.id;
    if (slot === undefined) {
      const slots = boardSlots(board);
      occupant = findDevices(board, spec.kind).find((d) => slotRefusal(slots.find((s) => s.id === d.slot)!, spec) === null);
      if (!occupant) return boardInstall(board, specId); // fails with the board's own reason
      slot = occupant.slot;
    }
  }
  if (occupant && occupant.id === this.os?.deviceId) return { ok: false, reason: `the OS is installed on ${deviceSpec(occupant).name}: uninstall the OS first` };
  if (spec.kind === "cooler" && !findDevices(board, "cpu").length) return { ok: false, reason: "install the CPU first: the cooler mounts on it" };
  const backup = boardToJson(board);
  if (occupant) boardUninstall(board, occupant.id);
  const r = boardInstall(board, specId, slot);
  if (!r.ok) {
    const b = boardFromJson(backup);
    board.devices = b.devices;
    board.nextId = b.nextId;
    return r;
  }
  return occupant ? { ...r, replaced: occupant } : r;
}

/** Does a board need a case that holds it? Not in the sandbox (there the case follows the board) nor when the config says so. */
export function caseGated(this: Game): boolean { return !this.sandbox && this.cfg.caseGating; }

export function inventorySnap(this: Game): InventorySnap[] {
  // Power does not matter to the player: `swapInstall` cycles it (or waits for the job).
  const off = true;
  return this.inventory.map((it) => {
    const router = getRouterSpec(it.spec);
    if (router) {
      // External and self-powered: it installs whether the PC is on or off, into the single router spot.
      const free = this.routerTier === 0 ? ["router"] : [];
      const swap = this.routerTier > 0 && router.tier !== this.routerTier ? ["router"] : [];
      const ok = free.length + swap.length > 0;
      return {
        id: it.id, spec: it.spec, kind: "router" as const, name: router.name, freeSlots: free, swapSlots: swap, installable: ok,
        ...(ok ? {} : { reason: `a ${routerByTier(this.routerTier)!.name} is already installed (this is a spare)` }),
      };
    }
    const os = getOsSpec(it.spec);
    if (os) {
      const free: string[] = [];
      let why: string | undefined = os.later ? `${os.name} is not available yet` : this.os ? `${this.os.spec.name} is already installed` : undefined;
      if (why === undefined) {
        for (const d of this.board.devices) {
          if (deviceSpec(d).kind !== "storage") continue;
          const block = this.osBlock(os, d);
          if (block) why ??= block;
          else free.push(d.slot);
        }
        if (free.length === 0) why ??= "install a storage drive first";
      }
      const ok = free.length > 0 && off;
      return {
        id: it.id, spec: it.spec, kind: "os" as const, name: os.name, freeSlots: free, swapSlots: [], installable: ok,
        ...(ok ? {} : { reason: !off && free.length > 0 ? "power the machine off first" : why }),
      };
    }
    const caseTier = caseTierOf(it.spec);
    if (caseTier !== undefined) {
      const r = upgradeCase(boardFromJson(boardToJson(this.board)), caseTier);
      const ok = r.ok && off;
      return {
        id: it.id, spec: it.spec, kind: "case" as const, name: CASE_TIERS[caseTier]!.name,
        freeSlots: r.ok ? ["case"] : [], swapSlots: [], installable: ok,
        ...(ok ? {} : { reason: !off ? "power the machine off first" : (r as { reason: string }).reason }),
      };
    }
    const tier = boardTierOf(it.spec);
    if (tier !== undefined) {
      const t = boardFromJson(boardToJson(this.board));
      const r = this.caseGated() && !caseHolds(t, tier) ? { ok: false as const, reason: caseTooSmall(t, tier) } : upgradeBoard(t, tier);
      const ok = r.ok && off;
      return {
        id: it.id, spec: it.spec, kind: "board" as const, name: BOARD_TIERS[tier]!.name,
        freeSlots: r.ok ? ["board"] : [], swapSlots: [], installable: ok,
        ...(ok ? {} : { reason: !off ? "power the machine off first" : (r as { reason: string }).reason }),
      };
    }
    const spec = getSpec(it.spec)!;
    const free: string[] = [];
    const swap: string[] = [];
    let why: string | undefined;
    for (const s of boardSlots(this.board)) {
      if (!slotAccepts(s.type, spec.slot)) continue;
      if (!slotFitsWidth(s, spec)) { why ??= slotRefusal(s, spec)!; continue; }
      const occ = this.board.devices.find((d) => d.slot === s.id);
      if (occ && deviceSpec(occ).kind !== spec.kind) continue;
      const r = this.placeInto(boardFromJson(boardToJson(this.board)), it.spec, s.id);
      if (r.ok) (occ ? swap : free).push(s.id);
      else why ??= r.reason;
    }
    if (free.length + swap.length === 0) why ??= `no ${spec.slot} slot for ${spec.name}`;
    const installable = free.length + swap.length > 0 && off;
    return {
      id: it.id, spec: it.spec, kind: spec.kind, name: spec.name, freeSlots: free, swapSlots: swap, installable,
      ...(installable ? {} : { reason: !off ? "power the machine off first" : why }),
    };
  }).map((it) => ({ ...it, sellPrice: this.sandbox ? 0 : sellValue(it.spec) }));
}
