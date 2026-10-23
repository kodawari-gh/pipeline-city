// Headless game loop: one Machine + Board + ThermalModel + engine + request queue + economy.
// Deterministic: all randomness comes from the machine PRNG. No DOM. See docs/GAME.md.

import {
  applyEngine, applyRates, boardFromJson, boardToJson, createBoard, deviceSpec, engineConfigFor, findDevices,
  install, machineConfigFor, setClock, ThermalModel,
  type Board, type DeviceKind, type RamSpec,
} from "../board";
import { COUNTER_NAMES, type PipelineEngine } from "../engines";
import { generate, runReference } from "../gen";
import { Machine } from "../machine";
import {
  demandRate, ECONOMY, payout, pickTemplate, reputation, swapPart, upgradeCandidates, type EconomyConfig,
} from "./economy";

export interface GameOptions {
  seed: number;
  /** Overrides for the placeholder economy (tests use this). */
  economy?: Partial<EconomyConfig>;
}

interface Req {
  id: number;
  template: string;
  seed: number;
  arrival: number;
  deadline: number;
  work: number;
  program: Uint32Array;
}

interface Running {
  req: Req;
  /** Base tick at which the first attempt began. */
  startTick: number;
  attempts: number;
}

export interface CompletedInfo {
  id: number;
  template: string;
  payout: number;
  turnaround: number;
  /** Ticks from first start to completion (excludes queue wait). */
  execTicks: number;
  late: boolean;
  attempts: number;
  completedAt: number;
}

export interface DeviceSnap {
  id: string;
  spec: string;
  kind: DeviceKind;
  name: string;
  burnt: boolean;
  requestedClock: number | null;
  effectiveClock: number;
  tempC: number;
  powerW: number;
  throttle: number;
  unstable: boolean;
}

export interface PurchaseSnap {
  id: string;
  name: string;
  kind: DeviceKind;
  price: number;
  affordable: boolean;
  /** Set if the board would refuse it right now (e.g. PSU too small, no slot). */
  blocked?: string;
}

export interface Snapshot {
  money: number;
  /** Total CPU cycles clocked since the start. */
  cycle: number;
  baseTick: number;
  queueLength: number;
  queueCap: number;
  request: null | {
    id: number;
    template: string;
    arrivalTick: number;
    deadlineTick: number;
    payoutEstimate: number;
    /** Engine cycle within the current attempt. */
    engineCycle: number;
    attempts: number;
  };
  /** Display contents (the current or most recent request's output). */
  display: string;
  /** Engine counters of the current attempt, by name (all zero when no engine). */
  counters: Record<string, number>;
  completed: number;
  /** Thermal errors that restarted a request. */
  errors: number;
  dropped: number;
  lastCompleted: CompletedInfo | null;
  avgTurnaround: number;
  reputation: number;
  /** Request arrivals per base tick right now. */
  demandRate: number;
  devices: DeviceSnap[];
  power: { totalW: number; budgetW: number; psuFactor: number; off: boolean; tripped: boolean };
  cpuClock: { value: number; min: number; max: number } | null;
  purchases: PurchaseSnap[];
  /** Bought but waiting for the current request to finish. */
  pendingPurchases: string[];
}

export type PurchaseResult = { ok: true; pending: boolean } | { ok: false; reason: string };

export class Game {
  readonly cfg: EconomyConfig;
  readonly machine: Machine;
  readonly thermal: ThermalModel;
  board: Board;

  money = 0;
  baseTick = 0;
  completed = 0;
  errors = 0;
  dropped = 0;
  lastCompleted: CompletedInfo | null = null;

  private queue: Req[] = [];
  private current: Running | null = null;
  private pending: string[] = [];
  private nextReqId = 1;
  private avgTurnaround: number;
  private lastDisplay = "";

  constructor(opts: GameOptions) {
    this.cfg = { ...ECONOMY, ...opts.economy };
    this.avgTurnaround = this.cfg.targetTurnaround;
    this.board = createBoard(0);
    for (const id of ["cpu0", "ram0", "display0", "cooler0", "psu0"]) {
      const r = install(this.board, id);
      if (!r.ok) throw new Error(`starting board: ${r.reason}`);
    }
    // RAM is fixed at construction, so the machine always has the largest RAM (64K); the installed RAM tier
    // changes cache miss penalty and which jobs arrive (see EconomyConfig.mix), not the allocation.
    this.machine = new Machine({ ...machineConfigFor(this.board, opts.seed), ramSize: 64 * 1024 });
    this.thermal = new ThermalModel(this.machine.prng);
    this.syncRates(false);
    for (const q of this.cfg.startQueue) this.enqueue(q.template, q.scale);
  }

