// Game feature: the save. Writing the game's state out and putting a parsed save back into a fresh game (docs/SAVE.md).
// Every export is a `Game` method (see game.ts).

import { allCables, boardFromJson, boardToJson, cablesOf, fittedRadiator, isFanCable, legacyRadiatorSlots, radiatorSlot, sideMounts } from "../board";
import { generate } from "../gen";
import { JOB_ROW } from "../isa/memmap";
import { getOsSpec } from "../os";
import { SANDBOX_MONEY } from "./economy";
import type { Game } from "./game";
import type { Key } from "./internal";
import { JOB_DEX, type DexRecord } from "./jobdex";
import { JOB_LOG_CAP, type JobLogEntry } from "./joblog";
import { JOB_CLASSES, levelFor, type JobClassId } from "./levels";
import { SAVE_VERSION, type SavedKey, type SavedNet, type SavedPlugged, type SaveV4 } from "./save";

/** Config-only save (no pipeline, registers or RAM). See docs/SAVE.md. */
export function toSave(this: Game): SaveV4 {
  const sk = (k: Key): SavedKey => ({ id: k.id, template: k.template, seed: k.seed, scale: k.scale, arrival: k.arrival, deadline: k.deadline, cls: k.cls, retired: k.retired, ...(k.pluggedAt ? { pluggedAt: k.pluggedAt } : {}) });
  const p = this.plugged;
  const plugged: SavedPlugged | null = p && { ...sk(p), attempts: p.attempts, pluggedAt: p.pluggedAt, done: p.done, doneAt: p.doneAt, result: p.result, ...(p.done && p.ranAt !== undefined ? { ranAt: p.ranAt } : {}) };
  return {
    version: SAVE_VERSION,
    seed: this.seed,
    prngState: this.machine.prng.getState(),
    money: this.money,
    baseTick: this.baseTick,
    nextKeyId: this.nextKeyId,
    completed: this.completed,
    errors: this.errors,
    dropped: this.dropped,
    avgTurnaround: this.avgTurnaround,
    lastCompleted: this.lastCompleted && { ...this.lastCompleted },
    board: boardToJson(this.board),
    inventory: this.inventory.map((i) => ({ ...i })),
    nextInvId: this.nextInvId,
    cables: { ...this.cables, ...Object.fromEntries(cablesOf(this.board).map((c) => [c.id, !!this.cables[c.id]])) }, // every cable of this case said outright (a missing fan cable reads as plugged: the saves from before them)
    tray: [...this.tray.waiting()].sort((a, b) => a.id - b.id).map(sk),
    plugged,
    tripped: this.thermal.power.tripped,
    progress: { ...this.progress },
    os: this.os && { spec: this.os.spec.id, deviceId: this.os.deviceId },
    firstBootTick: this.firstBootTick,
    ...(this.sandbox ? { sandbox: true, sandboxLevel: this.sandboxLevel } : {}),
    ...(this.sandbox && this.sandboxOff.size ? { sandboxOff: [...this.sandboxOff] } : {}),
    ...(this.sandbox && this.sandboxKindsOff.size ? { sandboxKindsOff: [...this.sandboxKindsOff] } : {}),
    clientBase: this.clientBase,
    level: this.lvl,
    levelTicks: Object.fromEntries(Object.entries(this.levelTicks).map(([k, v]) => [k, v])),
    declined: this.declined,
    expired: this.expired,
    ...(Object.keys(this.dex).length ? { jobDex: JSON.parse(JSON.stringify(this.dex)) as Record<string, DexRecord> } : {}),
    ...(this.jobLog.length ? { jobLog: JSON.parse(JSON.stringify(this.jobLog)) as JobLogEntry[] } : {}),
    net: this.savedNet(sk),
    ...(this.video !== "board" ? { video: this.video } : {}),
    ...(this.sandbox ? {} : {
      bill: {
        wh: this.wattTicks / 3600, billedWh: this.billedWh, nextTick: this.nextBillTick, unpaid: this.unpaid, unpaidSince: this.unpaidSince,
        powerCut: this.powerCut, paid: this.billPaid, last: this.lastBill && { ...this.lastBill },
      },
    }),
  };
}

