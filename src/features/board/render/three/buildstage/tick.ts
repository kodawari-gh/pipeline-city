// One step of the parts that move, outside a frame.
import { LEVER_OPEN } from '../boardhw3d';
import { latchOpen, motionFor, motionSeconds, placed, poseAt, solidAt } from '../buildmotion';
import type { Anim, Motion } from './types';
import { ropeSteps, SETTLE_DEPTH, SETTLE_SECONDS, sure } from './tuning';
import { StageParts } from './stepparts';

export abstract class StageTick extends StageParts {
  protected step(dt: number): void {
    const a = this.anim;
    if (!a) {
      return;
    }
    a.t += dt;
    const m = motionFor(a.kind),
      p = poseAt(m, a.t, a.dir);
    for (const x of a.objs) {
      x.o.position.set(...placed(x.base, x.pivot, p.turn, p.offset));
      x.o.rotation.z = x.baseTurn + p.turn;
      x.o.rotation.y = x.baseTilt + p.tilt; // (a card tips about y; a fan on a side mount is built with its own quarter turn about y, which the motion keeps)
    }
    a.drive?.(p, ropeSteps(dt));
    a.fade?.set(solidAt(m, a.t, a.dir));
    this.setStep(p.label);
    turnLatches(a, latchOpen(m, a.t, a.dir));
    if (a.t >= motionSeconds(m)) {
      // a part going in settles: it dips a little past its seat along the way it came, then comes back (a damped spring, 0.3 s)
      if (a.dir === 'in' && !a.drive && a.t < motionSeconds(m) + SETTLE_SECONDS) {
        settle(a, m);
        return;
      }
      // a part that went in is at its seat; a part that came out has faded where its way ended and is hidden there. This frame draws before the
      // job goes on (`done` resumes it after the draw): a part put back at its seat here showed there for a frame, then vanished. The fade's
      // copies go after the hide, or the part would show solid for a frame.
      if (a.dir === 'in') {
        for (const x of a.objs) {
          x.o.position.set(x.base[0], x.base[1], x.base[2]);
          x.o.rotation.z = x.baseTurn;
          x.o.rotation.y = x.baseTilt;
        }
      } else {
        for (const x of a.objs) {
          x.o.visible = false;
        }
      }
      a.end?.();
      a.fade?.end();
      this.anim = null;
      a.done();
    }
  }
}

/** The latches and the CPU's load lever of a part that moves, `open` of the way open (0 shut, 1 open). */
/** Is this latch a socket's lever (`userData.leverOf`: the slot it holds) rather than a DIMM latch? */
function isLever(tag: unknown): boolean {
  return typeof tag === 'string' && tag !== '';
}

function turnLatches(a: Anim, open: number): void {
  for (const l of a.latches) {
    if (isLever(l.userData['leverOf'])) {
      l.rotation.y = LEVER_OPEN * open;
    } // (the load lever lifts about its long side)
    else {
      l.rotation.x = (l.userData['latchEnd'] ?? 0) * 0.5 * open;
    }
  }
}

/** A part going in settles: it dips a little past its seat along the way it came, then comes back (a damped spring, 0.3 s). */
function settle(a: Anim, m: Motion): void {
  const u = (a.t - motionSeconds(m)) / SETTLE_SECONDS,
    far = sure(m.keys.at(-1)).at,
    reach = Math.hypot(...far) || 1;
  const k = (-SETTLE_DEPTH * Math.exp(-5 * u) * Math.sin(u * Math.PI * 3)) / reach;
  for (const x of a.objs) {
    x.o.position.set(x.base[0] + far[0] * k, x.base[1] + far[1] * k, x.base[2] + far[2] * k);
  }
}
