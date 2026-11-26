// The LAN lead's ends (machine3d.ts, the LAN lead): its look, its router end (the room's router or the studio wall's jack) and its plug for each jack.
import { hexNum } from '../../skins';
import { routerLan } from '../../layout/layout';
import { routerPort } from '../router3d';
import { seatPlug } from '../cablerig3d';
import { boardRj45, cagePlug, qsfpAt, qsfpReal, qsfpSide, rj45Jack, rj45Plug, rj45Real } from '../plugs3d';
import { JACK_SINK, MM as WALL_MM, routerTier } from '../studiowall3d';
import { LAN_LEAD } from './consts';
import type { Jack, Look, Outside, PortKind, Seat, Snapshot } from './types';

/** The lead's look, the tone its plugs are made in, and the kind of port at its router end. */
interface Lead {
  look: Look;
  tone: number;
  rport: PortKind;
}

/**
 * Its router end: a plug in the router's side jack, sunk in its mouth as in the board's, 20 behind the jack's face; the lead leaves its boot. On the studio's
 * wall: the router's first LAN jack, in its front, a real plug in a real jack. Each end follows its port and the port at the other end: a lead between unlike
 * ports is a patch lead with an adapter in the QSFP+ cage, at the router's end with the edge router's cages, or at the card's with the 40G card's.
 */
export function routerEnd(o: Outside, { look, tone, rport }: Lead, now: Jack): ReturnType<typeof seatPlug> {
  const { w } = o;
  if (w) {
    const [x, y, z] = w.plan.router.lan,
      fit =
        rport === 'qsfp'
          ? cagePlug(qsfpAt(WALL_MM, look.r, tone), now.kind)
          : rj45Plug(rj45Jack(WALL_MM, look.r, tone));
    return seatPlug({ at: [x, y, z - JACK_SINK], axis: [0, 0, 1] }, fit);
  }
  const lan = routerLan(),
    fit = rport === 'qsfp' ? cagePlug(qsfpSide(look.r, tone), now.kind) : rj45Plug(boardRj45(look.r, tone));
  return seatPlug({ at: [lan.x - 20, -lan.y, lan.z], axis: [1, 0, 0] }, fit);
}

/** The plug the lead's PC end takes for a jack: a card's jack is real, its latch slot up; the board's is cut to its rear I/O's smaller mouth, its latch notch down; the 40G card's QSFP+ cage takes a QSFP+ plug or an adapter, its pull tab down. */
export const plugFor =
  ({ look, tone, rport }: Lead, seat: Seat) =>
  (j: Jack) =>
  (): ReturnType<typeof seatPlug> => {
    if (j.port === 'board') {
      return seatPlug(seat, rj45Plug(boardRj45(look.r, tone)));
    }
    return j.kind === 'qsfp'
      ? seatPlug(seat, cagePlug(qsfpReal(look.r, tone), rport))
      : seatPlug(seat, rj45Plug(rj45Real(look.r, tone)), Math.PI);
  };

/** The LAN lead's look, the router's port of its tier and the plug's tone. */
export function leadOf(s: Snapshot): Lead {
  return {
    look: { r: 40, base: LAN_LEAD, accent: null },
    rport: routerPort(routerTier(s.net?.router?.id)),
    tone: hexNum(LAN_LEAD),
  };
}