  // ---------- public API ----------

  /** Advance one base tick: arrivals, run the machine, complete/restart requests, thermal step, clock rates. */
  advanceBaseTick(): void {
    this.baseTick++;
    this.arrivals();
    this.startNext();
    this.machine.advanceBaseTick();
    this.checkDone();
    const running = this.current !== null;
    const load = running ? 1 : this.cfg.idleLoad;
    this.thermal.step(this.board, { cpu: load, ram: load, display: load });
    if (this.current) {
      // A thermal error restarts the request from its first instruction; no payout for the failed attempt.
      const cpu = findDevices(this.board, "cpu")[0];
      if (cpu && this.thermal.errorRoll(cpu.id)) {
        this.errors++;
        this.current.attempts++;
        this.restart();
      }
    }
    this.syncRates(true);
  }

  /**
   * Buy an item (a device spec id). Money is spent now. If a request is running, the board change (and the
   * engine swap for CPU/RAM) is applied when it finishes; otherwise immediately. Validation uses the board
   * with earlier pending purchases applied, so the whole thing goes through board install/validation.
   */
  purchase(itemId: string): PurchaseResult {
    const cand = upgradeCandidates(this.plannedBoard()).find((s) => s.id === itemId);
    if (!cand) return { ok: false, reason: `"${itemId}" is not an available upgrade` };
    if (this.money < cand.price) return { ok: false, reason: `needs $${cand.price}, have $${this.money}` };
    const trial = this.plannedBoard();
    const r = swapPart(trial, itemId);
    if (!r.ok) return r;
    this.money -= cand.price;
    this.pending.push(itemId);
    // Defer while a request is running on a working CPU; a dead CPU must be replaceable at once.
    const cpu = findDevices(this.board, "cpu")[0];
    const deferred = this.current !== null && !!cpu && !cpu.burnt;
    if (!deferred) {
      this.applyPending();
      if (this.current) this.restart(); // new engine for the request that was stuck on the dead CPU
    }
    return { ok: true, pending: deferred };
  }

  /** Set the requested CPU clock (overclock/underclock), in the spec's range. Takes effect on the next tick. */
  setCpuClock(clock: number): { ok: true } | { ok: false; reason: string } {
    const cpu = findDevices(this.board, "cpu")[0];
    if (!cpu) return { ok: false, reason: "no CPU" };
    const r = setClock(this.board, cpu.id, clock);
    if (r.ok) this.syncRates(true);
    return r;
  }

  /** Clear a PSU hard trip (the player flips the switch). */
  powerCycle(): void {
    this.thermal.powerCycle();
  }

  snapshot(): Snapshot {
    const eng = this.machine.engine as PipelineEngine | null;
    const counters: Record<string, number> = {};
    COUNTER_NAMES.forEach((n, i) => { counters[n] = eng?.view ? eng.view.counters[i]! : 0; });
    const cur = this.current;
    const rep = reputation(this.cfg, this.avgTurnaround);
    const cpu = findDevices(this.board, "cpu")[0];
    const cpuSpec = cpu ? deviceSpec(cpu) : undefined;
    const planned = this.plannedBoard();
    const purchases: PurchaseSnap[] = upgradeCandidates(planned).map((s) => {
      const p: PurchaseSnap = { id: s.id, name: s.name, kind: s.kind, price: s.price, affordable: this.money >= s.price };
      const t = boardFromJson(boardToJson(planned));
      const r = swapPart(t, s.id);
      if (!r.ok) p.blocked = r.reason;
      return p;
    });
    return {
      money: this.money,
      cycle: this.machine.clock.ticks("cpu"),
      baseTick: this.baseTick,
      queueLength: this.queue.length,
      queueCap: this.cfg.queueCap,
      request: cur && {
        id: cur.req.id,
        template: cur.req.template,
        arrivalTick: cur.req.arrival,
        deadlineTick: cur.req.deadline,
        payoutEstimate: payout(this.cfg, cur.req.work, this.cfg.targetTurnaround, false),
        engineCycle: eng ? eng.cycle : 0,
        attempts: cur.attempts,
      },
      display: this.machine.display.text(),
      counters,
      completed: this.completed,
      errors: this.errors,
      dropped: this.dropped,
      lastCompleted: this.lastCompleted && { ...this.lastCompleted },
      avgTurnaround: this.avgTurnaround,
      reputation: rep,
      demandRate: demandRate(this.cfg, rep),
      devices: this.board.devices.map((d) => {
        const s = deviceSpec(d);
        const t = this.thermal.state(d.id);
        return {
          id: d.id, spec: d.spec, kind: s.kind, name: s.name, burnt: !!d.burnt,
          requestedClock: d.clock ?? null,
          effectiveClock: t?.effClock ?? 0,
          tempC: t?.tempC ?? 25,
          powerW: t?.powerW ?? 0,
          throttle: t?.throttle ?? 1,
          unstable: t?.unstable ?? false,
        };
      }),
      power: { ...this.thermal.power },
      cpuClock: cpu && cpuSpec?.clock ? { value: cpu.clock ?? cpuSpec.clock.base, min: cpuSpec.clock.min, max: cpuSpec.clock.max } : null,
      purchases,
      pendingPurchases: [...this.pending],
    };
  }

