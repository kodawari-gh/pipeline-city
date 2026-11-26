// What the cables inside the case are built with (machine3d.ts, `buildCables`): the cables that stand, the case's room for them, the gutter
// beside the board, the deck a loose plug lies on and each power lead's look.
import { sleeveOf } from '@/core/render/cable';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { BD } from '../../layout/layout';
import { ACCENT } from '../../devices';
import { caseEnv } from './bodies';
import { standing } from './keys';
import type { CableKind, Env, Look, MachineParts, RigPower, RopePlane, Snapshot, Theme } from './types';

/** The cables inside the case's build context. */
export interface Inside {
  s: Snapshot;
  alive: Snapshot['cables'];
  /** Does the cable stand, and is it plugged in? */
  has: (id: string) => boolean;
  on: (id: string) => boolean;
  env: Env;
  T: Theme;
  /** The gutter's x, east of the board, where the leads come through the tray. */
  gx: number;
  deck: RopePlane;
  /** A power lead's look: its sleeve and the accent of its kind. */
  lead: (kind: CableKind, r?: number) => Look;
  /** A lead's run from the power supply is behind the tray: the power lens draws a stub of it going on into the grommet. */
  fed: RigPower;
}

/** The context of `buildCables` for the snapshot `s`. */
export function insideOf(m: MachineParts, s: Snapshot): Inside {
  const alive = standing(s),
    has = (id: string): boolean => alive.some((c) => c.id === id),
    on = (id: string): boolean => alive.some((c) => c.id === id && c.connected);
  const env = caseEnv(m),
    { T } = m,
    gx = BD.x + BD.w + 420,
    base = sleeveOf(),
    deck: RopePlane = { n: [0, 0, 1], d: BOARD_Z };
  const lead = (kind: CableKind, r = 24): Look => ({ r, base, accent: ACCENT(T, kind) });
  return { s, alive, has, on, env, T, gx, deck, lead, fed: { fed: true } };
}
