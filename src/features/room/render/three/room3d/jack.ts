// The router's LAN jack on its east side (rj45jack3d's or, on the edge router, a QSFP+ cage), and what the router's build needs.
import { Group } from 'three';
import { lowDetail } from '@/core/render/three/detail';
import { mat } from '@/core/render/three/materials';
import { routerLan } from '@/features/board/render/layout/layout';
import { QSFP_SIDE_K } from '@/features/board/render/three/plugs3d';
import { QSFP, qsfpFace, qsfpLamps, qsfpLook } from '@/features/board/render/three/qsfp3d';
import { jackFace, jackLook } from '@/features/board/render/three/rj45jack3d';
import { qsfpPorts } from '@/features/board/render/three/router3d';
import type { JackLamps, MeshStandardMaterial, RoomParts } from './types';

/** The LAN jack on the router's east side: the board's rear I/O's (rj45jack3d's `jackFace`): 160 across, 124 tall, its mouth 180 deep. */
const PORT = { w: 160, h: 124 },
  DEEP = 180;

/** What a router's build needs: the room, the router's group, the jacks' steel and where the LAN jack is. */
export interface RouterKit {
  room: RoomParts;
  router: Group;
  jackSteel: MeshStandardMaterial;
  lan: ReturnType<typeof routerLan>;
}

/** The kit of the router in `router`: the jacks' steel, and where the LAN jack is. */
export function routerKit(room: RoomParts, router: Group): RouterKit {
  return {
    room,
    router,
    jackSteel: mat(0x95_9a_a3, { metalness: 0.8, roughness: 0.44 }),
    lan: routerLan(),
  };
}

/** The LAN jack on its east side, where the lead's plug stays (turned to face east), and its lights. */
export function sideJack(tier: number, { jackSteel, lan }: RouterKit): { side: Group; look: JackLamps } {
  const side = new Group(),
    look = jackLook(jackSteel);
  side.rotation.y = Math.PI;
  if (qsfpPorts(tier) > 0) {
    // (the edge router's LAN ports are QSFP+ cages, this one too: at the scale the board's jack is drawn, its two lights in a block over it)
    const w = QSFP.cage.w * QSFP_SIDE_K,
      h = QSFP.cage.h * QSFP_SIDE_K,
      s = { y0: lan.y - h / 2, y1: lan.y + h / 2, z0: -lan.z - w / 2, z1: -lan.z + w / 2 },
      cage = qsfpLook(jackSteel);
    qsfpFace(side, -lan.x, s, DEEP, cage, !lowDetail());
    qsfpLamps(side, -lan.x, s, '-y', look, cage, true);
  } else {
    const s = { y0: lan.y - PORT.h / 2, y1: lan.y + PORT.h / 2, z0: -lan.z - PORT.w / 2, z1: -lan.z + PORT.w / 2 };
    jackFace(side, -lan.x, s, DEEP, look, !lowDetail());
  }
  return { side, look };
}
