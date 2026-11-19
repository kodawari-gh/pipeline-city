// The power lens in 3D (docs/render/power.md): the machine's power as light in its own space. The cables are the real ones (`Machine3D.cableRuns`: the strands the
// sleeves are made from), the board's copper is its own traces, and the runs behind the tray are drawn dim through the parts; pulses run along them toward the part, closer
// and faster the more watts (flows.ts). The parts glow by what they draw on the power scale (`Machine3D.powerGlow`), the room goes dark under a veil, a ring and words
// mark every cable that is out. The words (`powerDraw`) are pinned to 3D points as light DOM pills, with a bar that tells the scale.
// What is built once (the shape) changes only when a cable, a part or the board does; a snapshot only rewrites a few numbers.
import { Box3, Group, Vector3, type PerspectiveCamera, type Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { LAYOUT_CASE, LAYOUT_TIER } from '../../layout/layout';
import { buildBuses, type Bus } from '../../wiring/routes';
import { AirTags3D } from '../air/airtags';
import { psuBay } from '../air/plan';
import { makeVeil } from '../air/ribbons';
import type { Machine3D } from '../machine3d';
import { slotRects } from '../slots3d';
import { PowerFlows } from './flows';
import { powerLedger } from './ledger';
import { powerDraw, powerShape, type PowerDraw, type PowerShape } from './net';

/** What the room multiplies by under the lens: a dark with a little blue, so the amber of the power stands out of it. */
const VEIL: readonly [number, number, number] = [0.15, 0.16, 0.22];

/**
 * The words of detail (each part's draw) show while the case takes more than `BIG` of the view's height, and go while it takes less than `SMALL`: in the room's view the
 * machine is small and a dozen pills would cover it. The two differ so that a view that rests between them does not flicker.
 */
const BIG = 0.52, SMALL = 0.45;

/** The eight corners of the case's box (the machine without its cords): the lens measures how big the machine is on the screen by them. */
function caseCorners(machine: Machine3D): Vector3[] {
  const box = new Box3();
  for (const o of machine.caseRoots) box.expandByObject(o);
  if (box.isEmpty()) return [];
  const a = box.min, b = box.max;
  return [0, 1, 2, 3, 4, 5, 6, 7].map((i) => new Vector3(i & 1 ? b.x : a.x, i & 2 ? b.y : a.y, i & 4 ? b.z : a.z));
}

export class PowerView3D {
  private readonly group = new Group();
  private readonly veil = makeVeil(VEIL);
  private readonly tags = new AirTags3D();
  private flows: PowerFlows | null = null;
  private shape: PowerShape | null = null;
  private drawn: PowerDraw | null = null;
  private machine: Machine3D | null = null;
  private seen: Snapshot | null = null;
  private key = '';
  private rev = -1;
  private held = '';
  private buses: { key: string; list: Bus[] } | null = null;
  private glowing = false;
  private clock = 0;
  private corners: Vector3[] = [];
  private detail = true;
  private readonly p = new Vector3();
  /** Milliseconds a frame of the lens takes on the main thread, smoothed (a new machine's shape included). */
  cost = 0;

  constructor(scene: Scene, private readonly dom: HTMLElement | null = null) {
    this.group.add(this.veil);
    this.group.visible = false;
    scene.add(this.group);
    if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __power?: PowerView3D }).__power = this;
  }

  // (for the developer: `window.__power`)
  get shapeNow(): PowerShape | null { return this.shape; }
  get drawNow(): PowerDraw | null { return this.drawn; }
  get flowsNow(): PowerFlows | null { return this.flows; }
  /** The words pinned now: those of detail only while the machine is big on the screen. */
  get wordsNow(): PowerDraw['tags'] { return this.words(); }

  /** Is the lens drawing? */
  get shown(): boolean { return this.group.visible; }

  hide(): void {
    this.group.visible = false;
    this.tags.show(false);
    // (the parts take their own look back)
    if (this.glowing) { this.machine?.powerGlow(null); this.glowing = false; }
  }

  /** The board's traces for this tier and case. */
  private busesFor(): Bus[] {
    const key = `${LAYOUT_TIER}|${LAYOUT_CASE}`;
    if (!this.buses || this.buses.key !== key) this.buses = { key, list: buildBuses() };
    return this.buses.list;
  }

  /** Make the lines of a new machine. */
  private rebuild(s: Snapshot, machine: Machine3D): void {
    this.flows?.dispose();
    const shape = powerShape({ s, runs: machine.cableRuns(), buses: this.busesFor(), slots: slotRects(s), psu: psuBay(s), boardZ: BOARD_Z });
    this.shape = shape;
    this.flows = new PowerFlows(shape);
    this.group.add(this.flows.mesh);
    this.seen = null;
    this.held = '';
    this.corners = caseCorners(machine);
  }

  /** The share (0 to 1) of the view's height the case takes: its box's corners, projected. 1 when the eye is in or behind it. */
  private share(cam: PerspectiveCamera): number {
    cam.updateMatrixWorld();
    cam.matrixWorldInverse.copy(cam.matrixWorld).invert();
    let lo = Infinity, hi = -Infinity;
    for (const c of this.corners) {
      this.p.copy(c).applyMatrix4(cam.matrixWorldInverse);
      if (this.p.z > -cam.near) return 1;
      const y = this.p.applyMatrix4(cam.projectionMatrix).y;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    return Math.max(0, (hi - lo) / 2);
  }

  /** The words now: all of them while the machine is big on the screen, the main ones while it is small. */
  private words(): PowerDraw['tags'] {
    return this.drawn ? this.drawn.tags.filter((t) => this.detail || !t.minor) : [];
  }

  /** Per frame, after the camera. `dt`: game seconds (0 holds the pulses); `pxH`: the view's height in pixels. */
  frame(cam: PerspectiveCamera, pxH: number, snap: Snapshot | null, machine: Machine3D | null, dt: number): void {
    if (!snap || !machine) { this.hide(); return; }
    const t0 = performance.now();
    this.clock = t0 / 1000;
    const key = `${LAYOUT_TIER}|${LAYOUT_CASE}|${snap.devices.map((d) => `${d.spec}@${d.slot}`).join(',')}|${snap.cables.map((c) => c.id).join(',')}`;
    if (!this.shape || machine !== this.machine || machine.cablesRev !== this.rev || key !== this.key) {
      if (machine !== this.machine && this.glowing) { this.machine?.powerGlow(null); this.glowing = false; }
      this.machine = machine;
      this.rev = machine.cablesRev;
      this.key = key;
      this.rebuild(snap, machine);
    }
    const shape = this.shape!, flows = this.flows!, held = machine.heldCables(), heldKey = [...held].sort().join(',');
    if (snap !== this.seen || heldKey !== this.held) {
      if (snap !== this.seen) {
        this.seen = snap;
        const draw = powerDraw(shape, snap, powerLedger(snap), (id) => machine.partBox(id));
        this.drawn = draw;
        this.tags.set(this.words(), this.clock);
        machine.powerGlow(draw.parts, draw.warn);
        this.glowing = true;
      }
      this.held = heldKey;
      flows.set(this.drawn!, held);
    }
    flows.frame(cam, pxH, dt, this.clock);
    // (the words of detail come and go with the machine's size on the screen)
    if (this.corners.length) {
      const share = this.share(cam), detail = share > (this.detail ? SMALL : BIG);
      if (detail !== this.detail) { this.detail = detail; this.tags.set(this.words(), this.clock); }
    }
    this.group.visible = true;
    this.tags.show(true);
    const r = this.dom?.getBoundingClientRect();
    if (r) this.tags.frame(cam, { left: r.left, top: r.top, width: r.width, height: r.height });
    this.cost += (performance.now() - t0 - this.cost) * 0.05;
  }

  dispose(): void {
    this.hide();
    this.flows?.dispose();
    this.flows = null;
    this.group.removeFromParent();
    (this.veil.material as { dispose(): void }).dispose();
    this.veil.geometry.dispose();
    this.tags.dispose();
  }
}
