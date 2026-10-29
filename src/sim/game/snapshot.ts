// Game feature: the snapshot. Everything the UI and renderer see each tick, assembled from the other features' state.
// Every export is a `Game` method (see game.ts).

import {
  boardSlots, BOARD_TIERS, bootCheck, cablesOf, cableBlocked, cableNeeded, CASE_TIERS, deviceSpec, findDevices, type InstalledDevice,
} from "../board";
import { COUNTER_NAMES, Counter, type PipelineEngine } from "../engines";
import { PchPhase, JobState } from "../isa/memmap";
import { catalog, postTicks } from "./economy";
import type { Game } from "./game";
import { LEVEL_ROWS, type Key, type KernelJob } from "./internal";
import { dexState, JOB_DEX } from "./jobdex";
import { describeNeed, levelDef, MAX_LEVEL, needsMet } from "./levels";
import { STEP_TRACE_CYCLES, TRACE_CYCLES } from "./pipesnap";
import type {
  BoardSnap, DeviceSnap, KeySnap, KeyStage, LevelSnap, PurchaseSnap, SlotSnap, Snapshot, VrmSnap,
} from "./types";

export function snapshot(this: Game): Snapshot {
  const eng = this.machine.engine as PipelineEngine | null;
  // a multicore CPU: every hardware core's pipeline, and `pipe` is the selected one's (the same object, so it crosses the thread boundary once)
  const cores = this.powered && eng?.view && this.machine.cores.length > 1 ? this.coresSnap() : null;
  const counters: Record<string, number> = {};
  COUNTER_NAMES.forEach((n, i) => { counters[n] = eng?.view ? eng.view.counters[i]! : 0; });
  const rep = this.reputation();
  const cpu = findDevices(this.board, "cpu")[0];
  const cpuSpec = cpu ? deviceSpec(cpu) : undefined;
  const purchases: PurchaseSnap[] = catalog().map((s) => {
    const p: PurchaseSnap = { id: s.id, name: s.name, kind: s.kind, price: this.cost(s.price), affordable: this.money >= this.cost(s.price) };
    return p;
  });
  for (const o of this.extraOffers()) {
    purchases.push({
      id: o.id, name: o.name, kind: o.kind, price: o.price, affordable: this.money >= o.price,
      ...(o.blocked ? { blocked: o.blocked } : {}), ...(o.later ? { later: true } : {}), ...(o.description ? { description: o.description } : {}),
    });
  }
  for (const p of purchases) {
    const lock = this.levelLock(p.id);
    if (lock) p.locked = lock;
  }
  const phase = this.currentPhase();
  const live = this.monitorLive();
  const plugged = this.plugged;
  const chk = bootCheck(this.board, this.cables);
  const jobs = this.kernelJobs();
  return {
    money: this.money,
    sandbox: this.sandbox,
    cycle: this.machine.clock.ticks("cpu"),
    baseTick: this.baseTick,
    queueLength: this.tray.waiting().length,
    queueCap: this.cfg.queueCap,
    request: plugged && {
      id: plugged.id,
      template: plugged.template,
      arrivalTick: plugged.arrival,
      deadlineTick: plugged.deadline,
      payoutEstimate: this.estimate(plugged),
      engineCycle: eng ? eng.cycle : 0,
      attempts: plugged.attempts,
    },
    boardTier: this.board.tier,
    caseTier: this.board.caseTier,
    pipe: cores ? cores.tiles[cores.live[cores.selected]!.hw] ?? null : this.powered && eng?.view ? this.pipeSnap(this.viewEngine() ?? eng) : null,
    ...(cores ? { cores } : {}),
    ram: this.powered ? this.ramSnap(jobs) : null,
    ...(this.powered && this.gpus.some((p) => p.present) ? { gpus: this.gpuSnaps() } : {}),
    display: this.powered && live ? this.machine.display.text() : "",
    counters,
    completed: this.completed,
    errors: this.errors,
    faults: this.faults,
    ...(this.machine.mmu.tlbEntries > 0 ? { mmu: { tlb: this.machine.mmu.tlbEntries, hits: this.mmuCount(Counter.TlbHits), misses: this.mmuCount(Counter.TlbMisses), faults: this.machine.mmu.faults, on: this.machine.mmu.enabled } } : {}),
    eccCorrected: this.eccCorrected,
    health: this.health(),
    dex: JOB_DEX.map((e) => { const r = this.dex[e.id]; return { id: e.id, state: dexState(e, r), runs: r?.runs ?? 0, best: r?.best ?? 0, seenTick: r?.seen ?? 0 }; }),
    jobLog: this.jobLog.map((e) => ({ ...e })),
    bitFlips: this.bitFlips,
    dropped: this.dropped,
    lastCompleted: this.lastCompleted && { ...this.lastCompleted },
    avgTurnaround: this.avgTurnaround,
    reputation: rep,
    demandRate: this.demand(),
    devices: this.board.devices.map((d) => this.deviceSnap(d)),
    board: this.boardSnap(),
    power: { ...this.thermal.power },
    cpuClock: cpu && cpuSpec?.clock ? { value: cpu.clock ?? cpuSpec.clock.base, min: cpuSpec.clock.min, max: cpuSpec.clock.max } : null,
    purchases,
    pendingPurchases: [],
    phase,
    phaseReason: phase === "error" ? (this.postError?.reason ?? this.fault()) : null,
    powered: this.powered,
    bootProgress: this.bootProgress(phase),
    monitorLive: live,
    monitorPowered: !!this.cables.monmains,
    energy: { wallW: this.wallW, wh: this.wattTicks / 3600 },
    bill: this.billSnap(),
    noPowerReason: this.cutReason() ?? chk.noPower,
    postBlocker: chk.post?.reason ?? null,
    inventory: this.inventorySnap(),
    slots: this.slotSnaps(),
    // The PCIe lead is listed only while a card asks for it (or it is plugged): a machine with no accelerator has no such cable to show.
    cables: cablesOf(this.board).filter((c) => this.cables[c.id] || cableNeeded(this.board, c.id)).map((c) => {
      const blocked = c.id === "lan" ? (this.routerTier ? null : "needs a router next to the monitor") : cableBlocked(this.board, c.id);
      return { id: c.id, name: c.name, connected: !!this.cables[c.id], ...(blocked && !this.cables[c.id] ? { blocked } : {}) };
    }),
    videoPort: this.video,
    tray: this.tray.waiting().map((k) => this.keySnap(k, jobs)),
    plugged: plugged && this.keySnap(plugged, jobs),
    progress: { ...this.progress },
    log: this.log.map((e) => ({ ...e })),
    storage: this.storageSnaps(),
    os: this.osSnap(jobs),
    keyActivity: this.keyActivity(),
    haltReason: phase !== "halted" ? null : this.pch.phase === PchPhase.Halted ? "job-done" : "no-boot-media",
    keyIgnored: this.keyIgnored(),
    autoEject: this.cfg.autoEjectTicks > 0,
    pendingSwap: this.pendingSwap && { invId: this.pendingSwap.invId, slotId: this.pendingSwap.slotId ?? null },
    postFailed: !!this.postError,
    patience: {
      mul: this.patience(), targetTurnaround: this.targetTurnaround(), deadlineTicks: this.deadlineTicks(),
      sinceFirstBoot: this.sinceFirstBoot(),
    },
    level: this.levelSnap(),
    expired: this.expired,
    declined: this.declined,
    postTicks: postTicks(this.cfg, this.board),
    net: this.netSnap(jobs),
  };
}