  // ---------- internals ----------

  /** Board with pending (deferred) purchases applied, for validation and listing. */
  private plannedBoard(): Board {
    const b = boardFromJson(boardToJson(this.board));
    for (const id of this.pending) swapPart(b, id);
    return b;
  }

  private installedRamBytes(): number {
    return findDevices(this.board, "ram").filter((d) => !d.burnt).reduce((n, d) => n + (deviceSpec(d) as RamSpec).sizeBytes, 0);
  }

  private enqueue(template: string, scale = 1): boolean {
    const prng = this.machine.prng;
    const seed = prng.nextU32();
    if (this.queue.length >= this.cfg.queueCap) {
      this.dropped++;
      return false;
    }
    const g = generate(template, seed, { row: 0, scale });
    this.queue.push({
      id: this.nextReqId++, template, seed, arrival: this.baseTick,
      deadline: this.baseTick + this.cfg.deadlineTicks,
      work: runReference(g).steps, program: g.program,
    });
    return true;
  }

  private arrivals(): void {
    const rate = demandRate(this.cfg, reputation(this.cfg, this.avgTurnaround));
    const prng = this.machine.prng;
    // One Bernoulli draw per tick (rate is well below 1 per tick), so the PRNG stream does not depend on state.
    const hit = prng.next() < rate;
    const pick = prng.next();
    if (hit) {
      const m = pickTemplate(this.cfg, this.installedRamBytes(), pick);
      this.enqueue(m.template, m.scale);
    }
  }

  /** Apply deferred purchases to the board (engine swap happens in startNext/restart via applyEngine). */
  private applyPending(): void {
    if (this.pending.length === 0) return;
    for (const id of this.pending) {
      const r = swapPart(this.board, id);
      if (!r.ok) this.money += deviceSpecPrice(id); // cannot happen after validation; refund defensively
    }
    this.pending = [];
    this.syncRates(false);
  }

  /** Between requests only: apply pending swaps, then load the next request with a freshly built engine. */
  private startNext(): void {
    if (this.current || this.queue.length === 0) return;
    this.applyPending();
    if (!engineConfigFor(this.board)) return; // no working CPU: wait for a replacement
    const req = this.queue.shift()!;
    this.current = { req, startTick: this.baseTick - 1, attempts: 1 };
    this.restart();
  }

  private restart(): void {
    const cur = this.current!;
    this.machine.display.clear();
    applyEngine(this.board, this.machine, cur.req.program);
  }

  private checkDone(): void {
    const cur = this.current;
    const eng = this.machine.engine;
    if (!cur || !eng || !eng.halted || this.machine.display.pending > 0) return;
    const turnaround = this.baseTick - cur.req.arrival;
    const late = this.baseTick > cur.req.deadline;
    const pay = payout(this.cfg, cur.req.work, turnaround, late);
    this.money += pay;
    this.completed++;
    this.avgTurnaround += this.cfg.emaAlpha * (turnaround - this.avgTurnaround);
    this.lastCompleted = {
      id: cur.req.id, template: cur.req.template, payout: pay, turnaround,
      execTicks: this.baseTick - cur.startTick, late, attempts: cur.attempts, completedAt: this.baseTick,
    };
    this.current = null;
  }

  /**
   * Set the CPU and display domain rates from the board (thermal-effective clocks once the thermal model has
   * stepped, requested clocks before that), then scale by cpuCyclesPerClock.
   */
  private syncRates(useThermal: boolean): void {
    applyRates(this.board, this.machine, useThermal ? this.thermal : undefined);
    for (const name of ["cpu", "display"]) {
      const r = this.machine.clock.getRate(name);
      this.machine.clock.setRate(name, { mul: r.mul * this.cfg.cpuCyclesPerClock, div: r.div });
    }
  }
}

function deviceSpecPrice(id: string): number {
  return deviceSpec({ id: "", spec: id, slot: "" }).price;
}
