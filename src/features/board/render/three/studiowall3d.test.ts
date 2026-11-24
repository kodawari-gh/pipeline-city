// The studio's wall on the Build my PC stage (studiowall3d.ts): the plan (where the plates, the router and its jacks stand), and the wall built from it (the router of a tier,
// the plan's lights, the patch lead, the router's jack lights that the link's frames drive).
import { describe, expect, it } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { DARK, JACK_GLOW, LinkLeds, type LinkLevels, type LinkSource } from '@/features/network/render/jackleds';
import { quietCanvas } from './testutil';
import {
  ISP,
  MAINS,
  MM,
  ROUTER_SIZE,
  ROUTER_TIERS,
  StudioWall,
  ispPort,
  ispTier,
  routerSolid,
  routerTier,
  wallPlan,
  type WallIn,
  type WallNet,
} from './studiowall3d';

quietCanvas();

const IN: WallIn = { caseX: -2810, caseTop: 5350, caseW: 12690, floorY: -6890 };
const p = wallPlan(IN);
const NET: WallNet = { router: 3, isp: 3 };

describe('wallPlan', () => {
  it('puts both plates on the wall, west of the case, one above the other', () => {
    for (const b of [p.mains, p.isp]) {
      expect(b.x0).toBeGreaterThanOrEqual(p.face.x0);
      expect(b.x1).toBeLessThan(IN.caseX);
      expect(b.y0).toBeGreaterThanOrEqual(p.face.y0);
      expect(b.y1).toBeLessThanOrEqual(p.face.y1);
    }
    expect(p.isp.y0).toBeGreaterThan(p.mains.y1);
    // (one column: the plates' middles are on the same line)
    expect((p.isp.x0 + p.isp.x1) / 2).toBeCloseTo((p.mains.x0 + p.mains.x1) / 2, 5);
  });

  it("makes the plates the size of real ones: a Swiss triple socket 91 x 91 mm, the ISP's plate 80 x 80", () => {
    expect((p.mains.x1 - p.mains.x0) / MM).toBeCloseTo(91, 5);
    expect((p.mains.y1 - p.mains.y0) / MM).toBeCloseTo(91, 5);
    expect(MAINS.w / MM).toBeCloseTo(91, 5);
    expect((p.isp.x1 - p.isp.x0) / MM).toBeCloseTo(ISP.w / MM, 5);
    expect((p.isp.y1 - p.isp.y0) / MM).toBeCloseTo(ISP.h / MM, 5);
  });

  it("lays the plate's three sockets in a pinwheel round its screw, on its face, 120 degrees apart", () => {
    const [x, y, z] = p.mains.screw,
      s = p.mains.sockets;
    expect(x).toBeCloseTo((p.mains.x0 + p.mains.x1) / 2, 5);
    expect(y).toBeCloseTo((p.mains.y0 + p.mains.y1) / 2, 5);
    expect(z).toBe(p.mains.z);
    const turns = s.map((k) => Math.atan2(k.at[1] - y, k.at[0] - x));
    for (const k of s) {
      expect(k.at[2]).toBe(p.mains.z);
      expect(Math.hypot(k.at[0] - x, k.at[1] - y) / MM).toBeCloseTo(17.35, 2);
    }
    // (the top one, the lower left one, the lower right one: a plug's roll is the angle of its socket's outer side from straight up)
    expect(turns[0]).toBeCloseTo(Math.PI / 2, 5);
    expect(turns[1]).toBeCloseTo((210 * Math.PI) / 180 - 2 * Math.PI, 5);
    expect(turns[2]).toBeCloseTo((330 * Math.PI) / 180 - 2 * Math.PI, 5);
    const wrap = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
    s.forEach((k, i) => expect(wrap(k.roll - (turns[i]! - Math.PI / 2))).toBeCloseTo(0, 5));
  });

  it("seats the monitor's plug in the lower left socket and the PC's in the lower right one, the top one free, each turned as its socket", () => {
    const a = p.mains.outlet.pcmains,
      b = p.mains.outlet.monmains,
      s = p.mains.sockets;
    expect(a).toEqual(s[2].at);
    expect(b).toEqual(s[1].at);
    expect(p.mains.turn.pcmains).toBe(s[2].roll);
    expect(p.mains.turn.monmains).toBe(s[1].roll);
    // (the PC's plug is the one on the side of the case, the monitor's the farther one; they are level, below the screw, the free socket above it)
    expect(a[0]).toBeGreaterThan(b[0]);
    expect(a[1]).toBeCloseTo(b[1], 5);
    expect(a[1]).toBeLessThan(p.mains.screw[1]);
    expect(s[0].at[1]).toBeGreaterThan(p.mains.screw[1]);
    expect(a[2]).toBe(p.mains.z);
    expect(b[2]).toBe(p.mains.z);
  });

  it("gives the lens the plate's own outline: its middle and its half-extents are the plate's", () => {
    expect(p.plate.x).toBeCloseTo((p.mains.x0 + p.mains.x1) / 2, 5);
    expect(p.plate.y).toBeCloseTo((p.mains.y0 + p.mains.y1) / 2, 5);
    expect(p.plate.hx).toBeCloseTo((p.mains.x1 - p.mains.x0) / 2, 5);
    expect(p.plate.hy).toBeCloseTo((p.mains.y1 - p.mains.y0) / 2, 5);
  });

  it("puts the jack in the ISP's plate, inside it, and the face of the jack in front of the plate's", () => {
    const [x, y, z] = p.isp.jack;
    expect(x).toBeGreaterThan(p.isp.x0);
    expect(x).toBeLessThan(p.isp.x1);
    expect(y).toBeGreaterThan(p.isp.y0);
    expect(y).toBeLessThan(p.isp.y1);
    expect(z).toBeLessThan(p.isp.z);
    expect(z).toBeGreaterThan(p.face.z);
  });

  it("keeps the router between the ISP's plate and the case, with its jacks in a row, the first LAN east and the WAN west", () => {
    expect(p.router.east).toBeLessThan(IN.caseX);
    expect(p.router.jacks).toHaveLength(5);
    for (let k = 1; k < 5; k++) {
      expect(p.router.jacks[k]![0]).toBeLessThan(p.router.jacks[k - 1]![0]);
      expect(p.router.jacks[k]![1]).toBe(p.router.jacks[0]![1]);
    }
    expect(p.router.lan).toBe(p.router.jacks[0]);
    expect(p.router.wan).toBe(p.router.jacks[4]);
  });

  it("puts the jacks of every tier inside its router, in the same place, and the router clear of the ISP's plate and of the mains plate", () => {
    for (const t of ROUTER_TIERS) {
      const s = ROUTER_SIZE[t]!,
        box = routerSolid(p, t);
      for (const j of p.router.jacks) {
        expect(j[0] - 160, `tier ${t}`).toBeGreaterThan(p.router.east - s.w);
        expect(j[0] + 160, `tier ${t}`).toBeLessThan(p.router.east);
        expect(j[1], `tier ${t}`).toBeGreaterThan(p.router.base);
        expect(j[1], `tier ${t}`).toBeLessThan(p.router.base + s.h);
      }
      expect(box.min[0], `tier ${t}`).toBeGreaterThan(p.isp.x1);
      expect(box.min[1], `tier ${t}`).toBeGreaterThan(p.mains.y1);
      expect(box.max[2], `tier ${t}`).toBeLessThan(p.router.front);
    }
  });

  it('frames the plates and the router, and moves its key with the case', () => {
    for (const x of [p.mains.x0, p.isp.x0, p.router.east]) expect(x).toBeGreaterThanOrEqual(p.frame.x0);
    expect(p.frame.x1).toBeGreaterThanOrEqual(p.router.east);
    expect(p.frame.y0).toBeLessThanOrEqual(p.mains.y0);
    expect(p.frame.y1).toBeGreaterThanOrEqual(p.isp.y1);
    expect(wallPlan(IN).key).toBe(p.key);
    expect(wallPlan({ ...IN, caseX: IN.caseX - 500 }).key).not.toBe(p.key);
    expect(wallPlan({ ...IN, caseTop: IN.caseTop + 500 }).key).not.toBe(p.key);
  });
});

