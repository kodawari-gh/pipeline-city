// The power leads inside the case (machine3d.ts, `buildCables`): the 24-pin and the CPU's 8-pin out of the tray into their sockets.
import { Group } from 'three';
import { tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD, GEO } from '../../layout/layout';
import { ACCENT } from '../../devices';
import { atxPlug, epsPlug, fromSlot, grommet, hangPts } from '../wires3d';
import { nth } from './keys';
import { addRig } from './rigs';
import type { CableRig, HangOpts, Inside, MachineParts, Object3D, RectLike, RopeEnd } from './types';

/** A lead from a slot in the tray into its socket on the board: what differs between the 24-pin and the CPU's 8-pin. */
interface Lead {
  id: 'atx' | 'cpu';
  name: string;
  target: string;
  slot: RectLike;
  strands: number;
  o: HangOpts & { n: number; stiff: number; lead: number };
  model: (accent: string) => { root: Object3D; strands: RopeEnd[] };
  seat: CableRig['seat'];
  engage: number;
}

/** A power lead out of its slot in the tray into its socket. */
function* powerLead(m: MachineParts, c: Inside, p: Lead): Generator<void> {
  const g = tag(new Group(), `cable.${p.id}`);
  const look = c.lead(p.id),
    accent = ACCENT(c.T, p.id),
    fixed = fromSlot(p.slot, p.strands),
    { o, env } = { o: p.o, env: c.env };
  m.wires.add(grommet(p.slot, m.grommets));
  addRig(
    m,
    {
      id: p.id,
      name: p.name,
      target: p.target,
      look,
      env,
      fixed,
      model: () => p.model(accent),
      seat: p.seat,
      canSeat: true,
      engage: p.engage,
      seated: (ex) => ex.map((e, i) => hangPts(nth(fixed, i), e, look, env, o)),
      deck: c.deck,
      n: o.n,
      stiff: o.stiff,
      lead: o.lead,
      power: c.fed,
    },
    { g, seated: c.on(p.id) },
  );
  m.wires.add(g);
  yield;
}

/** The 24-pin: from a tall slot in the gutter into the right-angle socket on the board's east edge. */
function* atx(m: MachineParts, c: Inside): Generator<void> {
  const r = GEO.atx;
  yield* powerLead(m, c, {
    id: 'atx',
    name: 'the 24-pin',
    target: 'atx',
    slot: { x: c.gx + 200, y: r.y + r.h / 2 - 340, w: 60, h: 680 },
    strands: 12,
    o: { natural: true, stiff: 0.7, n: 20, lead: 90 },
    model: (accent) => atxPlug(r, accent),
    seat: { at: [r.x + r.w, -(r.y + r.h / 2), BOARD_Z + 85], axis: [1, 0, 0] },
    engage: 140,
  });
}

/** The CPU's 8-pin: from a slot in the tray over the board's top edge, down into the socket from the glass side. */
function* cpu(m: MachineParts, c: Inside): Generator<void> {
  const r = GEO.cpw;
  yield* powerLead(m, c, {
    id: 'cpu',
    name: 'the CPU 8-pin',
    target: 'cpw',
    slot: { x: r.x - 60, y: BD.y - 270, w: r.w + 120, h: 60 },
    strands: 4,
    o: { natural: true, stiff: 0.75, n: 22, lead: 110 },
    model: (accent) => epsPlug(r, accent),
    seat: { at: [r.x + r.w / 2, -(r.y + r.h / 2), BOARD_Z + 160], axis: [0, 0, 1] },
    engage: 110,
  });
}

/** The 24-pin and the CPU's 8-pin, each if it stands. */
export function* boardLeads(m: MachineParts, c: Inside): Generator<void> {
  if (c.has('atx')) {
    yield* atx(m, c);
  }
  if (c.has('cpu')) {
    yield* cpu(m, c);
  }
}
