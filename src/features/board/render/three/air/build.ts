// The air of one machine, built from its plan (docs/render/air.md): the grid with the parts' boxes and the case's openings, the flow solved fan by fan,
// and where the air comes in and goes out (the particles are born at the one and die at the other). Pure TS: a test builds it from a plan made by hand.
import * as gridMod from './grid';
import * as solve from './solve';
import type { AirPlan } from './plan';

/** Stiffness of a wall fan: how fast its flow falls as pressure builds against it, units per unit of its radius (a fan blowing into a closed box stalls). */
const STIFF = (2 * Math.PI) / 3;

export class AirSim {
  readonly grid: gridMod.AirGrid;
  readonly field: solve.AirField;
  /** The fan of each field fan, by index: its speed's id (`fanBank`). */
  readonly banks: string[] = [];
  /** Per cell: 0, or the wall (1 + `AirGrid.vent`'s wall number) the air leaves through there. A particle that reaches it is gone. */
  readonly exits: Uint8Array;
  private readonly inlets: { c: number; fan: number; share: number; vent: boolean; wall: number }[] = [];
  private cum = new Float64Array(0);
  /** The sum of the inlets' weights now: no air comes in while it is zero. */
  inflow = 0;
  private lastLevels = '';

  constructor(
    readonly plan: AirPlan,
    cells?: number,
  ) {
    this.grid = new gridMod.AirGrid(plan.min, plan.max, plan.boxes, cells);
    const g = this.grid,
      defs: solve.AirFanDef[] = [];
    this.exits = new Uint8Array(g.cells);
    for (const v of plan.vents) {
      g.vent(v.wall, v.centre, v.shape, v.open);
      const axis = (v.wall >> 1) as 0 | 1 | 2,
        hi = (v.wall & 1) === 1,
        half = g.h[axis]! / 2,
        at: gridMod.V3 = [v.centre[0], v.centre[1], v.centre[2]];
      at[axis] = hi ? g.max[axis] : g.min[axis];
      for (const c of g.footprint(at, axis, v.shape, hi ? -half : half).cells) {
        this.exits[c] = v.wall + 1;
      }
    }
    for (const f of plan.fans) {
      const def =
        f.kind === 'wall'
          ? solve.wallFan(g, f.id, f.wall, f.centre, { r: f.r }, f.into, f.q, STIFF * f.r)
          : solve.innerFan(g, f.id, f.at, f.axis, f.dir, { r: f.r }, f.q);
      if (def.cells.length === 0) {
        continue;
      }
      defs.push(def);
      this.banks.push(f.bank);
      if (f.kind !== 'wall') {
        continue;
      }
      def.cells.forEach((c, n) => {
        if (f.into) {
          this.inlets.push({ c, fan: defs.length - 1, share: Math.abs(def.w[n]!) * f.q, vent: false, wall: f.wall });
        } else {
          this.exits[c] = f.wall + 1;
        }
      });
    }
    for (let c = 0; c < g.cells; c++) {
      if (g.ground[c]! > 0 && this.exits[c]) {
        this.inlets.push({ c, fan: -1, share: g.ground[c]!, vent: true, wall: this.exits[c]! - 1 });
      }
    }
    this.field = new solve.AirField(g, defs);
  }

  /** Solve for up to `ms`: the plan's fans one by one. True when all are done. */
  run(ms: number): boolean {
    return this.field.run(ms);
  }

  /** Set every fan's speed (`levelOf` its bank's id), mix the field, and work out where air comes in. Returns whether the field changed. */
  levels(levelOf: (bank: string) => number): boolean {
    const lv = this.banks.map((b) => levelOf(b));
    const key = lv.map((v) => v.toFixed(3)).join(',');
    if (key === this.lastLevels && this.field.ready) {
      return false;
    }
    this.lastLevels = key;
    lv.forEach((v, i) => this.field.setLevel(i, v));
    this.field.mix();
    // the weight of each inlet: a fan's share of its flow, a vent's conductance times the suction the fans make there (positive pressure sends air out)
    this.cum = new Float64Array(this.inlets.length);
    let sum = 0;
    this.inlets.forEach((n, i) => {
      sum += n.vent ? n.share * Math.max(0, -this.field.pressure(n.c)) : n.share * (lv[n.fan] ?? 0);
      this.cum[i] = sum;
    });
    this.inflow = sum;
    return true;
  }

  /** An inlet cell chosen by weight from a random number `r` in [0, 1): its cell and wall side, or null with no air coming in. */
  inlet(r: number): { c: number; wall: number } | null {
    if (this.inflow <= 0) {
      return null;
    }
    const x = r * this.inflow;
    let lo = 0,
      hi = this.cum.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (this.cum[m]! < x) {
        lo = m + 1;
      } else {
        hi = m;
      }
    }
    const n = this.inlets[lo]!;
    return { c: n.c, wall: n.wall };
  }
}
