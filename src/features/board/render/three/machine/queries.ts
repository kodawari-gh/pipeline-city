// What the machine answers (machine3d.ts): its lights, its loop, its cables' runs, its boxes and its picks, and the lenses' looks on its parts.
// `MachineLive` (live.ts) is this with its frame, its level of detail and its side panel.
import { radiatorFlow } from '../cooler3d';
import { airBodies, bodyBox, boardRoots, partBox, withoutDoor } from './bodies';
import { pickId } from './detail';
import { powerGlow, thermal } from './power';
import { cableRuns, heldCables } from './rigs';
import { MachineParts } from './state';
import type { AirBody, Box3, CableRig, CableRun, LightId, Object3D, RadiatorFlow, Role, V3 } from './types';

export class MachineQueries extends MachineParts {
  /** The RGB's lights in the scene by the lamp cap (`Room3D.liveLights`, `LIGHT_ORDER`: `case`, `spill`). Set once built and when the cap changes. */
  setLights(live: ReadonlySet<LightId>): void {
    this.rgb.visible = live.has('case');
    this.spill.visible = live.has('spill');
  }

  /** Where the loop's hoses seat (the hot one first, the pump's end first): the airflow lens runs the coolant along them. Empty with no loop. */
  loopPaths(): readonly (readonly V3[])[] {
    return this.hosePaths;
  }

  /** The radiator's lanes and ports as the model has them, for the lens's water (null with no radiator). */
  loopRadiator(): RadiatorFlow | null {
    return this.rad ? radiatorFlow(this.rad.fit) : null;
  }

  /**
   * The cables that carry power, as the power lens follows them (docs/render/power.md): each one's strands as the sleeves were made from them, in the order the
   * power goes, and whether its plug is in or a hand holds it. A snapshot of the machine as built: `cablesRev` moves when one of them is built again.
   */
  cableRuns(): CableRun[] {
    return cableRuns(this);
  }

  get cablesRev(): number {
    return this.runsRev;
  }

  /** The cables a hand holds now (the plug hides the built cable: the hand draws its own). The set is reused: read it at once. */
  heldCables(): ReadonlySet<string> {
    return heldCables(this);
  }

  /** A part's box in the machine's space (its device id), or null: the power lens hangs its words over it. */
  partBox(id: string): { min: V3; max: V3 } | null {
    return partBox(this, id);
  }

  /**
   * Keep these parts in full detail whatever the distance (each with all under it), and every part from the zoom `ceil` in (screen pixels
   * per world unit): Build my PC holds what the player points at or what a step moves, and swaps nothing at its own view or closer.
   */
  holdDetail(held: readonly Object3D[], ceil = Infinity): void {
    this.partLod?.hold(held, ceil);
  }

  /** The board's pieces: everything on the root that is not the case, the cables or a light (a board swap lifts these). */
  boardRoots(): Object3D[] {
    return boardRoots(this);
  }

  /** The cables (the leads, the cords out of the case): what Build my PC picks a plug in, with `boardRoots` for what stands in front of them. */
  cableRoots(): Object3D[] {
    return [this.wires];
  }

  /**
   * What a pick of `id` means: a part of a NIC (`pcie2.nic-xtal`) is the card itself until its cooler has gone and it shows its parts. The die's blocks (`pcie2.nic-mac`) are not asked: they are hit only through the live layer, once the lid is gone.
   */
  pickId(id: string | null): string | null {
    return pickId(this, id);
  }

  /** The box of the case without its side panel: the parts, the cables and the mains cord stay in or near it (a picture of the machine frames this: `BuildStage.capture`). */
  bodyBox(): Box3 {
    return bodyBox(this);
  }

  /**
   * The boxes the air meets, in the machine's space (the airflow lens, air/plan.ts): the case's fixed bodies (the board, the basement, the drive cage, the
   * memory bank) and each part that stands in the way (cooler, cards, sinks, radiator), by device id. The parts' are the boxes the cables go round.
   */
  airBodies(): AirBody[] {
    return airBodies(this);
  }

  /** Run `draw` with the side panel taken off: the picture of an open machine, whatever the panel's kind (a steel one hides the inside, a glass one tints it). */
  withoutDoor<T>(draw: () => T): T {
    return withoutDoor(this, draw);
  }

  /**
   * The airflow lens's thermal view (docs/render/air.md): each part with a skin glows by its temperature (`temps`, by device id; a part not in it is at the
   * scale's foot) on the thermal scale from `lo` to `hi`, and eases there. Null puts every part's own look back.
   */
  thermal(temps: ReadonlyMap<string, number> | null, lo = 25, hi = 60): void {
    thermal(this, temps, { lo, hi });
  }

  /**
   * The power lens's view of the parts (docs/render/power.md): each power part (`roles`, by device id: a use, a hub or a source) glows by what it draws (`levels`, by
   * device id, 0 to 1 on the power scale) in its role's colour, red for the ids in `warn`. A part with no role (a heatsink, a radiator, a hose) keeps its own look, under
   * the veil. With no `roles` every part in `levels` is a use. Null puts every part's own look back. The basement's shroud is taken off while the lens shows: the
   * supply and the fan hub, two of its hubs, stand under it, and its top sheet hides them from above.
   */
  powerGlow(
    levels: ReadonlyMap<string, number> | null,
    warn: ReadonlySet<string> = new Set(),
    roles: ReadonlyMap<string, Role> | null = null,
  ): void {
    powerGlow(this, { levels, warn, roles });
  }

  /** A draggable cable's rig (plughand3d.ts holds it live), or null. */
  rig(kind: string): CableRig | null {
    return this.rigs.get(kind) ?? null;
  }

  /** The group a cable's rig is built into (the hand hides its built cable while it holds it), or null. */
  cableGroup(kind: string): Object3D | null {
    return this.built.get(kind)?.g ?? null;
  }
}
