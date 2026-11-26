// The drives' cables (machine3d.ts, `buildCables`): each drive's data cable from its port on the board's edge into a slot in the gutter; at the
// drive, its data and power cables leave the sockets on its end and go back through the cage.
import { Group } from 'three';
import { tag } from '@/core/render/three/pick';
import { GEO } from '../../layout/layout';
import { cageGrommet } from '../drivecage3d';
import { drivePlug } from '../drive3d';
import { TRAY_Z, cableMesh, fromSlot, grommet, hangPts, hung, sataPlug } from '../wires3d';
import { reversed } from '../power/runs';
import { idx } from '../parts';
import type { DeviceSnap, Inside, Look, MachineParts, RectLike, RopeEnd, V3 } from './types';

/** The data cable's look, and the power cable's. */
const DATA: Look = { r: 15, base: '#4e5360', accent: null },
  BLACK: Look = { r: 19, base: '#16171b', accent: null };

/** The slot in the gutter the data cables come through, as tall as the board's SATA ports, or null with none. */
function sataSlot(c: Inside): RectLike | null {
  const [first] = GEO.sata,
    last = GEO.sata.at(-1);
  return first !== undefined && last !== undefined
    ? { x: c.gx - 30, y: first.y - 60, w: 60, h: last.y + last.h - first.y + 120 }
    : null;
}

/** One cable at the drive: its plug pushed into the receptacle, the cable back into the slot in the tray sheet behind its cage (`cageGrommet`). */
function driveCable(m: MachineParts, d: DeviceSnap, at: { g: Group; slot: RectLike; sock: V3; power: boolean }): void {
  const { g, slot, sock, power } = at,
    look = power ? BLACK : DATA;
  const p = drivePlug(power, sock, power ? 0x16_17_1b : 0xb3_26_2f);
  const back: RopeEnd = {
    at: [
      slot.x + slot.w * (power ? 0.62 : 0.38),
      Math.min(-(slot.y + 80), Math.max(-(slot.y + slot.h - 80), sock[1] - 260)),
      TRAY_Z - 30,
    ],
    dir: [0, 0, 1],
  };
  const pts = hangPts(p.end, back, look, { planes: [], solids: [] }, { slack: 1.15, extra: 60, stiff: 0.7, n: 16 });
  g.add(p.root, cableMesh(pts, look));
  // (the power cable is the lens's: from the slot behind the cage, where the supply's lead comes in, to the drive)
  if (power) {
    m.runs.set(`${d.id}:power`, {
      id: `${d.id}:power`,
      strands: [reversed(pts)],
      r: look.r,
      seated: true,
      seat: { at: sock, axis: [-1, 0, 0] },
      held: false,
      fed: true,
    });
  }
}

/** A drive's cables: the data cable from its port into the gutter, and at the drive its data and power cables (the power one only with a supply). */
function driveCables(m: MachineParts, c: Inside, { d, ends }: { d: DeviceSnap; ends: readonly RopeEnd[] }): Group {
  const i = idx(d.slot),
    port = GEO.sata[i],
    end = ends[i],
    g = tag(new Group(), d.id);
  if (port && end) {
    const p = sataPlug(port);
    g.add(p.root, hung(p.end, end, DATA, c.env, { natural: true, slack: 1.05, stiff: 0.7, n: 18 }));
  }
  const drive = m.driveSockets.get(d.slot),
    slot = cageGrommet(m.cages.find((x) => x.trays.some((t) => t.slot === i)) ?? m.cage);
  if (!drive) {
    return g;
  }
  driveCable(m, d, { g, slot, sock: drive.data, power: false });
  // (the power cable is the supply's: with none fitted there is no such cable)
  if (c.s.devices.some((x) => x.kind === 'psu')) {
    driveCable(m, d, { g, slot, sock: drive.power, power: true });
  }
  return g;
}

/** SATA: each drive's cables, one drive at a time. */
export function* sataCables(m: MachineParts, c: Inside): Generator<void> {
  const slot = sataSlot(c);
  if (slot) {
    m.wires.add(grommet(slot, m.grommets));
  }
  const ends = slot ? fromSlot(slot, GEO.sata.length) : [];
  for (const d of c.s.devices) {
    if (d.kind !== 'storage' || !d.slot.startsWith('sata')) {
      continue;
    }
    m.wires.add(driveCables(m, c, { d, ends }));
    yield;
  }
}
