// The studio's wall on the Build my PC stage (docs/PC_PARTS.md "Build my PC"): a back wall behind the machine with what the stage's power and network
// plug into, so a build is tried against a real supply and a real link. The mains plate (a Swiss triple socket, `swisssocket3d.ts`: the monitor's plug in
// one, the PC's in another, the third free), the ISP's wall
// port (an RJ45 jack, or a QSFP+ cage for the plan copper cannot carry: `ispPort`) with five lights for the plan's tier, a shelf with the router of the game's tier on it, and the lead from the
// port to the router's WAN port (a patch lead, a direct attach lead, or a patch lead with an adapter where the two ports are unlike: `cagePlug`).
// The machine's own cords (`Machine3D`, `wall` option) go to the outlets and from the router's first LAN port to the case's network jack.
// World frame: x east, y up, z toward the viewer; `MM` = 23 units a mm. The plan is pure (the cords and the camera read it); the wall is built from it.
import { Group, MeshStandardMaterial, type PerspectiveCamera } from 'three';
import { disposeTree, drum, rectBox, SEG, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import type { V3 } from '@/core/render/three/rope';
import { lightJack, type LinkLevels } from '@/features/network/render/jackleds';
import { ispByTier } from '@/features/network/sim/specs';
import { seatPlug } from './cablerig3d';
import { outlinePts, shapeOf, slab } from './casekit3d';
import { cagePlug, qsfpAt, rj45Jack, rj45Plug, type PortKind } from './plugs3d';
import { qsfpLook } from './qsfp3d';
import {
  cageAt,
  CAGE,
  jackAt,
  LED_ON,
  RJ,
  ROUTER_BODY,
  ROUTER_SIZE,
  routerJack,
  routerModel,
  routerPort,
} from './router3d';
import { builtinTheme } from '@/core/render/theme';
import type { ArtSet } from './artset3d';
import { routerInsides } from './routerinside3d';
import { jackLook, type JackLamps } from './rj45jack3d';
import { pinwheel, tripleSocket, TRIPLE } from './swisssocket3d';
import { cableMesh, hangPts, type Env, type Look } from './wires3d';

export { ROUTER_SIZE, routerTier } from './router3d';

/** Units a mm. */
export const MM = 23;
/** The wall's face: its z (the case's back is at 2200, so a plug on the wall reaches out toward it). */
export const WALL_Z = 700;
/** The mains plate (a Swiss triple socket, a 91 mm square frame) and how far it stands off the wall: 18 mm, a recess in it 13 deep. */
export const MAINS = { w: TRIPLE.frame * MM, h: TRIPLE.frame * MM, d: 18 * MM } as const;
/** The ISP's plate (80 x 80 mm) and its jack, a compact RJ45 jack at real size (or a QSFP+ cage, for the plan that copper cannot carry: `ispPort`). */
export const ISP = { w: 80 * MM, h: 80 * MM, d: 13 * MM } as const;
/** What copper carries (10GBASE-T), Mbit/s: a plan above it arrives on a QSFP+ cage, one at or under it on an RJ45 jack. */
const COPPER_MBPS = 10000;
/** The kind of the ISP's plate port a plan arrives on, by its tier (`isp5`, the 20 Gbit/s backbone plan, is a QSFP+ cage); no plan: the plate's RJ45 jack. */
export const ispPort = (tier: number | null): PortKind =>
  (ispByTier(tier ?? 0)?.downMbps ?? 0) > COPPER_MBPS ? 'qsfp' : 'rj45';
/** An RJ45 jack's face, real size (`router3d.ts`): its size, how deep its insert goes. */
const JACK = RJ;
/** How far west of the case's west face the plates start (the case, seen from the start view, hides the wall's points less than this far out when they are under the case's top). */
const PLATE_OFF = 7000;
/** The router's depth from the wall (every tier: its jacks stand in the same place): its body (`router3d.ts`) stands 160 off the wall. The size of each tier is `ROUTER_SIZE`, the model's. */
export const ROUTER_DEPTH = ROUTER_BODY + 160;
const TIERS = [1, 2, 3, 4] as const;

/** A box of the world: x and y, y up. */
export interface Box {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** What the wall is placed by: the case's west face (the rear I/O's), its top and width, and the floor under it. */
export interface WallIn {
  caseX: number;
  caseTop: number;
  caseW: number;
  floorY: number;
}

/** One socket of the mains plate: its recess's middle on the plate's face (a plug goes in along -z), and the turn of a plug in it (radians round z). */
export interface WallSocket {
  at: V3;
  roll: number;
}

export interface WallPlan {
  /** The wall's face: its z and its extent. */
  face: Box & { z: number };
  /**
   * The mains plate: its box and face's z, its screw's point, its three sockets (the monitor's cord goes to the lower left one, the PC's to the lower right one, the
   * top one is free), and each cord's outlet (the socket's mouth) and plug turn, by cable id.
   */
  mains: Box & {
    z: number;
    screw: V3;
    sockets: [WallSocket, WallSocket, WallSocket];
    outlet: { pcmains: V3; monmains: V3 };
    turn: { pcmains: number; monmains: number };
  };
  /** The ISP's plate and its jack's face. */
  isp: Box & { z: number; jack: V3 };
  /** The router: its east end, the shelf's top, the front's z (its jacks' faces are 3 in) and the first LAN jack's and the WAN jack's faces. */
  router: { east: number; base: number; front: number; lan: V3; wan: V3; jacks: V3[] };
  /** What the default view takes in besides the case (a box of the world). */
  frame: Box;
  /** The power lens's plate for the mains: the plate's middle and half-extents (the world). */
  plate: { x: number; y: number; hx: number; hy: number };
  /** Moves with the plan: the stage builds the wall again. */
  key: string;
}

/** The plan: the ISP's plate over the mains plate on the case's west side, above where the case hides the wall from the stage's camera, the router on its shelf by the plates. */
export function wallPlan(i: WallIn): WallPlan {
  const z = WALL_Z,
    x0 = i.caseX - PLATE_OFF,
    row = i.caseTop - 1550;
  const isp: WallPlan['isp'] = {
    x0,
    x1: x0 + ISP.w,
    y0: row,
    y1: row + ISP.h,
    z: z + ISP.d,
    jack: [x0 + ISP.w / 2, row + ISP.h * 0.6, z + ISP.d - 3],
  };
  // (the mains plate under the ISP's, on the same column: the screw of its pinwheel at the plate's middle)
  const my0 = row - 160 - MAINS.h,
    fz = z + MAINS.d,
    mx = x0 + ISP.w / 2,
    my = my0 + MAINS.h / 2;
  const sockets = pinwheel().map((s): WallSocket => ({
    at: [mx + s.x * MM, my + s.y * MM, fz],
    roll: s.roll,
  })) as WallPlan['mains']['sockets'];
  const mains: WallPlan['mains'] = {
    x0: mx - MAINS.w / 2,
    x1: mx + MAINS.w / 2,
    y0: my0,
    y1: my0 + MAINS.h,
    z: fz,
    screw: [mx, my, fz],
    sockets,
    outlet: { pcmains: sockets[2].at, monmains: sockets[1].at },
    turn: { pcmains: sockets[2].roll, monmains: sockets[1].roll },
  };
  const east = i.caseX - 300,
    base = row + 200,
    front = z + ROUTER_DEPTH;
  const jacks = [0, 1, 2, 3, 4].map((k): V3 => {
    const j = routerJack(k);
    return [east + j[0], base + j[1], front + j[2]];
  });
  const router: WallPlan['router'] = { east, base, front, lan: jacks[0]!, wan: jacks[4]!, jacks };
  const face = { x0: i.caseX - 14000, x1: i.caseX + i.caseW + 9000, y0: i.floorY, y1: i.floorY + 24000, z };
  const frame = { x0: x0 - 200, x1: east + 200, y0: mains.y0, y1: isp.y1 };
  const r = (v: number) => Math.round(v);
  return {
    face,
    mains,
    isp,
    router,
    frame,
    plate: { x: mx, y: my, hx: MAINS.w / 2, hy: MAINS.h / 2 },
    key: [i.caseX, i.caseTop, i.caseW, i.floorY].map(r).join('|'),
  };
}

/** What a machine on the stage needs of the wall: its plan, and where the stage's monitor lets its power cord out (the world), or null with no monitor. */
export interface StageWall {
  plan: WallPlan;
  monitor: { at: V3; axis: V3 } | null;
}

/** How far behind a jack's face a plug's mouth sits (the plug's body is in the jack's mouth). */
export const JACK_SINK = 20;

/** The router's solid, for a cord to keep off: its box at a tier, shelf included. */
export function routerSolid(p: WallPlan, tier: number | null): { min: V3; max: V3 } {
  const s = ROUTER_SIZE[tier ?? 1] ?? ROUTER_SIZE[1]!;
  return {
    min: [p.router.east - s.w - 200, p.router.base - 160, p.face.z],
    max: [p.router.east + 200, p.router.base + s.h, p.router.front - 6],
  };
}

/** What the wall shows of the game's network: the tiers fitted. The jacks' lights are not here: the link's frames drive them (`lights`). */
export interface WallNet {
  /** The router's and the plan's tiers; null: none fitted. */
  router: number | null;
  isp: number | null;
}

/** A layout rect (y down) over a box of the world (y up). */
const lay = (x0: number, x1: number, y0: number, y1: number): RectLike => ({ x: x0, y: -y1, w: x1 - x0, h: y1 - y0 });
const glow = (c: number): MeshStandardMaterial =>
  new MeshStandardMaterial({ color: 0x131518, emissive: c, emissiveIntensity: 0, roughness: 0.3 });

const WALL = 0x262b38,
  PLATE = 0xcfd2d8,
  STEEL = 0x1c1d20,
  NEON = 0x3be3ff;

export class StudioWall {
  readonly root = new Group();
  private router: Group | null = null;
  private lead: Group | null = null;
  /** The ISP's plate with the jack of the plan's port, and that port's kind as built (null: not yet). */
  private plate: Group | null = null;
  private plateKind: PortKind | null = null;
  /** The router's tier as built (`undefined`: not yet), and the router and plan the lead is built for. */
  private built: number | null | undefined = undefined;
  private shown = '';
  /** The five lights of the plan's tier on the ISP's plate, and the router's own lights and its jacks' (the link and activity lights of each jack). */
  private dots: MeshStandardMaterial[] = [];
  private status: MeshStandardMaterial[] = [];
  private jacks: (JackLamps | null)[] = [];
  private net: WallNet = { router: null, isp: null };
  /** What takes the router's board away again (its art, its reveals), once it has one. */
  private insides: (() => void) | null = null;

  /** `art`: the set that bakes the router's die and runs its reveals (the stage's queue, run by `lod`); none: the router is its shell alone (the tests). */
  constructor(
    readonly plan: WallPlan,
    net: WallNet,
    private readonly art?: ArtSet,
  ) {
    this.buildStatic();
    this.set(net);
  }

  /** What the wall shows now: the plate's port for the plan, the router of this tier (a new one is built), the plan's lights, the patch lead. A new router has every jack light out until `lights` sets them. */
  set(net: WallNet): void {
    this.net = { ...net };
    if (ispPort(net.isp) !== this.plateKind) this.buildPlate(ispPort(net.isp));
    if (net.router !== this.built) this.buildRouter(net.router);
    const key = `${net.router}|${net.isp}`;
    if (key !== this.shown) {
      this.shown = key;
      this.buildLead(net.router !== null && net.isp !== null);
    }
    this.dots.forEach((m, k) => {
      m.emissiveIntensity = net.isp !== null && k < net.isp ? 2.2 : 0;
    });
    // (the front row is the router's power: lit with a plan on its line, dim without)
    for (const m of this.status)
      m.emissiveIntensity = net.router !== null && net.isp !== null ? LED_ON : net.router !== null ? LED_ON * 0.4 : 0;
  }

  /**
   * The lights of the router's jacks, from the link's frames (`network/render/jackleds.ts`): the first LAN jack, where the PC's cord plugs in, and the WAN jack, where the
   * patch lead from the wall goes. The other three jacks have no cable and stay dark. Nothing here sets a level by itself.
   */
  lights(v: LinkLevels): void {
    lightJack(this.jacks[0], v.lan);
    lightJack(this.jacks[4], v.wan);
  }

  /** Per frame: the router's shell fades for the camera's zoom and its board shows through (`routerInsides`), the die's tiles ask for what the camera needs. */
  lod(cam: PerspectiveCamera, H: number, dpr: number): void {
    this.art?.look(cam, H, dpr);
  }

  dispose(): void {
    this.insides?.();
    this.insides = null;
    this.art?.dispose();
    disposeTree(this.root);
    this.root.clear();
  }

  // ------------------------------------------------------------------ the still parts
  private buildStatic(): void {
    const { plan: p, root: R } = this,
      z = p.face.z,
      f = p.face;
    const wall = mat(WALL, { roughness: 0.92 }),
      skirt = mat(0x1d1e22, { roughness: 0.7 }),
      plate = mat(PLATE, { roughness: 0.42 });
    // the wall, a slab behind its face, and its skirting along the floor
    R.add(
      rectBox(lay(f.x0, f.x1, f.y0, f.y1), z - 600, z, wall),
      softBox(lay(f.x0, f.x1, f.y0, f.y0 + 1800), z, z + 180, skirt, 40),
    );
    // the mains plate: a Swiss triple socket round its screw (three recesses, each with its three contact holes)
    const m = p.mains,
      steel = mat(0xb9babf, { metalness: 0.9, roughness: 0.3 }),
      black = mat(0x050608, { roughness: 0.9 });
    tripleSocket(R, { x: m.screw[0], y: m.screw[1], z, face: m.z, look: { plate, black, steel } });
    // the ISP's plate (`buildPlate`: a slab with its port's opening, the port in it, as the plan's) and a lit lamp for each tier of the plan along its foot
    const t = p.isp;
    for (let k = 0; k < 5; k++) {
      const lamp = glow(NEON);
      this.dots.push(lamp);
      R.add(drum(t.x0 + ISP.w * (0.2 + k * 0.15), -(t.y0 + ISP.h * 0.2), t.z - 2, t.z + 14, 0.9 * MM, lamp, SEG.part));
    }
    // the shelf under the router: a board on two brackets
    const r = p.router,
      shelf = mat(0x2a2d32, { roughness: 0.5 }),
      w = ROUTER_SIZE[4]!.w + 400;
    R.add(softBox(lay(r.east - w + 200, r.east + 200, r.base - 160, r.base), z, r.front + 200, shelf, 30));
    for (const bx of [r.east - w + 520, r.east - 320])
      R.add(
        rectBox(
          lay(bx - 80, bx + 80, r.base - 1100, r.base - 160),
          z,
          z + ROUTER_DEPTH * 0.7,
          mat(STEEL, { roughness: 0.5 }),
        ),
      );
  }

  // ------------------------------------------------------------------ the ISP's plate
  /** The ISP's plate with the port the plan arrives on (`ispPort`): an RJ45 jack, or a QSFP+ cage for the plan copper cannot carry. The lamps along its foot are the wall's (`buildStatic`). */
  private buildPlate(kind: PortKind): void {
    this.plateKind = kind;
    if (this.plate) {
      this.root.remove(this.plate);
      disposeTree(this.plate);
      this.plate = null;
    }
    const { plan: p } = this,
      t = p.isp,
      [jx, jy] = t.jack,
      g = new Group(),
      steelShell = mat(0x959aa3, { metalness: 0.8, roughness: 0.44 });
    const w = kind === 'qsfp' ? CAGE.w : JACK.w,
      h = kind === 'qsfp' ? CAGE.h : JACK.h,
      hole = outlinePts(lay(jx - w / 2, jx + w / 2, jy - h / 2, jy + h / 2), 0);
    g.add(
      slab(
        shapeOf(outlinePts(lay(t.x0, t.x1, t.y0, t.y1), 240, undefined, SEG.cornerCoarse), [hole]),
        p.face.z,
        t.z,
        mat(PLATE, { roughness: 0.42 }),
        70,
      ),
    );
    if (kind === 'qsfp') cageAt(g, jx, jy, t.jack[2], qsfpLook(steelShell));
    else {
      // (a wall jack has no lights of its own)
      const look = jackLook(steelShell);
      for (const l of [look.link, look.act] as MeshStandardMaterial[]) l.emissiveIntensity = 0;
      jackAt(g, jx, jy, t.jack[2], look);
    }
    g.name = 'wall.isp';
    this.plate = g;
    this.root.add(g);
  }

  // ------------------------------------------------------------------ the router of a tier
  private buildRouter(tier: number | null): void {
    this.built = tier;
    this.insides?.();
    this.insides = null;
    if (this.router) {
      this.root.remove(this.router);
      disposeTree(this.router);
      this.router = null;
    }
    this.status = [];
    this.jacks = [];
    if (tier === null) return;
    // (the shared model, router3d.ts: its east end, feet and front on the shelf's plan; the wall hides its back, so it has none; the first LAN jack and the WAN jack
    // have lights of their own, all out until `lights` sets them: the PC's cord and the patch lead go there, the other three jacks have no cable)
    const r = this.plan.router,
      m = routerModel(tier, { depth: ROUTER_BODY, rear: false, drive: [0, 4] }),
      g = new Group();
    // (the board lies in the shell, in the router's frame: one group places both)
    const rig = new Group();
    rig.position.set(r.east, r.base, r.front);
    rig.add(m.root);
    g.add(rig);
    if (this.art) this.insides = routerInsides(this.art, builtinTheme(), tier, rig, m);
    this.status = m.status;
    this.jacks = m.jacks;
    g.name = 'wall.router';
    this.router = g;
    this.root.add(g);
  }

  // ------------------------------------------------------------------ the patch lead
  private buildLead(on: boolean): void {
    if (this.lead) {
      this.root.remove(this.lead);
      disposeTree(this.lead);
      this.lead = null;
    }
    if (!on) return;
    const { plan: p } = this,
      g = new Group(),
      look: Look = { r: 40, base: '#caa24a', accent: null },
      tone = 0xcaa24a;
    const end = (at: V3, plug: { body: Group; l: number }) =>
      seatPlug({ at: [at[0], at[1], at[2] - JACK_SINK], axis: [0, 0, 1] }, plug);
    // (each end follows its port, and the port at the other end: two RJ45 jacks take a patch lead, two QSFP+ cages a direct attach lead, and a lead between unlike ports is a patch lead with an adapter in the cage)
    const jack = rj45Jack(MM, look.r, tone),
      cage = qsfpAt(MM, look.r, tone),
      plate = ispPort(this.net.isp),
      wan = routerPort(this.net.router);
    const a = end(p.isp.jack, plate === 'qsfp' ? cagePlug(cage, wan) : rj45Plug(jack)),
      b = end(p.router.wan, wan === 'qsfp' ? cagePlug(cage, plate) : rj45Plug(jack));
    g.add(a.root, b.root);
    const env: Env = { planes: [{ n: [0, 0, 1], d: p.face.z + 80 }], solids: [routerSolid(p, this.net.router)] };
    g.add(
      cableMesh(
        hangPts(a.strands[0]!, b.strands[0]!, look, env, { slack: 1.12, extra: 500, stiff: 0.35, n: 30 }),
        look,
      ),
    );
    g.name = 'wall.lead';
    this.lead = g;
    this.root.add(g);
  }
}

/** The plan's tier of a game's plan id (`isp3` is 3), or null. */
export const ispTier = (id: string | null | undefined): number | null => {
  const k = /^isp(\d+)$/.exec(id ?? '');
  return k ? Number(k[1]) : null;
};
/** Which tiers the router can be. */
export const ROUTER_TIERS = TIERS;
