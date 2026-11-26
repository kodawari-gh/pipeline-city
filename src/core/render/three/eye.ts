// The eye's adaptation for a view drawn on demand (docs/render/case.md "Build my PC's frame"). The meter gives a luminance; the eye eases
// its exposure toward the one that shows it at the key. A view drawn on demand draws while the eye moves, and each drawn frame meters
// again. A reading that differs a little (a baked tile, the last bits of a float) must not start the eye again: the view would never rest.

/** A reading moves the goal only when it asks for an exposure this far (in log, about 3 %) from the goal: less is not seen. */
const EYE_DEAD = 0.03;
/** The eye is at its goal within this (in log): the view draws no more frames for it. */
const EYE_DONE = 1e-3;
/**
 * The readings that come after a hold ends and are dropped: the meter answers a frame or more after its draw, so the first ones are of the picture the hold was
 * for (a lens that darkened it on purpose), not of the one now on the screen.
 */
export const EYE_SKIP = 2;

export class Eye {
  /** The exposure's factor the meter asks for, and where the eye stands on its way to it. */
  goal = 1;
  seen = 1;
  private held = false;
  private skip = 0;

  /** `key`: the luminance times exposure to hold (the key over the base exposure); `range`: the factor's limits. */
  constructor(
    private readonly key: number,
    private readonly range: readonly [number, number],
  ) {}

  /**
   * Hold the eye where it stands (`on`) or let it read again. A lens that darkens the picture on purpose (the power lens) holds it: the eye would take the dark for a
   * dim room and lift the exposure back up, and the lens would show nothing.
   */
  hold(on: boolean): void {
    if (this.held && !on) {
      this.skip = EYE_SKIP;
    }
    this.held = on;
  }

  /** Is the eye held? */
  get holding(): boolean {
    return this.held;
  }

  /** A reading of the meter (null: none came). A held eye drops it, and so do the first ones after the hold. */
  read(lum: number | null): void {
    if (lum === null) {
      return;
    }
    if (this.held) {
      return;
    }
    if (this.skip > 0) {
      this.skip--;
      return;
    }
    const g = Math.min(this.range[1], Math.max(this.range[0], this.key / lum));
    if (Math.abs(Math.log(g / this.goal)) > EYE_DEAD) {
      this.goal = g;
    }
  }

  /** One tick: the eye eases toward its goal over about a second. Returns where it stands. */
  step(dt: number): number {
    this.seen *= (this.goal / this.seen) ** (1 - 0.01 ** dt);
    return this.seen;
  }

  /** The eye is still on its way: the view keeps drawing. */
  get moving(): boolean {
    return Math.abs(Math.log(this.goal / this.seen)) > EYE_DONE;
  }
}
