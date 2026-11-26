// The room and the machine built again from the snapshot (board3d.ts `rebuild`): a new room when its tiers change, a new machine when its key
// does (its programs link while the old one shows), else only the cables that moved.
import { effective } from '@/app/graphics';
import { disposeTree } from '@/core/render/three/geometry';
import { freeWhenLinked, linked, startPrograms, startShadowPrograms } from '@/core/render/three/compile';
import { Room3D } from '@/features/room/render/three/room3d';
import { eyeBlocks } from '@/features/room/render/three/roomplan';
import { setLayoutTier } from '../../layout/layout';
import { Machine3D, machineKey } from '../machine3d';
import { whileHidden } from '../whileHidden';
import { cheap, current, install, roomAt, uncheap } from './build';
import type { Core } from './world';

/** The room the boot built a step at a time (`Room3D.make`), and the key it was built for. */
export interface Made {
  room: Room3D;
  key: string;
}

/** A new room for the tiers (`made` stands in for it when it was built for the same key); the old one's materials go once their programs have linked. */
function newRoom(c: Core, at: ReturnType<typeof roomAt>, made: Made | null): Room3D {
  const { held, stage } = c;
  held.roomKey = at.key;
  setLayoutTier(at.tier, at.caseTier);
  // (the old room's materials go once their programs have linked: one deleted while it links logs GL warnings)
  if (held.room) {
    const old = held.room.root;
    uncheap(c, old);
    stage.scene.remove(old);
    held.room.dispose();
    freeWhenLinked(stage.renderer, old, () => {
      disposeTree(old);
    });
  }
  const room = made?.room ?? new Room3D(stage.studio);
  held.room = room;
  held.blocks = eyeBlocks(room.geo);
  stage.probe.at(...room.probeAt);
  held.bounces = 3;
  held.probed = false;
  room.setShadows(effective.peek().shadows);
  room.setLights(effective.peek().lights, effective.peek().lightShadows > 0);
  stage.shadows.reset();
  stage.scene.add(room.root);
  cheap(c, room.root);
  held.machKey = '';
  // (the frame links the new room's programs before it draws it)
  held.warmed = false;
  return room;
}

/** A new machine for the snapshot `s`: in at once on the first picture, else its programs link while the old machine shows. */
function newMachine(c: Core, s: ReturnType<typeof current>, room: Room3D): void {
  const { held, stage, live } = c;
  // a machine that still links is out of date
  if (held.next) {
    uncheap(c, held.next.m.root);
  }
  held.next?.m.dispose();
  held.next = null;
  const m = new Machine3D(s, room.geo, { q: stage.bakes, chips: live.chips });
  m.setLights(room.liveLights); // (the RGB's lights by the lamp cap, before its programs link)
  if (!held.machine || !held.warmed) {
    install(c, m);
    return;
  }
  // its programs link while the old machine shows (hidden meanwhile, the old one's lights do not count twice)
  cheap(c, m.root);
  const { renderer, camera, scene } = stage;
  const programs = whileHidden(held.machine.root, () => [
    ...startPrograms(renderer, m.root, camera, { scene, fades: m.fades }),
    ...startShadowPrograms(renderer, scene, camera, m.root),
  ]);
  if (linked(programs)) {
    install(c, m);
  } else {
    held.next = { m, programs };
  }
}

/**
 * `roomOnly`: the boot builds the room, lets the page take a turn, then calls again for the machine. `made`: the room the boot built a step
 * at a time (`Room3D.make`), and the key it was built for: it stands in for the new room unless the snapshot has moved on meanwhile.
 */
export function rebuild(c: Core, roomOnly = false, made: Made | null = null): void {
  const { held, live } = c;
  const s = current(c),
    at = roomAt(s);
  let kept = made;
  if (kept && kept.key !== at.key) {
    kept.room.dispose();
    disposeTree(kept.room.root);
    kept = null;
  }
  const room = at.key !== held.roomKey || !held.room ? newRoom(c, at, kept) : held.room;
  if (roomOnly) {
    return;
  }
  const mk = machineKey(s);
  if (mk !== held.machKey || !held.machine) {
    held.machKey = mk;
    newMachine(c, s, room);
  } else if (s) {
    (held.next?.m ?? held.machine).syncCables(s, room.geo);
  } // a plug in or out: only its cable hangs again

  live.chips.update(s);
  room.setKeys(s?.tray ?? []);
  // the cables and keys this rebuild added or removed: a root in `cheaps` takes them in its sync (`cheap` skips it)
  for (const r of [room.root, held.machine?.root, held.next?.m.root]) {
    if (r) {
      held.cheaps.get(r)?.sync();
    }
  }
  c.stage.demand.ask(); // (a save loaded, a part fitted, a plug in or out)
}