describe("the tiers of the game's ids", () => {
  it("reads a router's and a plan's tier from its id, and nothing from anything else", () => {
    expect(routerTier('router1')).toBe(1);
    expect(routerTier('router4')).toBe(4);
    expect(ispTier('isp5')).toBe(5);
    expect(routerTier(null)).toBeNull();
    expect(routerTier(undefined)).toBeNull();
    expect(routerTier('isp2')).toBeNull();
    expect(ispTier('router2')).toBeNull();
  });
});

/** Every distinct material under an object. */
const materials = (root: Object3D): MeshStandardMaterial[] => {
  const seen = new Set<MeshStandardMaterial>();
  root.traverse((o) => {
    const m = (o as Mesh).material as MeshStandardMaterial | MeshStandardMaterial[] | undefined;
    if (!(o as Mesh).isMesh || !m) return;
    for (const x of Array.isArray(m) ? m : [m]) if (x.emissive) seen.add(x);
  });
  return [...seen];
};
/** How much light the wall gives: the emissive intensities, summed. */
const light = (root: Object3D): number =>
  materials(root).reduce((t, m) => t + (m.emissive.getHex() ? m.emissiveIntensity : 0), 0);
/** The levels the PC's lights have: the router's LAN jack takes its PC's, `[link, activity]`. */
const levels = (lan: [number, number], wan: [number, number]): LinkLevels => ({
  pc: { link: lan[0], act: lan[1] },
  lan: { link: lan[0], act: lan[1] },
  wan: { link: wan[0], act: wan[1] },
  moving: false,
});
/** A snapshot's share: the cord in the board's jack, a router and a plan, the frames the port has carried, the PC on or off. */
const linkSource = (baseTick: number, rx: number, o: { on?: boolean } = {}): LinkSource => ({
  baseTick,
  powered: o.on ?? true,
  power: { tripped: false },
  net: {
    port: { kind: 'board', deviceId: null, mbps: 1000 },
    router: { id: 'router3', name: '10G router', mbps: 10000, clients: 4, visual: 'router-10g' },
    isp: { id: 'isp3', name: 'Fibre', downMbps: 1000, upMbps: 500, clients: 4 },
    frames: { rx, tx: 0 },
  },
});
/** The plan's lamps: the glowing materials in the ISP's colour (a router of tier 3 or 4 has its own blue). */
const lamps = (root: Object3D): number =>
  materials(root).filter((m) => m.emissive.getHex() === 0x3be3ff && m.emissiveIntensity > 0).length;

