// The machine in 3D (machine3d.ts): `MachineCables` (cabling.ts) with its build, a whole one or a slice at a time, its patch and its end.
import { disposeTree } from '@/core/render/three/geometry';
import { assemble } from './build';
import { MachineCables } from './cabling';
import { sliced } from './slices';
import { start } from './start';
import { drain } from './keys';
import { patch } from './patch';
import type { BakeQueue, Chips3D, MakeOpts, RoomGeo, Shown, Snapshot, StageWall } from './types';

/** What a `Machine3D` is built from besides its snapshot and the room's geometry (the defaults: no dies, in the room, merged, with stand-ins as merged, built now, the whole machine, no wall). */
export interface MachineOpts {
  q: BakeQueue;
  chips?: Chips3D | null;
  inRoom?: boolean;
  merge?: boolean;
  lod?: boolean;
  defer?: boolean;
  shown?: Shown;
  wall?: StageWall | null;
}
/** `make`'s options: the bake queue, the dies and the room as the constructor's, then how it builds. */
export interface MakeMachineOpts extends MakeOpts {
  q: BakeQueue;
  chips: Chips3D | null;
  inRoom: boolean;
}

export class Machine3D extends MachineCables {
  /**
   * `chips`: the live dies (they outlive a rebuild); the CPU's and the cards' faces show them. `inRoom`: false on the Build my PC stage, which has
   * no router. `merge`: false builds it as it was before PERF22's merge and share (the tests compare the two). `lod`: false builds it
   * without the distance stand-ins (the tests compare the two). `defer`: leave the build to `make`, which runs it a slice at a time.
   * `shown` (Build my PC's empty start): `case` is the case alone, with no board in it, no part and no cable (`buildEmpty`); `nothing` is no case either, an empty root.
   * `wall` (Build my PC): the studio's wall, which the mains cords and the LAN lead go to, in place of the room's hidden socket and router (`buildWallCords`).
   */
  constructor(s: Snapshot | null, geo: RoomGeo, o: MachineOpts) {
    const {
      q,
      chips = null,
      inRoom = true,
      merge = true,
      lod = merge,
      defer = false,
      shown = 'machine',
      wall = null,
    } = o;
    super({ q, geo, chips, inRoom, shown, wall });
    start(this, s, merge);
    if (!defer) {
      drain(assemble(this, s, { geo, merge, lod }));
    }
  }

  /**
   * The machine built a slice at a time, as `Room3D.make` builds the room (docs/render/load.md "Build my PC, first open"): the steps are the
   * constructor's, and `slice` (a task of its own; the page answers in it) is awaited only when `budget` ms have passed since the last one.
   * `stop` ends the build (null): the caller no longer wants it. The machine is not in a scene while it builds.
   */
  static async make(s: Snapshot | null, geo: RoomGeo, o: MakeMachineOpts): Promise<Machine3D | null> {
    const merge = o.merge ?? true,
      lod = o.lod ?? merge;
    const { q, chips, inRoom } = o;
    const m = new Machine3D(s, geo, {
      q,
      chips,
      inRoom,
      merge,
      lod,
      defer: true,
      shown: o.shown ?? 'machine',
      wall: o.wall ?? null,
    });
    return (await sliced(assemble(m, s, { geo, merge, lod }), o)) ? m : null;
  }

  /**
   * Bring the machine in line with a snapshot that differs from it by whole sticks, drives or cards (Build my PC: a fit or a removal builds no
   * new machine). A part that goes is hidden (the stand-ins of `partLod` know a part by its hiding) and its entries leave the shared lists; a part
   * that comes is built alone and merged alone, as the build does it; the sockets they take or free change their look; the cables hang again.
   * False, with nothing changed, when the change is more than that (another kind of part, a host's fans, a new board or case, a grave grown
   * too big): the caller builds the machine again.
   */
  patch(s: Snapshot, geo: RoomGeo): boolean {
    return patch(this, s, geo);
  }

  /** Take it down: the meshes, the texture tiles, the bake jobs and the 2D art behind them. */
  dispose(): void {
    this.art.dispose();
    this.ramMap?.dispose();
    this.partLod?.dispose();
    disposeTree(this.root);
  }
}
