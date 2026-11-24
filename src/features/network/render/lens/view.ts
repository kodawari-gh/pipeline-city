// The network lens in 3D (docs/render/net.md "The network lens"): the path data takes, lit in the room's own space. The plan's line runs from the wall plate to the router, the
// real LAN lead from the router to the machine's jack; data that comes in is a cyan comet, results that go out are violet, and the faster the link the faster the comets. The
// room goes dark under a veil, and the four limits of the link (plan, router, port, drive: the same ladder as the network panel) are pinned to the pieces they belong to as
// light DOM pills, the slowest tagged as the limit. What is built once (the shape) changes only when the lead or the machine does; a snapshot only rewrites a few numbers.
import { Group, type PerspectiveCamera, type Scene } from 'three';
import type { Snapshot } from '@/worker/protocol';
import { viewInset } from '@/app/hover';
import { NET_VEIL } from '@/core/render/three/powerscale';
import { ROUTER_SPOT, ispPlate } from '@/features/board/render/layout/layout';
import { AirTags3D } from '@/features/board/render/three/air/airtags';
import { makeVeil } from '@/features/board/render/three/air/ribbons';
import type { Machine3D } from '@/features/board/render/three/machine3d';
import { netLensReady } from '../netvis';
import { NetFlows } from './flows';
import { netDraw, netShape, type NetAnchors, type NetDraw, type NetShape } from './shape';

/** The path's places for this machine, from the room's props and the machine's own lead. */
function anchorsOf(s: Snapshot, machine: Machine3D): NetAnchors {
  const plate = ispPlate(),
    rs = ROUTER_SPOT;
  const lan = machine.cableRuns().find((r) => r.id === 'lan');
  const os = s.storage.find((d) => d.hasOs),
    box = os ? machine.partBox(os.deviceId) : null;
  return {
    plate: { at: [plate.x + plate.w / 2, -(plate.y + plate.h / 2), 96], hw: plate.w / 2, hh: plate.h / 2 },
    router: { at: [rs.x + rs.w / 2, -(rs.y + rs.h / 2), 800], hw: rs.w / 2, hh: rs.h / 2 },
    lan: lan ? { strands: lan.strands, seated: lan.seated, jack: lan.seat.at, r: lan.r } : null,
    drive: box ? [(box.min[0] + box.max[0]) / 2, box.max[1], (box.min[2] + box.max[2]) / 2] : null,
  };
}

export class NetView3D {
  private readonly group = new Group();
  private readonly veil = makeVeil(NET_VEIL);
  private readonly tags = new AirTags3D();
  private flows: NetFlows | null = null;
  private shape: NetShape | null = null;
  private anchors: NetAnchors | null = null;
  private drawn: NetDraw | null = null;
  private machine: Machine3D | null = null;
  private seen: Snapshot | null = null;
  private rev = -1;
  private clock = 0;
  /** Milliseconds a frame of the lens takes on the main thread, smoothed (a new machine's shape included). */
  cost = 0;

  constructor(
    scene: Scene,
    private readonly dom: HTMLElement | null = null,
  ) {
    this.group.add(this.veil);
    this.group.visible = false;
    scene.add(this.group);
    if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __net?: NetView3D }).__net = this;
  }

  // (for the developer: `window.__net`)
  get shapeNow(): NetShape | null {
    return this.shape;
  }
  get drawNow(): NetDraw | null {
    return this.drawn;
  }
  get anchorsNow(): NetAnchors | null {
    return this.anchors;
  }
  get flowsNow(): NetFlows | null {
    return this.flows;
  }

  /** Is the lens drawing? */
  get shown(): boolean {
    return this.group.visible;
  }

  hide(): void {
    this.group.visible = false;
    this.tags.show(false);
  }

  /** Make the lines of a new machine. */
  private rebuild(s: Snapshot, machine: Machine3D): void {
    this.flows?.dispose();
    this.anchors = anchorsOf(s, machine);
    this.shape = netShape(this.anchors);
    this.flows = new NetFlows(this.shape);
    this.group.add(this.flows.mesh);
    this.seen = null;
  }

  /** Per frame, after the camera. `dt`: game seconds (0 holds the comets); `pxH`: the view's height in pixels. */
  frame(cam: PerspectiveCamera, pxH: number, snap: Snapshot | null, machine: Machine3D | null, dt: number): void {
    if (!snap || !machine || !netLensReady(snap)) {
      this.hide();
      return;
    }
    const t0 = performance.now();
    this.clock = t0 / 1000;
    if (!this.shape || machine !== this.machine || machine.cablesRev !== this.rev) {
      this.machine = machine;
      this.rev = machine.cablesRev;
      this.rebuild(snap, machine);
    }
    const shape = this.shape!,
      flows = this.flows!;
    if (snap !== this.seen) {
      this.seen = snap;
      // (a part fitted or taken out moves the drive's place: the words follow it)
      this.anchors = anchorsOf(snap, machine);
      this.drawn = netDraw(shape, snap, this.anchors);
      this.tags.set(this.drawn.tags, this.clock);
      flows.set(this.drawn);
    }
    flows.frame(cam, pxH, dt, this.clock);
    this.group.visible = true;
    this.tags.show(true);
    const r = this.dom?.getBoundingClientRect();
    if (r)
      this.tags.frame(cam, {
        left: r.left,
        top: r.top,
        width: r.width,
        height: r.height,
        minTop: viewInset.peek().top,
      });
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
