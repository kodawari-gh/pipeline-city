// Clock scheduler. Base tick = 1 s of game time at 1x, split into SUBTICKS_PER_BASE integer sub-ticks.
// A domain's rate is mul/div domain ticks per base tick. Its phase is an integer accumulator:
// each sub-tick adds `mul`, and a domain tick fires whenever phase reaches div * subticksPerBase.
// No floats, so runs are exactly reproducible. Domains fire in registration order within a sub-tick.

export const SUBTICKS_PER_BASE = 1000;

export interface Rate {
  /** Domain ticks per base tick = mul / div (non-negative mul, positive div, both integers). */
  mul: number;
  div: number;
}

interface Pending {
  due: number; // domain tick number
  seq: number;
  fn: () => void;
}

interface Domain {
  rate: Rate;
  onTick: (tick: number) => void;
  phase: number; // in units of 1/(div * subticksPerBase) of a domain tick
  ticks: number; // domain ticks fired so far
  pending: Pending[];
}

function checkRate(r: Rate): void {
  if (!Number.isInteger(r.mul) || !Number.isInteger(r.div) || r.mul < 0 || r.div < 1) {
    throw new RangeError(`bad rate ${r.mul}/${r.div}`);
  }
}

export class ClockScheduler {
  private readonly domains = new Map<string, Domain>();
  private readonly order: Domain[] = [];
  private seq = 0;
  /** Total sub-ticks advanced. */
  subTicks = 0;

  constructor(readonly subticksPerBase = SUBTICKS_PER_BASE) {}

  get baseTicks(): number {
    return Math.floor(this.subTicks / this.subticksPerBase);
  }

  addDomain(name: string, rate: Rate, onTick: (tick: number) => void): void {
    if (this.domains.has(name)) throw new Error(`domain '${name}' exists`);
    checkRate(rate);
    const d: Domain = { rate: { ...rate }, onTick, phase: 0, ticks: 0, pending: [] };
    this.domains.set(name, d);
    this.order.push(d);
  }

  private get(name: string): Domain {
    const d = this.domains.get(name);
    if (!d) throw new Error(`unknown domain '${name}'`);
    return d;
  }

  hasDomain(name: string): boolean {
    return this.domains.has(name);
  }

  getRate(name: string): Rate {
    return { ...this.get(name).rate };
  }

  /** Change a rate at runtime. A partial phase is rescaled to the new divider (floored, deterministic). */
  setRate(name: string, rate: Rate): void {
    checkRate(rate);
    const d = this.get(name);
    if (rate.div !== d.rate.div) d.phase = Math.floor((d.phase * rate.div) / d.rate.div);
    d.rate = { ...rate };
  }

  /** Domain ticks fired so far. */
  ticks(name: string): number {
    return this.get(name).ticks;
  }

  /**
   * Cross-domain transfer: run `fn` on the destination domain's Nth upcoming tick (N = delayTicks, min 1),
   * just before that tick's onTick. Latency is counted in destination ticks, so it scales with that clock.
   */
  schedule(dest: string, delayTicks: number, fn: () => void): void {
    const d = this.get(dest);
    d.pending.push({ due: d.ticks + Math.max(1, delayTicks), seq: this.seq++, fn });
    d.pending.sort((a, b) => a.due - b.due || a.seq - b.seq);
  }

  advance(subTicks: number): void {
    for (let i = 0; i < subTicks; i++) {
      this.subTicks++;
      for (const d of this.order) {
        d.phase += d.rate.mul;
        const threshold = d.rate.div * this.subticksPerBase;
        while (d.phase >= threshold) {
          d.phase -= threshold;
          this.fire(d);
        }
      }
    }
  }

  advanceBaseTick(): void {
    this.advance(this.subticksPerBase);
  }

  private fire(d: Domain): void {
    d.ticks++;
    while (d.pending.length > 0 && d.pending[0]!.due <= d.ticks) d.pending.shift()!.fn();
    d.onTick(d.ticks);
  }
}
