// The parts that move in a frame: the motions played and the link LEDs.
import { signal } from '@preact/signals';
import { lowDetail } from '@/core/render/three/detail';
import type { Snapshot } from '@/worker/protocol';
import { worldPace } from '@/core/render/lod/lod';
import { OUTSIDE } from '@/features/board/sim/buildpreset';
import { LinkLeds } from '@/features/network/render/jackleds';
import type { Anim, LinkLevels } from './types';
import { LOD_CEIL } from './tuning';
import { StageWatch } from './watch';

export abstract class StageParts extends StageWatch {
  /** The Ethernet jacks' lights: they follow the frames the port carries, on the game's clock (`network/render/jackleds.ts`). */
  protected readonly leds = new LinkLeds();
  /** The player's Side panel button holds the panel open. */
  protected wantOpen = false;
  /** A job holds the panel open from its first step that needs the inside; at its end the panel is the zoom's again (`Machine3D.setOpen`). */
  protected jobOpen = false;
  /** The motion that plays now (`Anim`), or null. */
  protected anim: Anim | null = null;
  /** Is the side panel open (or opening)? `insideOpen`, as a signal for the toolbar. */
  readonly open = signal(false);
  /** One frame of the parts: the side panel, the jacks' lights, the machine, the hand, the screen and the stand-ins; the lights' levels it gives. */
  protected stepParts(dt: number): { snap: Snapshot; net: LinkLevels } {
    const { camera } = this.ctx;
    // (a plug the player holds that goes into the case opens the side panel, as a drag does in the game; a cord outside it does not)
    const { kind } = this.hand,
      handIn = kind !== null && kind !== '' && !OUTSIDE.has(kind) && !this.status.peek().busy;
    // (busy: the shut side panel's plate takes a ray only while no step plays, so a click on it opens it: `idAt`)
    this.machine.setOpen(
      this.wantOpen || this.jobOpen || handIn,
      this.status.peek().busy || this.anim !== null || handIn,
    );
    const inside = this.insideOpen;
    if (inside !== this.open.peek()) {
      this.open.value = inside;
    }
    const snap = this.snapshot;
    // the Ethernet jacks' lights follow the frames the port carries, on the game's clock (still while paused or off); the wall's router and the machine's jacks take the same levels
    const net = this.leds.step(snap, snap.powered ? dt * worldPace(this.simSpeed.peek()) : 0);
    this.wall?.lights(net);
    // (the panel keeps the pace of the steps: at 2x it opens in half the time, as the wait for it (`door`) is half)
    this.machine.frame(snap, { dt, doorDt: this.status.peek().busy ? dt * this.rate() : dt, net });
    this.hand.frame(Math.min(dt, 0.05) * this.rate(), camera);
    this.screen(snap, dt);
    // no stand-in (partlod.ts) from this stage's own zoom in; the wheel limit stays inside it at every aspect (machine3d.test.ts), so nothing else is held.
    // Low: the stand-ins draw by the size rule at every zoom (the Low phone's own view: 585 draws to 223), and the whole machine is held while a step runs
    if (lowDetail()) {
      this.machine.holdDetail(this.anim || this.status.peek().busy ? [this.machine.root] : []);
    } else {
      this.machine.holdDetail([], (LOD_CEIL * this.H) / this.frameView().height);
    }
    return { snap, net };
  }
}
