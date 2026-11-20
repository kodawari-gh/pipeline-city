// The studio's wall on the Build my PC stage (docs/PC_PARTS.md "Build my PC"): a back wall behind the machine with what the stage's power and network
// plug into, so a build is tried against a real supply and a real link. The mains plate (a Swiss triple socket, `swisssocket3d.ts`: the monitor's plug in
// one, the PC's in another, the third free), the ISP's wall
// jack with five lights for the plan's tier, a shelf with the router of the game's tier on it, and the patch lead from the jack to the router's WAN port.
// The machine's own cords (`Machine3D`, `wall` option) go to the outlets and from the router's first LAN port to the case's network jack.
// World frame: x east, y up, z toward the viewer; `MM` = 23 units a mm. The plan is pure (the cords and the camera read it); the wall is built from it.
import { Group, Mesh, MeshStandardMaterial, SphereGeometry } from 'three';
import { disposeTree, drum, place, rectBox, rod, SEG, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import type { V3 } from '@/core/render/three/rope';
import { seatPlug } from './cablerig3d';
import { outlinePts, shapeOf, slab } from './casekit3d';
import { rj45Jack, rj45Plug } from './plugs3d';
import { jackFace, jackLook, type JackLook } from './rj45jack3d';
import { pinwheel, tripleSocket, TRIPLE } from './swisssocket3d';
import { cableMesh, hangPts, type Env, type Look } from './wires3d';

/** Units a mm. */
export const MM = 23;
/** The wall's face: its z (the case's back is at 2200, so a plug on the wall reaches out toward it). */
export const WALL_Z = 700;
/** The mains plate (a Swiss triple socket, a 91 mm square frame) and how far it stands off the wall: 18 mm, a recess in it 13 deep. */
export const MAINS = { w: TRIPLE.frame * MM, h: TRIPLE.frame * MM, d: 18 * MM } as const;
/** The ISP's plate (80 x 80 mm) and its jack, a compact RJ45 jack at real size. */
export const ISP = { w: 80 * MM, h: 80 * MM, d: 13 * MM } as const;
/** An RJ45 jack's face, real size (`jackFace`: 13.75 mm over its span's depth), how deep its insert goes, how far a plug sits behind its face. */
const JACK = { w: 13.75 * MM, h: 10.7 * MM, deep: 15.5 * MM };
/** How far west of the case's west face the plates start (the case, seen from the start view, hides the wall's points less than this far out when they are under the case's top). */
const PLATE_OFF = 7000;
/** The router's depth (every tier: its jacks stand in the same place) and the pitch of its jacks. */
export const ROUTER_DEPTH = 2400;
const PITCH = 440;
/** The router's size by tier (1 to 4): width and height. The home router has two aerials, the gigabit one stouter ones, the 10G one a lit strip, the core router rack ears. */
export const ROUTER_SIZE: Readonly<Record<number, { w: number; h: number }>> = { 1: { w: 2700, h: 620 }, 2: { w: 3000, h: 700 }, 3: { w: 3300, h: 760 }, 4: { w: 3800, h: 1000 } };
const TIERS = [1, 2, 3, 4] as const;

/** A box of the world: x and y, y up. */
export interface Box { x0: number; x1: number; y0: number; y1: number }

/** What the wall is placed by: the case's west face (the rear I/O's), its top and width, and the floor under it. */
export interface WallIn { caseX: number; caseTop: number; caseW: number; floorY: number }

/** One socket of the mains plate: its recess's middle on the plate's face (a plug goes in along -z), and the turn of a plug in it (radians round z). */
export interface WallSocket { at: V3; roll: number }

export interface WallPlan {
  /** The wall's face: its z and its extent. */
  face: Box & { z: number };
  /**
   * The mains plate: its box and face's z, its screw's point, its three sockets (the monitor's cord goes to the lower left one, the PC's to the lower right one, the
   * top one is free), and each cord's outlet (the socket's mouth) and plug turn, by cable id.
   */
  mains: Box & {
    z: number; screw: V3; sockets: [WallSocket, WallSocket, WallSocket];
    outlet: { pcmains: V3; monmains: V3 }; turn: { pcmains: number; monmains: number };
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
  const z = WALL_Z, x0 = i.caseX - PLATE_OFF, row = i.caseTop - 1550, jy = (b: number) => b + 320;
  const isp: WallPlan['isp'] = { x0, x1: x0 + ISP.w, y0: row, y1: row + ISP.h, z: z + ISP.d, jack: [x0 + ISP.w / 2, row + ISP.h * 0.6, z + ISP.d - 3] };
  // (the mains plate under the ISP's, on the same column: the screw of its pinwheel at the plate's middle)
  const my0 = row - 160 - MAINS.h, fz = z + MAINS.d, mx = x0 + ISP.w / 2, my = my0 + MAINS.h / 2;
  const sockets = pinwheel().map((s): WallSocket => ({ at: [mx + s.x * MM, my + s.y * MM, fz], roll: s.roll })) as WallPlan['mains']['sockets'];
  const mains: WallPlan['mains'] = {
    x0: mx - MAINS.w / 2, x1: mx + MAINS.w / 2, y0: my0, y1: my0 + MAINS.h, z: fz, screw: [mx, my, fz], sockets,
    outlet: { pcmains: sockets[2].at, monmains: sockets[1].at }, turn: { pcmains: sockets[2].roll, monmains: sockets[1].roll },
  };
  const east = i.caseX - 300, base = row + 200, front = z + ROUTER_DEPTH;
  const jacks = [0, 1, 2, 3, 4].map((k): V3 => [east - 520 - k * PITCH, jy(base), front - 3]);
  const router: WallPlan['router'] = { east, base, front, lan: jacks[0]!, wan: jacks[4]!, jacks };
  const face = { x0: i.caseX - 14000, x1: i.caseX + i.caseW + 9000, y0: i.floorY, y1: i.floorY + 24000, z };
  const frame = { x0: x0 - 200, x1: east + 200, y0: mains.y0, y1: isp.y1 };
  const r = (v: number) => Math.round(v);
  return { face, mains, isp, router, frame, plate: { x: mx, y: my, hx: MAINS.w / 2, hy: MAINS.h / 2 }, key: [i.caseX, i.caseTop, i.caseW, i.floorY].map(r).join('|') };
}

/** What a machine on the stage needs of the wall: its plan, and where the stage's monitor lets its power cord out (the world), or null with no monitor. */
export interface StageWall { plan: WallPlan; monitor: { at: V3; axis: V3 } | null }

/** How far behind a jack's face a plug's mouth sits (the plug's body is in the jack's mouth). */
export const JACK_SINK = 20;

/** The router's solid, for a cord to keep off: its box at a tier, shelf included. */
export function routerSolid(p: WallPlan, tier: number | null): { min: V3; max: V3 } {
  const s = ROUTER_SIZE[tier ?? 1] ?? ROUTER_SIZE[1]!;
  return { min: [p.router.east - s.w - 200, p.router.base - 160, p.face.z], max: [p.router.east + 200, p.router.base + s.h, p.router.front - 6] };
}

/** What the wall shows of the game's network. */
export interface WallNet {
  /** The router's and the plan's tiers; null: none fitted. */
  router: number | null;
  isp: number | null;
  /** The link the PC has: off (no cable, no card), idle (plugged in, nothing flows: no OS, the link down), up (it carries traffic), busy (saturated). */
  link: 'off' | 'idle' | 'up' | 'busy';
}

/** A layout rect (y down) over a box of the world (y up). */
const lay = (x0: number, x1: number, y0: number, y1: number): RectLike => ({ x: x0, y: -y1, w: x1 - x0, h: y1 - y0 });
const glow = (c: number): MeshStandardMaterial => new MeshStandardMaterial({ color: 0x131518, emissive: c, emissiveIntensity: 0, roughness: 0.3 });

const WALL = 0x262b38, PLATE = 0xcfd2d8, STEEL = 0x1c1d20, NEON = 0x3be3ff;

/** A jack in a front facing the viewer: built as a wall across x, turned so its mouth opens toward +z, its latch slot down. */
function jackAt(into: Group, x: number, y: number, face: number, look: JackLook): void {
  const row = new Group();
  row.rotation.y = Math.PI / 2;
  jackFace(row, -face, { y0: -(y + JACK.h / 2), y1: -(y - JACK.h / 2), z0: x - JACK.w / 2, z1: x + JACK.w / 2 }, JACK.deep, look);
  into.add(row);
}

export class StudioWall {
  readonly root = new Group();
  private router: Group | null = null;
  private lead: Group | null = null;
  /** The router's tier as built (`undefined`: not yet), and the router and plan the lead is built for. */
  private built: number | null | undefined = undefined;
  private shown = '';
  /** The five lights of the plan's tier on the ISP's plate, and the router's own lights and its jacks' (the link and activity lights of each jack). */
  private dots: MeshStandardMaterial[] = [];
  private status: MeshStandardMaterial[] = [];
  private jacks: { link: MeshStandardMaterial; act: MeshStandardMaterial }[] = [];
  private net: WallNet = { router: null, isp: null, link: 'off' };

  constructor(readonly plan: WallPlan, net: WallNet) {
    this.buildStatic();
    this.set(net);
  }

  /** What the wall shows now: the router of this tier (a new one is built), the plan's lights, the patch lead, the jacks' lights. */
  set(net: WallNet): void {
    this.net = { ...net };
    if (net.router !== this.built) this.buildRouter(net.router);
    const key = `${net.router}|${net.isp}`;
    if (key !== this.shown) { this.shown = key; this.buildLead(net.router !== null && net.isp !== null); }
    this.dots.forEach((m, k) => { m.emissiveIntensity = net.isp !== null && k < net.isp ? 2.2 : 0; });
    for (const m of this.status) m.emissiveIntensity = net.router !== null && net.isp !== null ? 2.2 : net.router !== null ? 0.9 : 0;
    const wan = this.jacks[4], lan = this.jacks[0];
    // (a jack's link light shows a plugged cable, its activity light the traffic: the WAN's follows the PC's, as the plan's traffic is the PC's)
    const act = net.link === 'busy' ? 1.8 : net.link === 'up' ? 0.9 : 0;
    if (wan) { wan.link.emissiveIntensity = net.router !== null && net.isp !== null ? 1.6 : 0; wan.act.emissiveIntensity = act; }
    if (lan) { lan.link.emissiveIntensity = net.link === 'off' ? 0 : 1.6; lan.act.emissiveIntensity = act; }
  }

  dispose(): void { disposeTree(this.root); this.root.clear(); }

  // ------------------------------------------------------------------ the still parts
  private buildStatic(): void {
    const { plan: p, root: R } = this, z = p.face.z, f = p.face;
    const wall = mat(WALL, { roughness: 0.92 }), skirt = mat(0x1d1e22, { roughness: 0.7 }), plate = mat(PLATE, { roughness: 0.42 });
    // the wall, a slab behind its face, and its skirting along the floor
    R.add(rectBox(lay(f.x0, f.x1, f.y0, f.y1), z - 600, z, wall), softBox(lay(f.x0, f.x1, f.y0, f.y0 + 1800), z, z + 180, skirt, 40));
    // the mains plate: a Swiss triple socket round its screw (three recesses, each with its three contact holes)
    const m = p.mains, steel = mat(0xb9babf, { metalness: 0.9, roughness: 0.3 }), black = mat(0x050608, { roughness: 0.9 });
    tripleSocket(R, { x: m.screw[0], y: m.screw[1], z, face: m.z, look: { plate, black, steel } });
    // the ISP's plate: a slab with its jack's opening, the jack in it, a lit lamp for each tier of the plan along its foot
    const t = p.isp, [jx, jy] = t.jack, steelShell = mat(0x959aa3, { metalness: 0.8, roughness: 0.44 }), look = jackLook(steelShell);
    const jackHole = outlinePts(lay(jx - JACK.w / 2, jx + JACK.w / 2, jy - JACK.h / 2, jy + JACK.h / 2), 0);
    R.add(slab(shapeOf(outlinePts(lay(t.x0, t.x1, t.y0, t.y1), 240, undefined, SEG.cornerCoarse), [jackHole]), z, t.z, plate, 70));
    // (a wall jack has no lights of its own)
    for (const l of [look.link, look.act] as MeshStandardMaterial[]) l.emissiveIntensity = 0;
    jackAt(R, jx, jy, t.jack[2], look);
    for (let k = 0; k < 5; k++) {
      const lamp = glow(NEON);
      this.dots.push(lamp);
      R.add(drum(t.x0 + ISP.w * (0.2 + k * 0.15), -(t.y0 + ISP.h * 0.2), t.z - 2, t.z + 14, 0.9 * MM, lamp, SEG.part));
    }
    // the shelf under the router: a board on two brackets
    const r = p.router, shelf = mat(0x2a2d32, { roughness: 0.5 }), w = ROUTER_SIZE[4]!.w + 400;
    R.add(softBox(lay(r.east - w + 200, r.east + 200, r.base - 160, r.base), z, r.front + 200, shelf, 30));
    for (const bx of [r.east - w + 520, r.east - 320]) R.add(rectBox(lay(bx - 80, bx + 80, r.base - 1100, r.base - 160), z, z + ROUTER_DEPTH * 0.7, mat(STEEL, { roughness: 0.5 })));
  }

  // ------------------------------------------------------------------ the router of a tier
  private buildRouter(tier: number | null): void {
    this.built = tier;
    if (this.router) { this.root.remove(this.router); disposeTree(this.router); this.router = null; }
    this.status = []; this.jacks = [];
    if (tier === null) return;
    const { plan: p } = this, r = p.router, s = ROUTER_SIZE[tier] ?? ROUTER_SIZE[1]!, g = new Group(), z0 = p.face.z + 160;
    const x1 = r.east, x0 = x1 - s.w, top = r.base + s.h, bodyM = mat(tier >= 3 ? 0x1b1d21 : STEEL, { roughness: 0.4 }), slate = mat(0x2a2d32, { roughness: 0.4 });
    const led = glow(tier >= 3 ? 0x4aa8ff : NEON);
    this.status.push(led);
    // the body, stopping behind the jacks' inserts, and the front slab (their depth) open at each jack
    const frontZ = r.front, behind = frontZ - JACK.deep - 80;
    g.add(softBox(lay(x0, x1, r.base, top), z0, behind, bodyM, 100));
    g.add(softBox(lay(x0, x1, r.base, r.base + 130), z0, frontZ - 20, slate, 40));
    const holes = r.jacks.map((j) => outlinePts(lay(j[0] - JACK.w / 2, j[0] + JACK.w / 2, j[1] - JACK.h / 2, j[1] + JACK.h / 2), 0));
    g.add(slab(shapeOf(outlinePts(lay(x0, x1, r.base, top), 100, undefined, SEG.cornerCoarse), holes), behind, frontZ, bodyM));
    r.jacks.forEach((j, k) => {
      // (each jack has its own lights: the WAN's and the first LAN's show the link)
      const look = jackLook(mat(0x959aa3, { metalness: 0.8, roughness: 0.44 }));
      this.jacks[k] = { link: look.link as MeshStandardMaterial, act: look.act as MeshStandardMaterial };
      jackAt(g, j[0], j[1], j[2], look);
    });
    // the front's strip with the status lights, vents on top
    const lampY = top - 130;
    g.add(rectBox(lay(x0 + 220, x1 - 220, lampY - 60, lampY + 60), frontZ - 5, frontZ + 8, mat(0x131518, { roughness: 0.5 })));
    const dots = tier >= 4 ? 8 : 4;
    for (let k = 0; k < dots; k++) g.add(drum(x0 + 420 + k * (tier >= 4 ? 190 : 330), -lampY, frontZ + 4, frontZ + 22, 34, led, SEG.smallDisc));
    for (let k = 0; k < 6; k++) g.add(rectBox(lay(x0 + 500 + k * 240, x0 + 590 + k * 240, top - 4, top + 4), z0 + 400, z0 + 1100, mat(0x050608, { roughness: 0.8 })));
    if (tier >= 3) g.add(rectBox(lay(x0 + 140, x1 - 140, top - 22, top + 6), frontZ - 700, frontZ - 60, led));
    if (tier >= 4) {
      // a rack unit: its ears, bolted at the sides
      const ear = mat(0x2a2d32, { roughness: 0.4 }), steel = mat(0xb9babf, { metalness: 0.9, roughness: 0.3 });
      for (const [a, b] of [[x0 - 190, x0], [x1, x1 + 190]] as const) {
        g.add(softBox(lay(a, b, r.base, top), frontZ - 120, frontZ, ear, 20));
        g.add(drum((a + b) / 2, -(r.base + s.h * 0.3), frontZ - 2, frontZ + 14, 36, steel, SEG.smallDisc), drum((a + b) / 2, -(r.base + s.h * 0.72), frontZ - 2, frontZ + 14, 36, steel, SEG.smallDisc));
      }
    }
    if (tier <= 2) {
      // two aerials on hinge knuckles at the back corners, leaning out
      const aerial = mat(0x2a2d32, { roughness: 0.45 }), rad = tier >= 2 ? 105 : 85, len = tier >= 2 ? 2800 : 2400;
      for (const [ax, lean] of [[x0 + 260, -0.14], [x1 - 260, 0.14]] as const) {
        const base: [number, number, number] = [ax, top + 40, z0 + 240], tip: [number, number, number] = [ax + Math.sin(lean) * len, top + 40 + Math.cos(lean) * len, z0 + 90];
        const knuckle = new Mesh(new SphereGeometry(rad * 1.5, SEG.part, SEG.part / 2), aerial);
        knuckle.position.set(...base);
        g.add(place(knuckle), rod(base, tip, rad, aerial, SEG.rod));
      }
    }
    g.name = 'wall.router';
    this.router = g;
    this.root.add(g);
  }

  // ------------------------------------------------------------------ the patch lead
  private buildLead(on: boolean): void {
    if (this.lead) { this.root.remove(this.lead); disposeTree(this.lead); this.lead = null; }
    if (!on) return;
    const { plan: p } = this, g = new Group(), look: Look = { r: 40, base: '#caa24a', accent: null }, tone = 0xcaa24a;
    const end = (at: V3) => seatPlug({ at: [at[0], at[1], at[2] - JACK_SINK], axis: [0, 0, 1] }, rj45Plug(rj45Jack(MM, look.r, tone)));
    const a = end(p.isp.jack), b = end(p.router.wan);
    g.add(a.root, b.root);
    const env: Env = { planes: [{ n: [0, 0, 1], d: p.face.z + 80 }], solids: [routerSolid(p, this.net.router)] };
    g.add(cableMesh(hangPts(a.strands[0]!, b.strands[0]!, look, env, { slack: 1.12, extra: 500, stiff: 0.35, n: 30 }), look));
    g.name = 'wall.lead';
    this.lead = g;
    this.root.add(g);
  }
}

/** The router's tier of a game's router id (`router2` is 2), or null. */
export const routerTier = (id: string | null | undefined): number | null => { const k = /^router(\d+)$/.exec(id ?? ''); return k ? Number(k[1]) : null; };
/** The plan's tier of a game's plan id (`isp3` is 3), or null. */
export const ispTier = (id: string | null | undefined): number | null => { const k = /^isp(\d+)$/.exec(id ?? ''); return k ? Number(k[1]) : null; };
/** Which tiers the router can be. */
export const ROUTER_TIERS = TIERS;
