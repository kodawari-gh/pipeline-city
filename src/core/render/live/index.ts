import type { Renderer } from 'pixi.js';
import type { Snapshot } from '../../../worker/protocol';
import { buildScene } from './scene';
import { LiveState } from './state';
import { tick } from './tick';
import { touchIrq, touchRam } from './touch';
import type { SceneArgs } from './types';
import { update } from './update';

/**
 * Everything that changes with the sim. The board is dim by default; a bus only lights when the snapshot shows real
 * traffic on it (see `docs/render/live.md`, "Activity"). Power conductors glow in proportion to current. Per-snapshot work
 * redraws a few small Graphics and Texts, per-frame work moves pooled sprites and rotates fans.
 *
 * The work is split by job in this folder: `scene.ts` (build), `update.ts` (per snapshot), `tick.ts` (per frame), `traffic.ts`
 * and `touch.ts` (messages on the buses); the state they share is `state.ts`.
 */
export class Live {
  private readonly s: LiveState;

  constructor(renderer: Renderer) {
    this.s = new LiveState(renderer);
  }

  /** Interior art on top of the board (buses, cable glow, PSU readout, drives, OS badge). Hidden with the interior at far zoom. */
  get root(): LiveState['root'] {
    return this.s.root;
  }

  /** External things that stay at any zoom: the monitor screen content, the USB port LED, the monitor LED, the video cable glow. */
  get ext(): LiveState['ext'] {
    return this.s.ext;
  }

  /** 0..1: how lit the case's disk activity LED is (read by board.ts every frame). */
  get diskLevel(): number {
    return this.s.diskLevel;
  }

  /** (Re)build live objects for a scene. Called when the theme or the installed set changes. The drives and the cards default to none. */
  setScene(scene: SceneArgs): void {
    buildScene(this.s, {
      ...scene,
      drives: scene.drives ?? [],
      gpuCards: scene.gpuCards ?? [],
      tpmModules: scene.tpmModules ?? [],
      npuCards: scene.npuCards ?? [],
    });
  }

  /** The OS badge on the host drive (null: no OS). The dot animates on the game clock in `frame`. */
  setOsBadge(r: LiveState['badgeRect'], phase: LiveState['badgePhase']): void {
    this.s.badgeRect = r;
    this.s.badgePhase = phase;
  }

  setZoom(z: number): void {
    const { s } = this;
    s.zoom = z;
    s.ram.setZoom(z);
    s.gpu.setZoom(z);
    s.disk.setZoom(z);
    s.tpm.setZoom(z);
    s.npu.setZoom(z);
  }

  /** The world rectangle the camera shows (board.ts `onZoom`): cards out of it are not drawn. */
  setView(v: NonNullable<LiveState['view']>): void {
    this.s.view = v;
  }

  /** False while the exterior covers the interior: the per-frame interior work (buses, pulses, drive art, PSU panel) is skipped. */
  setInterior(on: boolean): void {
    this.s.interior = on;
  }

  /** Which cables are plugged in right now (an unplugged cable shows no glow or pulses). */
  setConnected(c: LiveState['connected']): void {
    this.s.connected = c;
  }

  setPlugged(p: boolean): void {
    this.s.plugged = p;
  }

  /**
   * The replay took an interrupt on `line` (`IRQ`): the device that raised it signals the CPU along the path its data takes (a message
   * signalled interrupt, as on a real board): the drive that last worked, the network port, the key. The timer and the other cores are on the die.
   */
  touchIrq(line: number): void {
    touchIrq(this.s, line);
  }

  /** The CPU reached for a RAM address (a fetch, a load, a store): that cell of the sticks lights in the colour of the instruction. */
  touchRam(kind: string, addr: number, core?: number): void {
    touchRam(this.s, kind, { addr, core });
  }

  /** Per-snapshot update. `s` may be null before the sim has started. */
  update(s: Snapshot | null, now: number): void {
    update(this.s, s, now);
  }

  /** Per-frame animation. dt in seconds. */
  frame(dt: number, now: number, paused = false): void {
    tick(this.s, dt, { now, paused });
  }
}
