// The machine live (machine3d.ts): `MachineQueries` (queries.ts) with its frame, its level of detail and its side panel.
import { DARK } from '@/features/network/render/jackleds';
import { doorOpen, setOpen, takeDoor } from './door';
import { frame, moving } from './frame';
import { levelOfDetail } from './lod';
import { MachineQueries } from './queries';
import type { LinkLevels, Machine3D, PerspectiveCamera, Snapshot } from './types';

/** A frame's times and lights: the time step, the side panel's own (default the same) and the network's lights (default dark). */
export interface FrameOpts {
  dt: number;
  doorDt?: number;
  net?: LinkLevels;
}

/** The machine's frame, level of detail and side panel: `Machine3D` (machine.ts) is this with its build and its cables. */
export class MachineLive extends MachineQueries {
  /**
   * `doorDt`: the side panel's own time, when it runs at another pace than the rest (Build my PC's steps at 2x: the panel keeps up with them). `net`: what the network gives
   * the jacks' lights this frame (`LinkLeds.step`): the PC end's go to the jack the cable is in, every other jack stays dark.
   */
  frame(s: Snapshot | null, t: FrameOpts): void {
    const { dt, doorDt = dt, net = DARK } = t;
    frame(this, s, { dt, doorDt, net });
  }

  /**
   * Something of the machine moves after the last `frame`: a fan turns or coasts, the side panel swings, the strip pulses or blinks, the disk LED
   * flickers, a part eases to its state's look. A frame drawn on demand (docs/render/load.md) keeps drawing meanwhile.
   */
  get moving(): boolean {
    return moving(this);
  }

  /**
   * Level of detail, per frame after the camera moved: each reveal gets the zoom seen at its point (screen pixels per unit there, less toward the
   * edge of the view: `seenZoom`, so the bands are the 2D ones), then each surface asks for the texture tiles it needs.
   */
  lod(cam: PerspectiveCamera, H: number, dpr: number): void {
    levelOfDetail(this, cam, { H, dpr });
  }

  /** Open the case's outer side whatever the zoom (a part or a cable is dragged, a tutorial target is inside), or let the zoom decide again. */
  setOpen(inside: boolean, busy = false): void {
    setOpen(this, inside, busy);
  }

  /** Shut the side panel now, whatever held it open (the zoom decides again at its next crossing). */
  closeDoor(): void {
    const d = this.door;
    if (d) {
      d.inside = false;
      d.manual = false;
    }
  }

  /** The side panel as `from` (the machine this one replaces) had it: how far open, and what holds it, so a new build does not swing it again. */
  takeDoor(from: Machine3D): void {
    takeDoor(this, from);
  }

  /** Open the side panel if it is shut (or opening), shut it if it is open: the player's say holds until the zoom crosses its band again. */
  toggleDoor(): void {
    const d = this.door;
    if (d) {
      d.manual = !(d.manual ?? (d.zoomOpen || d.inside));
    }
  }

  /** Is the side panel open (or opening)? */
  get doorOpen(): boolean {
    return doorOpen(this);
  }

  /** How far the side panel has really swung (0 shut, 1 open), as drawn: null when the case has no panel. A step waits for this, not for a clock (`BuildStage.door`). */
  get doorT(): number | null {
    return this.door ? this.door.t : null;
  }
}