/** A snapshot that carries the cycles of a step (up to `STEP_TRACE_CYCLES`), for the die and the Trace panel to show one by one. */
export function snapshotAfterStep(this: Game, cycles: number): Snapshot {
  this.traceCycles = Math.max(TRACE_CYCLES, Math.min(STEP_TRACE_CYCLES, cycles));
  try { return this.snapshot(); } finally { this.traceCycles = TRACE_CYCLES; }
}

export function levelSnap(this: Game): LevelSnap {
  const lv = this.level;
  const def = levelDef(lv);
  const nextDef = lv < MAX_LEVEL ? levelDef(lv + 1) : null;
  const span = nextDef ? nextDef.threshold - def.threshold : 1;
  return {
    level: lv, name: def.name, clientBase: this.clientBase, floor: def.threshold, next: nextDef ? nextDef.threshold : null,
    progress: this.sandbox || !nextDef ? (this.sandbox ? 0 : 1) : Math.min(1, Math.max(0, (this.clientBase - def.threshold) / span)),
    patienceMul: def.patienceMul, payMul: def.payMul, demandMul: def.demandMul,
    leveledUpAt: this.leveledUpAt, recentlyUnlocked: this.recentUnlocks.map((i) => ({ ...i })),
    upcoming: LEVEL_ROWS, sandbox: this.sandbox, classesOff: [...this.sandboxOff], kindsOff: [...this.sandboxKindsOff],
  };
}

