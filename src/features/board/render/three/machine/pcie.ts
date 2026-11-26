// One PCIe power lead (machine3d.ts, the cables in the case): out of its grommet by the card's slot, into the card's power socket on its top edge.
import { Group } from 'three';
import { tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { PCIE_RAILS } from '../../layout/layout';
import { ACCENT } from '../../devices';
import { CARD_PLUG, standingPlug } from '../cables3d';
import { fromSlot, grommet, hangPts } from '../wires3d';
import { nth } from './keys';
import { addRig } from './rigs';
import type { Inside, MachineParts, Object3D, PcieKind, RopeEnd } from './types';

/** Where a PCIe lead goes: the card's socket the sim dealt it, its slot in the gutter, and the card. */
interface Deal {
  k: number;
  id: PcieKind;
  connected: boolean;
  target: string | null;
  sock: { x: number; y: number; z: number } | undefined;
  card: { alsoFade: (o: Object3D) => () => void } | undefined;
}

/** One PCIe lead from its own grommet in the gutter up into a card's top edge, or loose. */
export function* pcieLead(m: MachineParts, c: Inside, d: Deal): Generator<void> {
  const { k, sock, card } = d;
  // (the slot lies along x, as the plug's pins do: the four strands run side by side and never turn over)
  const sy = sock ? sock.y + 240 : (PCIE_RAILS[0]?.y ?? 0) + 300 + k * 260,
    slot = { x: c.gx + 60 + k * 170, y: sy + (k % 2) * 90, w: 150, h: 60 };
  const g = tag(new Group(), `cable.${d.id}`),
    accent = ACCENT(c.T, d.id),
    look = c.lead(d.id),
    fixed = fromSlot(slot, 4);
  // with no card to take it, its model is built at a stand-in seat over its grommet
  const at = sock ?? { x: slot.x + slot.w / 2, y: slot.y - 500, z: BOARD_Z + 300 },
    top = at.z + 300,
    o = { natural: true, slack: 1.05, stiff: 0.6, n: 24 },
    { env } = c;
  m.wires.add(grommet(slot, m.grommets));
  addRig(
    m,
    {
      id: d.id,
      name: "the card's power socket",
      target: d.target,
      look,
      env,
      fixed,
      model: () => ({
        root: standingPlug(at, accent, top),
        strands: [0, 1, 2, 3].map((i): RopeEnd => ({
          at: [at.x + (i - 1.5) * (CARD_PLUG.w / 4), -at.y, top + 2],
          dir: [0, 0, 1],
        })),
      }),
      seat: { at: [at.x, -at.y, at.z], axis: [0, 0, 1] },
      canSeat: Boolean(sock),
      engage: 110,
      seated: (ex) => ex.map((e, i) => hangPts(nth(fixed, i), e, look, env, o)),
      deck: c.deck,
      n: o.n,
      stiff: o.stiff,
      lead: look.r * 2.5,
      power: c.fed,
    },
    { g, seated: d.connected, fade: sock && card ? () => card.alsoFade(g) : undefined },
  );
  m.wires.add(g);
  yield;
}