describe('StudioWall', () => {
  it('builds with a router of every tier, and with none, all of it west of the case', () => {
    for (const router of [null, ...ROUTER_TIERS]) {
      const w = new StudioWall(p, { router, isp: 2 });
      expect(w.root.children.length, `router ${router}`).toBeGreaterThan(3);
      const r = w.root.getObjectByName('wall.router');
      expect(!!r, `router ${router}`).toBe(router !== null);
      if (r) {
        const box = new Box3().setFromObject(r);
        expect(box.isEmpty(), `router ${router}`).toBe(false);
        expect(box.max.x, `router ${router}`).toBeLessThan(IN.caseX);
        expect(box.min.x, `router ${router}`).toBeGreaterThan(p.isp.x1);
        expect(box.max.z, `router ${router}`).toBeLessThanOrEqual(p.router.front + 40);
      }
      w.dispose();
    }
  });

  it("builds the mains plate as a Swiss triple socket: a 91 mm frame standing off the wall to the plan's face", () => {
    const w = new StudioWall(p, NET),
      g = w.root.getObjectByName('wall.mains')!;
    expect(g).toBeDefined();
    const b = new Box3().setFromObject(g);
    expect((b.max.x - b.min.x) / MM).toBeCloseTo(91, 0);
    expect((b.max.y - b.min.y) / MM).toBeCloseTo(91, 0);
    expect(b.min.z).toBeGreaterThanOrEqual(p.face.z - 2);
    expect(b.max.z).toBeLessThanOrEqual(p.mains.z + 1);
    expect(b.max.z).toBeGreaterThan(p.mains.z - 2);
    // (its middle is the plan's screw)
    expect((b.min.x + b.max.x) / 2).toBeCloseTo(p.mains.screw[0], 0);
    expect((b.min.y + b.max.y) / 2).toBeCloseTo(p.mains.screw[1], 0);
    w.dispose();
  });

  it('builds the router that is set: another tier is another router, none takes it away', () => {
    const w = new StudioWall(p, { router: 1, isp: 1 });
    const size = (): number[] | null => {
      const r = w.root.getObjectByName('wall.router');
      if (!r) return null;
      const b = new Box3().setFromObject(r);
      return [b.min.x, b.max.x, b.min.y, b.max.y];
    };
    const t1 = size()!;
    w.set({ router: 4, isp: 1 });
    expect(size()).not.toEqual(t1);
    w.set({ router: null, isp: 1 });
    expect(size()).toBeNull();
    w.set({ router: 1, isp: 1 });
    expect(size()).toEqual(t1);
    w.dispose();
  });

  it('lays the patch lead from the jack to the router only when both are there', () => {
    const w = new StudioWall(p, { router: null, isp: null });
    const lead = (): boolean => !!w.root.getObjectByName('wall.lead');
    expect(lead()).toBe(false);
    w.set({ router: 2, isp: null });
    expect(lead()).toBe(false);
    w.set({ router: 2, isp: 2 });
    expect(lead()).toBe(true);
    w.set({ router: null, isp: 2 });
    expect(lead()).toBe(false);
    w.set({ router: 3, isp: 2 });
    expect(lead()).toBe(true);
    // (the lead runs from the jack's plate across to the router's WAN jack: it is as wide as the two)
    const b = new Box3().setFromObject(w.root.getObjectByName('wall.lead')!);
    expect(b.min.x).toBeLessThan(p.isp.jack[0] + 200);
    expect(b.max.x).toBeGreaterThan(p.router.wan[0] - 200);
    w.dispose();
  });

  it('ends the patch lead as its ports do: an RJ45 plug at each of two jacks, an adapter in a QSFP+ cage that faces a jack, a direct attach lead between two cages', () => {
    const w = new StudioWall(p, { router: 2, isp: 2 });
    // (the plugs of an end, the plug itself first: the lead's first end is at the ISP's plate, its second at the router's WAN port)
    const kinds = (o: Object3D): string[] => {
      const t: string[] = [];
      o.traverse((x) => {
        if (typeof x.userData.plug === 'string') t.push(x.userData.plug);
      });
      return t;
    };
    const ends = (): string[][] => {
      const lead = w.root.getObjectByName('wall.lead')!;
      return [kinds(lead.children[0]!), kinds(lead.children[1]!)];
    };
    expect(ends()).toEqual([['rj45'], ['rj45']]);
    // the edge router's WAN port is a QSFP+ cage: a plan on the plate's RJ45 jack reaches it through an adapter
    w.set({ router: 4, isp: 2 });
    expect(ends()).toEqual([['rj45'], ['adapter', 'rj45']]);
    // the backbone plan arrives on a QSFP+ cage of the plate: a direct attach lead to the edge router, and an adapter at the plate for another tier's RJ45 jack
    w.set({ router: 4, isp: 5 });
    expect(ends()).toEqual([['qsfp'], ['qsfp']]);
    w.set({ router: 3, isp: 5 });
    expect(ends()).toEqual([['adapter', 'rj45'], ['rj45']]);
    w.dispose();
  });

  it("gives the ISP's plate the port its plan arrives on: an RJ45 jack, a QSFP+ cage for the plan copper cannot carry", () => {
    expect([null, 0, 1, 2, 3, 4].map(ispPort)).toEqual(['rj45', 'rj45', 'rj45', 'rj45', 'rj45', 'rj45']);
    expect(ispPort(5)).toBe('qsfp');
    const w = new StudioWall(p, { router: 3, isp: 2 });
    const plate = (): Object3D => w.root.getObjectByName('wall.isp')!;
    // (the port is the plate's one part that is a group of its own: the slab, then the port in a row)
    const port = (): number => {
      const b = new Box3().setFromObject(plate().children[1]!);
      return (b.max.x - b.min.x) / MM;
    };
    const jack = plate();
    expect(port()).toBeCloseTo(13.75, 0);
    // (a plan of the same kind leaves the plate as it is)
    w.set({ router: 3, isp: 3 });
    expect(plate()).toBe(jack);
    w.set({ router: 3, isp: 5 });
    expect(plate()).not.toBe(jack);
    expect(port()).toBeCloseTo(18.95, 0);
    w.set({ router: 3, isp: null });
    expect(port()).toBeCloseTo(13.75, 0);
    // (and the plate's lamps stay the wall's: five of them, lit as the plan's tier)
    w.set({ router: 3, isp: 5 });
    expect(lamps(w.root)).toBe(5);
    w.dispose();
  });

  it("lights as many lamps on the ISP's plate as the plan's tier", () => {
    const w = new StudioWall(p, { router: 3, isp: 1 });
    for (const t of [1, 3, 5]) {
      w.set({ router: 3, isp: t });
      expect(lamps(w.root), `plan ${t}`).toBe(t);
    }
    w.set({ router: 3, isp: null });
    expect(lamps(w.root)).toBe(0);
    w.dispose();
  });

  it('builds the router with every jack light out: nothing but the levels it is given lights one', () => {
    for (const router of ROUTER_TIERS) {
      const a = new StudioWall(p, { router, isp: 3 }),
        b = new StudioWall(p, { router, isp: 3 });
      b.lights(DARK);
      expect(light(a.root), `router ${router}`).toBeCloseTo(light(b.root), 9);
      a.dispose();
      b.dispose();
    }
  });

  it('lights the first LAN jack and the WAN jack from the levels it is given, each light by itself, and no other jack', () => {
    const w = new StudioWall(p, NET),
      base = light(w.root),
      at = (lan: [number, number], wan: [number, number]): number => {
        w.lights(levels(lan, wan));
        return light(w.root) - base;
      };
    expect(at([0, 0], [0, 0])).toBeCloseTo(0, 9);
    expect(at([1, 0], [0, 0])).toBeCloseTo(JACK_GLOW.link, 9);
    expect(at([0, 1], [0, 0])).toBeCloseTo(JACK_GLOW.act, 9);
    expect(at([0, 0], [1, 0])).toBeCloseTo(JACK_GLOW.link, 9);
    expect(at([0, 0], [0, 1])).toBeCloseTo(JACK_GLOW.act, 9);
    expect(at([1, 1], [1, 1])).toBeCloseTo(2 * (JACK_GLOW.link + JACK_GLOW.act), 9);
    // (the levels set the lamps: they go out again as they fall)
    expect(at([1, 0], [1, 0])).toBeCloseTo(2 * JACK_GLOW.link, 9);
    w.lights(DARK);
    expect(light(w.root)).toBeCloseTo(base, 9);
    w.dispose();
  });

  it('takes a new router dark: it holds no light of the old one, and none is lit until the next levels come', () => {
    const w = new StudioWall(p, { router: 1, isp: 3 });
    w.lights(levels([1, 1], [1, 1]));
    w.set({ router: 4, isp: 3 });
    const fresh = new StudioWall(p, { router: 4, isp: 3 });
    expect(light(w.root)).toBeCloseTo(light(fresh.root), 9);
    w.lights(levels([1, 0], [1, 0]));
    expect(light(w.root) - light(fresh.root)).toBeCloseTo(2 * JACK_GLOW.link, 9);
    w.dispose();
    fresh.dispose();
  });

  it('has no jack to light with no router, and does not fail when it is asked to', () => {
    const w = new StudioWall(p, { router: null, isp: 3 }),
      base = light(w.root);
    expect(() => w.lights(levels([1, 1], [1, 1]))).not.toThrow();
    expect(light(w.root)).toBeCloseTo(base, 9);
    w.dispose();
  });

  it('follows the frames the link carries: green with a cable and a plan, amber only while the counter grows', () => {
    const w = new StudioWall(p, NET),
      leds = new LinkLeds(),
      base = light(w.root);
    const at = (tick: number, rx: number, dt = 0.05): number => {
      w.lights(leds.step(linkSource(tick, rx), dt));
      return light(w.root) - base;
    };
    // (the PC's cord and the line are in, and nothing moves: the two green lights, no amber)
    expect(at(0, 0)).toBeCloseTo(2 * JACK_GLOW.link, 9);
    expect(at(1, 0)).toBeCloseTo(2 * JACK_GLOW.link, 9);
    // (50 000 frames in a tick: the frames follow each other closer than a pulse, both ambers stay lit)
    expect(at(2, 50_000)).toBeCloseTo(2 * (JACK_GLOW.link + JACK_GLOW.act), 9);
    expect(at(2, 50_000)).toBeCloseTo(2 * (JACK_GLOW.link + JACK_GLOW.act), 9);
    // (the counter stops: the next tick's rate is 0, and the ambers go out with it)
    expect(at(3, 50_000)).toBeCloseTo(2 * JACK_GLOW.link, 9);
    // (a PC that is off has no link on its side: the router's LAN light goes out, the WAN light stays with the plan)
    w.lights(leds.step(linkSource(4, 50_000, { on: false }), 0.05));
    expect(light(w.root) - base).toBeCloseTo(JACK_GLOW.link, 9);
    w.dispose();
  });

  it('disposes whole, and twice', () => {
    const w = new StudioWall(p, NET);
    w.dispose();
    expect(w.root.children).toHaveLength(0);
    expect(() => w.dispose()).not.toThrow();
  });
});