/** The network block of the save: plan, router, cable, offers (downloads in flight restart as offers) and the spool. */
export function savedNet(this: Game, sk: (k: Key) => SavedKey): SavedNet {
  const offers = [...this.offersQ.waiting(), ...this.downloads.map((t) => t.key), ...this.rx].sort((a, b) => a.id - b.id);
  return {
    ispTier: this.ispTier, routerTier: this.routerTier, lan: this.lan, networkLinked: this.networkLinked, deadTicks: this.deadTicks,
    offers: offers.map(sk), spool: this.spool.map(sk),
  };
}

/**
 * Put a parsed save into this fresh game (`Game.fromSave` builds the game and calls this). The machine loads powered off; a
 * plugged key stays plugged and its job restarts from boot at the next power-on.
 */
export function restoreSave(this: Game, s: SaveV4): void {
  this.board = boardFromJson(s.board);
  // a save from before the radiators: its liquid loop kept the cooling of a slim radiator, so it gets one for free (top fan mount if the case has one)
  legacyRadiatorSlots(this.board);
  if (this.board.devices.some((d) => d.spec === "cooler2") && !fittedRadiator(this.board)) {
    this.board.devices.push({ id: `dev${this.board.nextId++}`, spec: "rad1", slot: radiatorSlot(sideMounts(this.board.caseTier, "top").length > 0 ? "top" : "front") });
  }
  this.machine.prng.setState(s.prngState);
  this.money = this.sandbox ? SANDBOX_MONEY : s.money;
  if (this.sandbox) {
    // the sandbox's own edits: the pinned level and what is switched off (an id that no longer exists is dropped)
    if (s.sandboxLevel !== undefined) this.sandboxLevel = s.sandboxLevel;
    const classes = new Set<string>(JOB_CLASSES.map((c) => c.id)), kinds = new Set(JOB_DEX.filter((e) => !e.planned).map((e) => e.id));
    this.sandboxOff = new Set((s.sandboxOff ?? []).filter((id) => classes.has(id)) as JobClassId[]);
    this.sandboxKindsOff = new Set((s.sandboxKindsOff ?? []).filter((id) => kinds.has(id)));
  }
  this.baseTick = s.baseTick;
  this.nextKeyId = s.nextKeyId;
  this.completed = s.completed;
  this.errors = s.errors;
  this.dropped = s.dropped;
  this.avgTurnaround = s.avgTurnaround;
  this.lastCompleted = s.lastCompleted && { ...s.lastCompleted };
  this.inventory = s.inventory.map((i) => ({ ...i }));
  this.nextInvId = s.nextInvId;
  this.cables = { ...s.cables, pcmains: s.cables.pcmains ?? true, monmains: s.cables.monmains ?? true }; // a save from before the wall cords had them plugged
  // a save from before the fan cables had the machine running: every fan it has is plugged (a machine that used to run is not locked out of POST)
  for (const [k, v] of Object.entries(allCables(this.board))) if (isFanCable(k) && this.cables[k] === undefined) this.cables[k] = v;
  this.progress = { ...s.progress, mainsConnected: s.progress.mainsConnected ?? true }; // a save from before the cords needs no lesson on them
  // The first boot marks when clients start arriving; a save without the field (older v4) restarts it at the load tick.
  this.firstBootTick = s.progress.poweredOn ? (s.firstBootTick ?? s.baseTick) : null;
  this.declined = s.declined ?? 0;
  this.dex = s.jobDex ? JSON.parse(JSON.stringify(s.jobDex)) as Record<string, DexRecord> : {};
  this.jobLog = Array.isArray(s.jobLog) ? (JSON.parse(JSON.stringify(s.jobLog)) as JobLogEntry[]).filter((e) => e && typeof e.id === "number" && typeof e.type === "string").slice(-JOB_LOG_CAP) : [];
  this.expired = s.expired ?? 0;
  if (!this.sandbox) {
    if (s.clientBase !== undefined) {
      this.clientBase = s.clientBase;
      this.lvl = levelFor(this.clientBase);
      this.levelTicks = Object.fromEntries(Object.entries(s.levelTicks ?? {}).map(([k, v]) => [Number(k), v]));
    } else {
      // A save from before levels: an average point per job so far, the level derived from it, no celebration. Parts
      // already installed stay (the level only gates what can be bought).
      this.clientBase = s.completed * 1.1;
      this.lvl = levelFor(this.clientBase);
      this.levelTicks = { [this.lvl]: s.baseTick };
    }
  }
  if (s.bill && !this.sandbox) {
    const b = s.bill;
    this.wattTicks = b.wh * 3600;
    this.billedWh = b.billedWh;
    // A saved clock keeps its due tick; a save from before the bill starts its clock at the first tick (see `billTick`).
    this.nextBillTick = b.nextTick;
    this.unpaid = b.unpaid;
    this.unpaidSince = b.unpaidSince;
    this.powerCut = b.powerCut;
    this.billPaid = b.paid;
    this.lastBill = b.last && { ...b.last };
  }
  if (s.net) {
    this.ispTier = s.net.ispTier;
    this.routerTier = s.net.routerTier;
    this.lan = s.net.lan;
    this.networkLinked = s.net.networkLinked;
    this.deadTicks = s.net.deadTicks;
  }
  if (this.lan && this.lan !== "board" && !this.board.devices.some((d) => d.id === this.lan)) this.lan = null;
  if (!this.routerTier) this.lan = null;
  this.cables.lan = this.lan !== null;
  // the video cable's port (absent: the board's); a card that is not there any more puts it back
  this.video = typeof s.video === "string" ? s.video : "board";
  if (this.video !== "board" && !this.videoCard()) { this.video = "board"; this.cables.video = false; }
  this.log = [];
  if (s.os) this.formatOs(getOsSpec(s.os.spec)!, s.os.deviceId, false);
  // A save from before the retired flag, whose link had been up: its USB keys are retired (the rule of the link's return).
  const legacyRetired = s.net?.networkLinked === true;
  try {
    this.tray.set(s.tray.map((k) => this.rebuild({ ...k, retired: k.retired ?? legacyRetired })));
    if (s.net) {
      this.offersQ.set(s.net.offers.map((k) => this.rebuild(k)));
      this.spool = s.net.spool.map((k) => this.rebuild(k));
      for (const k of this.spool) k.reloaded = true;
    }
    if (s.plugged) {
      const p = s.plugged;
      const key = this.rebuild(p);
      key.attempts = p.attempts;
      key.pluggedAt = p.pluggedAt;
      key.done = p.done;
      key.doneAt = p.doneAt;
      if (p.done && p.ranAt !== undefined) key.ranAt = p.ranAt;
      key.result = p.result;
      key.retired = p.retired ?? (legacyRetired && !p.done);
      key.reloaded = true;
      this.plugged = key;
      this.pchKey = { id: key.id, program: generate(key.template, key.seed, { row: JOB_ROW, scale: key.scale, hosted: true, gpu: this.gpuTarget(), npu: this.npuTarget() }).program, done: key.done, result: key.result };
      this.pch.plug(this.pchKey);
    }
  } catch (e) {
    throw new Error(`save: cannot regenerate a key (${(e as Error).message})`);
  }
  if (s.tripped) this.thermal.power = { ...this.thermal.power, tripped: true };
  this.powered = false;
  this.syncStorage();
  this.syncGpus();
  this.syncNpus();
  this.syncTpm();
  this.syncRates(false);
  this.link = this.computeLink();
}