export function deviceSnap(this: Game, d: InstalledDevice): DeviceSnap {
  const s = deviceSpec(d);
  const t = this.thermal.state(d.id);
  return {
    id: d.id, spec: d.spec, kind: s.kind, name: s.name, slot: d.slot, burnt: !!d.burnt,
    requestedClock: d.clock ?? null,
    effectiveClock: t?.effClock ?? 0,
    tempC: t?.tempC ?? 25,
    powerW: t?.powerW ?? 0,
    throttle: t?.throttle ?? 1,
    unstable: t?.unstable ?? false,
  };
}

export function slotSnaps(this: Game): SlotSnap[] {
  return boardSlots(this.board).map((s) => ({ id: s.id, type: s.type, deviceId: this.board.devices.find((d) => d.slot === s.id)?.id ?? null }));
}

export function boardSnap(this: Game): BoardSnap {
  const t = BOARD_TIERS[this.board.tier]!;
  const v = this.thermal.vrm, rv = this.thermal.ramVrm;
  const sink = findDevices(this.board, "vrm-sink")[0], ramSink = findDevices(this.board, "ram-sink")[0];
  const rail = (spec: typeof t.vrm, st: typeof v, sinkDev: typeof sink): VrmSnap => ({
    phases: spec.phases, ampsPerPhase: spec.ampsPerPhase, ripple: spec.ripple,
    tempC: st.tempC, loadRatio: st.loadRatio, efficiency: st.efficiency, throttle: st.throttle, unstable: st.unstable,
    burnt: !!this.board.burnt, errProb: st.errProb, heatW: st.heatW,
    throttleC: spec.throttleC, unstableC: spec.unstableC, damageC: spec.damageC, sinkDeviceId: sinkDev?.id ?? null,
  });
  return {
    tier: t.tier, name: t.name, caseTier: this.board.caseTier, caseName: CASE_TIERS[this.board.caseTier]!.name, caseForm: CASE_TIERS[this.board.caseTier]!.form,
    burnt: !!this.board.burnt, features: { ...t.features }, slots: this.slotSnaps(),
    vrm: rail(t.vrm, v, sink),
    vrmSink: sink ? this.deviceSnap(sink) : null,
    ramVrm: rail(t.ramVrm, rv, ramSink),
    ramSink: ramSink ? this.deviceSnap(ramSink) : null,
  };
}

export function stageOf(this: Game, k: Key, jobs: KernelJob[]): KeyStage {
  if (k.done) return "done";
  const j = jobs.find((x) => x.key === k.id);
  const byState = (s: number): KeyStage => (s === JobState.Result ? "result" : s === JobState.Running ? "running" : "queued");
  if (this.offersQ.waiting().includes(k)) return "offer";
  if (this.downloads.some((t) => t.key === k)) return "downloading";
  if (this.rx.includes(k)) return "ingesting";
  if (this.spool.includes(k)) return this.uploads.some((t) => t.key === k) ? "uploading" : j ? byState(j.state) : "spooled";
  if (k === this.plugged) {
    if (this.pch.flashing) return "flashing";
    if (j) return byState(j.state);
    return this.pch.phase === PchPhase.OsIngest ? "ingesting" : "tray";
  }
  return j ? byState(j.state) : "tray";
}

export function keySnap(this: Game, k: Key, jobs: KernelJob[]): KeySnap {
  const need = needsMet(k.needs, this.caps());
  const stage = this.stageOf(k, jobs);
  return {
    stage, cls: k.cls, needs: k.needs.map((n) => describeNeed(n).short), runnable: need.ok, missing: need.missing, expiresTick: k.deadline,
    declinable: k !== this.plugged && (stage === "tray" || stage === "offer" || stage === "spooled" || (this.spool.includes(k) && stage === "queued")),
    retired: k.retired,
    id: k.id, template: k.template, type: k.type, jobNo: k.jobNo, label: `#${String(k.jobNo).padStart(2, "0")} ${k.type}`,
    arrivalTick: k.arrival, deadlineTick: k.deadline, age: this.progress.poweredOn ? this.baseTick - k.arrival : 0,
    late: this.baseTick > k.deadline && this.progress.poweredOn,
    payoutEstimate: this.estimate(k), attempts: k.attempts, done: k.done, result: k.result,
    ...(this.slaOf(k) !== null ? { slaTick: k.arrival + this.slaOf(k)! } : {}),
    ...(stage !== "tray" && stage !== "offer" ? { startedAt: this.startOf(k) } : {}),
    ...(k.done ? { finishedAt: k.doneAt } : {}),
    ...(stage === "running" ? this.liveOf(k) : {}),
  };
}
