// A fan's cord to the case's fan hub (machine3d.ts, the fans' cords): out of the hub's slot to the fan's plug.
import { rectBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { hubHeaders } from '@/features/room/render/desk/props/case';
import { CASE_Z } from '@/features/room/render/three/roomplan';
import { FAN_HUB } from '../../layout/layout';
import { nth } from './keys';
import type { CableRig, Cord } from './types';
import { cord } from './cord-kit';

/** A case fan's cord: the hub's header on its top edge, the cord down to it from the slot. */
export function hubCord(k: Cord): CableRig {
  const [hx] = k.p.seat,
    from = k.hubEnds[1 + hubHeaders().findIndex((h) => h.x === hx)] ?? nth(k.hubEnds, 0);
  return cord(
    k,
    { fixed: from, env: k.c.env, o: { slack: 1.2, extra: 80, n: 14 } },
    {
      model: () => ({
        root: rectBox(
          { x: hx - 34, y: FAN_HUB.y - 70, w: 68, h: 70 },
          CASE_Z + 206,
          CASE_Z + 276,
          mat(0x1d_1e_22, { roughness: 0.5 }),
        ),
        strands: [{ at: [hx, -(FAN_HUB.y - 70), CASE_Z + 240], dir: [0, 1, 0] }],
      }),
      seat: { at: [hx, -FAN_HUB.y, CASE_Z + 240], axis: [0, 1, 0] },
      engage: 60,
    },
  );
}
