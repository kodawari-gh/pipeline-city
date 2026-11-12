// The eye's adaptation for a view drawn on demand (docs/render/case.md "Build my PC's frame"). The meter gives a luminance; the eye eases
// its exposure toward the one that shows it at the key. A view drawn on demand draws while the eye moves, and each drawn frame meters
// again. A reading that differs a little (a baked tile, the last bits of a float) must not start the eye again: the view would never rest.

/** A reading moves the goal only when it asks for an exposure this far (in log, about 3 %) from the goal: less is not seen. */
export const EYE_DEAD = 0.03;
/** The eye is at its goal within this (in log): the view draws no more frames for it. */
export const EYE_DONE = 1e-3;

export class Eye {
  /** The exposure's factor the meter asks for, and where the eye stands on its way to it. */
  goal = 1;
  seen = 1;

  /** `key`: the luminance times exposure to hold (the key over the base exposure); `range`: the factor's limits. */
  constructor(private readonly key: number, private readonly range: readonly [number, number]) {}

  /** A reading of the meter (null: none came). */
  read(lum: number | null): void {
    if (lum === null) return;
    const g = Math.min(this.range[1], Math.max(this.range[0], this.key / lum));
    if (Math.abs(Math.log(g / this.goal)) > EYE_DEAD) this.goal = g;
  }

  /** One tick: the eye eases toward its goal over about a second. Returns where it stands. */
  step(dt: number): number {
    this.seen *= (this.goal / this.seen) ** (1 - Math.pow(0.01, dt));
    return this.seen;
  }

  /** The eye is still on its way: the view keeps drawing. */
  get moving(): boolean { return Math.abs(Math.log(this.goal / this.seen)) > EYE_DONE; }
}
