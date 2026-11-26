// The router model (router3d.ts), built in Node (no canvas: no printed legend, no debossed lockup): the four tiers, their size, the five jacks, the lights.
import { describe, expect, it } from 'vitest';
import * as three from 'three';
import { ROUTER_SPOT, setLayoutTier } from '../layout/layout';
import { MM } from './pcbkit3d';
import {
  CAGE,
  LED_ON,
  PITCH,
  qsfpPorts,
  RJ,
  ROUTER_BODY,
  ROUTER_SIZE,
  ROUTER_UNDER,
  routerFit,
  routerJack,
  routerModel,
  routerTier,
} from './router3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is three.Mesh =>
  typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

const isMeshStandardMaterial = (o: unknown): o is three.MeshStandardMaterial =>
  typeof o === 'object' && o !== null && 'isMeshStandardMaterial' in o && o.isMeshStandardMaterial === true;
function asMeshStandardMaterial(o: unknown): three.MeshStandardMaterial {
  if (!isMeshStandardMaterial(o)) {
    throw new Error('expected a MeshStandardMaterial');
  }
  return o;
}

const TIERS = [1, 2, 3, 4];
const meshes = (o: three.Object3D): three.Mesh[] => {
  const out: three.Mesh[] = [];
  o.traverse((c) => {
    if (isMesh(c)) {
      out.push(c);
    }
  });
  return out;
};
const boxOf = (o: three.Object3D): three.Box3 => new three.Box3().setFromObject(o);
/** A light that gives light: a colour and an intensity. */
const lit = (m: three.MeshStandardMaterial): boolean => m.emissive.getHex() !== 0 && m.emissiveIntensity > 0;
/** The shell's room behind the bezel, and the lowest a jack's mouth may go: the shell starts 110 above the shelf. */
const UNDER = 110;

describe('routerTier', () => {
  it('reads the tier of a game router id, and nothing else', () => {
    expect(TIERS.map((t) => routerTier(`router${t}`))).toStrictEqual(TIERS);
    for (const id of ['isp1', 'router', 'os2', '', null, undefined]) {
      expect(routerTier(id)).toBeNull();
    }
  });
});

describe('the four routers', () => {
  it('stand on the shelf with their east end at x = 0, the body the size of its tier', () => {
    for (const t of TIERS) {
      const m = routerModel(t),
        b = boxOf(m.root),
        { w, h } = must(ROUTER_SIZE[t]);
      expect(m.size, `tier ${t}`).toStrictEqual({ w, h, depth: ROUTER_BODY });
      expect(b.min.y, `tier ${t} feet on the shelf`).toBeCloseTo(0, 3);
      expect(b.max.y, `tier ${t} top`).toBeGreaterThanOrEqual(h);
      // (the 10G router is the body alone; the edge router has rack ears 200 out at each end; the two aerials of the others lean out, 250 at most)
      const out = t === 3 ? 0 : t === 4 ? 200 : 250;
      expect(b.max.x, `tier ${t} east end`).toBeGreaterThanOrEqual(-1e-6);
      expect(b.max.x, `tier ${t} east end`).toBeLessThanOrEqual(out + 1e-6);
      expect(b.min.x, `tier ${t} west end`).toBeLessThanOrEqual(-w + 1e-6);
      expect(b.min.x, `tier ${t} west end`).toBeGreaterThanOrEqual(-w - out - 1e-6);
      if (t >= 3) {
        expect(b.max.x, `tier ${t}`).toBeCloseTo(out, 3);
        expect(b.min.x, `tier ${t}`).toBeCloseTo(-w - out, 3);
      }
    }
  });

  it('keep every part within 40 of the front, and within 20 of the back (the round tip of an aerial) when the back panel is left out', () => {
    for (const t of TIERS) {
      const b = boxOf(routerModel(t, { rear: false }).root);
      expect(b.max.z, `tier ${t} front`).toBeLessThanOrEqual(40);
      expect(b.min.z, `tier ${t} back`).toBeGreaterThanOrEqual(-ROUTER_BODY - 20);
    }
  });

  it('keep the lit bar and the fins within 60 of the top, where there are no aerials', () => {
    for (const t of [3, 4]) {
      expect(boxOf(routerModel(t).root).max.y, `tier ${t}`).toBeLessThanOrEqual(must(ROUTER_SIZE[t]).h + 60);
    }
  });

  it('give the home and the gigabit router two aerials that reach over the body, and the others none', () => {
    for (const t of TIERS) {
      const over = boxOf(routerModel(t).root).max.y - must(ROUTER_SIZE[t]).h;
      if (t <= 2) {
        expect(over, `tier ${t}`).toBeGreaterThan(2000);
      } else {
        expect(over, `tier ${t}`).toBeLessThan(100);
      }
    }
  });

  it('differ from each other: no two tiers have the same parts', () => {
    expect(new Set(TIERS.map((t) => meshes(routerModel(t).root).length)).size).toBe(TIERS.length);
  });

  it('take any tier but 1 to 4 for the home router', () => {
    for (const t of [0, 5, 99]) {
      expect(routerModel(t).size).toStrictEqual(routerModel(1).size);
    }
    expect(meshes(routerModel(7).root)).toHaveLength(meshes(routerModel(1).root).length);
  });
});

describe('the front jacks', () => {
  it('are real RJ45 faces: 13.75 mm wide, 10.7 mm tall, seated 3 behind the front', () => {
    expect(RJ.w / MM).toBeCloseTo(13.75, 5);
    expect(RJ.h / MM).toBeCloseTo(10.7, 5);
    for (let k = 0; k < 5; k++) {
      expect(routerJack(k)[2]).toBe(-3);
    }
  });

  it('are five in a row at one pitch, the first LAN east and the WAN west, and do not touch', () => {
    const xs = [0, 1, 2, 3, 4].map((k) => routerJack(k)[0]);
    for (let k = 1; k < 5; k++) {
      expect(must(xs[k - 1]) - must(xs[k])).toBe(PITCH);
    }
    expect(PITCH).toBeGreaterThan(RJ.w);
    expect(new Set([0, 1, 2, 3, 4].map((k) => routerJack(k)[1])).size).toBe(1);
  });

  it('stand inside the front of every tier, clear of its lights and its rim', () => {
    for (const t of TIERS) {
      const { w, h } = must(ROUTER_SIZE[t]);
      for (let k = 0; k < 5; k++) {
        const [x, y] = routerJack(k);
        expect(x - RJ.w / 2, `tier ${t} jack ${k} west`).toBeGreaterThan(-w);
        expect(x + RJ.w / 2, `tier ${t} jack ${k} east`).toBeLessThan(0);
        expect(y - RJ.h / 2, `tier ${t} jack ${k} low`).toBeGreaterThan(UNDER);
        // (the lights: the lowest row sits 100 under the top, 210 on the edge router, its strip 46 either side of the middle)
        expect(y + RJ.h / 2, `tier ${t} jack ${k} high`).toBeLessThan(h - (t === 4 ? 210 : 100) - 46);
      }
    }
  });

  it('have two lights of their own on each jack, all out as built: the link and its frames light them, never the model', () => {
    for (const t of TIERS) {
      const m = routerModel(t),
        j = m.jacks as { link: three.MeshStandardMaterial; act: three.MeshStandardMaterial }[];
      expect(j, `tier ${t}`).toHaveLength(5);
      expect(new Set(j.flatMap((x) => [x.link, x.act])).size, `tier ${t}`).toBe(10);
      for (const x of j) {
        expect(lit(x.link) || lit(x.act), `tier ${t}`).toBe(false);
      }
      // (each light is a lens on the front: some mesh draws with it)
      const used = new Set(meshes(m.root).map((c) => c.material));
      for (const x of j) {
        expect(used.has(x.link), `tier ${t} link`).toBe(true);
        expect(used.has(x.act), `tier ${t} act`).toBe(true);
      }
    }
  });

  it('have lights only on the jacks the scene drives: a plain dark lens, with no glow to draw, on the others', () => {
    const glowing = (o: three.Object3D): number =>
      meshes(o).filter((c) => asMeshStandardMaterial(c.material).emissive.getHex() !== 0).length;
    const none = routerModel(3, { drive: [] }),
      wan = routerModel(3, { drive: [4] }),
      both = routerModel(3, { drive: [0, 4] }),
      all = routerModel(3);
    expect(none.jacks).toStrictEqual([null, null, null, null, null]);
    expect(wan.jacks.map((x) => x !== null)).toStrictEqual([false, false, false, false, true]);
    expect(both.jacks.map((x) => x !== null)).toStrictEqual([true, false, false, false, true]);
    expect(glowing(none.root)).toBeLessThan(glowing(wan.root));
    expect(glowing(wan.root)).toBeLessThan(glowing(both.root));
    expect(glowing(both.root)).toBeLessThan(glowing(all.root));
    // (the driven jacks' lights are out as well)
    for (const x of both.jacks) {
      if (x) {
        expect(lit(x.link) || lit(x.act)).toBe(false);
      }
    }
  });
});

describe("the edge router's QSFP+ ports", () => {
  it('are five cages on the edge router, its WAN port too (a real edge router has no copper port), and none on the other tiers', () => {
    expect(TIERS.map(qsfpPorts)).toStrictEqual([0, 0, 0, 5]);
    expect(qsfpPorts(0)).toBe(0);
    expect(qsfpPorts(5)).toBe(0);
  });

  it("are real cages, 18.95 x 10 mm, in the 19.13 mm of the jacks' pitch and inside the front like the jacks", () => {
    expect(CAGE.w / MM).toBeCloseTo(18.95, 5);
    expect(CAGE.h / MM).toBeCloseTo(10, 5);
    expect(CAGE.w).toBeLessThan(PITCH);
    expect(PITCH - CAGE.w).toBeGreaterThan(0);
    const { w, h } = must(ROUTER_SIZE[4]);
    for (let k = 0; k < qsfpPorts(4); k++) {
      const [x, y] = routerJack(k);
      expect(x - CAGE.w / 2, `cage ${k} west`).toBeGreaterThan(-w);
      expect(x + CAGE.w / 2, `cage ${k} east`).toBeLessThan(0);
      expect(y - CAGE.h / 2, `cage ${k} low`).toBeGreaterThan(UNDER);
      // (its lights stand over it in the bezel, under the status lights' strip)
      expect(y + CAGE.h / 2 + 3 * MM, `cage ${k} high`).toBeLessThan(h - 210 - 46);
    }
  });

  it("put each port's two lenses in the bezel over its cage, 5.3 mm either side of its middle, the link light west", () => {
    const m = routerModel(4),
      j = m.jacks as { link: three.MeshStandardMaterial; act: three.MeshStandardMaterial }[];
    // (the jacks stand in a turned group: its matrices first, so a mesh's box is where it stands in the router)
    m.root.updateMatrixWorld(true);
    const lens = (mat: three.MeshStandardMaterial) => {
      const b = new three.Box3();
      for (const c of meshes(m.root)) {
        if (c.material === mat) {
          b.expandByObject(c);
        }
      }
      return b;
    };
    for (let k = 0; k < qsfpPorts(4); k++) {
      const [x, y] = routerJack(k),
        link = lens(must(j[k]).link),
        act = lens(must(j[k]).act);
      expect((link.min.x + link.max.x) / 2, `cage ${k} link`).toBeCloseTo(x - 5.3 * MM, 3);
      expect((act.min.x + act.max.x) / 2, `cage ${k} act`).toBeCloseTo(x + 5.3 * MM, 3);
      // (clear over the cage's top edge, and standing in the front, not in its mouth)
      for (const b of [link, act]) {
        expect(b.min.y, `cage ${k}`).toBeGreaterThan(y + CAGE.h / 2);
        expect(b.max.z, `cage ${k}`).toBeLessThanOrEqual(2);
        expect(b.max.z, `cage ${k}`).toBeGreaterThan(-RJ.deep);
      }
    }
    // (the other tiers' lights are in the RJ45's own face: under the top of its mouth)
    const rj = routerModel(3),
      jj = rj.jacks as { link: three.MeshStandardMaterial }[];
    rj.root.updateMatrixWorld(true);
    const b3 = new three.Box3();
    for (const c of meshes(rj.root)) {
      if (c.material === must(jj[0]).link) {
        b3.expandByObject(c);
      }
    }
    expect(b3.max.y, 'tier 3').toBeLessThan(routerJack(0)[1] + RJ.h / 2);
  });

  it("leave the cages' connectors out at the fine setting off, as the jacks' springs", () => {
    const fine = meshes(routerModel(4, { fine: true }).root).length,
      plain = meshes(routerModel(4, { fine: false }).root).length;
    // (three draws a cage: its connector's housing, its slot, its 38 contacts)
    expect(fine - plain).toBeGreaterThanOrEqual(3 * qsfpPorts(4));
  });
});

describe('the status lights', () => {
  it('are one lit material in a bright but not blown out step', () => {
    for (const t of TIERS) {
      const s = routerModel(t).status;
      expect(s, `tier ${t}`).toHaveLength(1);
      expect(lit(must(s[0])), `tier ${t}`).toBe(true);
      expect(must(s[0]).emissiveIntensity, `tier ${t}`).toBe(LED_ON);
    }
    expect(LED_ON).toBeLessThan(2);
  });

  it('are a row of dots (4, 6, 8 and two rows of 8), and a lit bar on the 10G and the edge router', () => {
    const want: Record<number, number> = { 1: 4, 2: 6, 3: 8 + 1, 4: 16 + 1 };
    for (const t of TIERS) {
      const m = routerModel(t);
      expect(meshes(m.root).filter((x) => x.material === m.status[0])).toHaveLength(must(want[t]));
    }
  });
});

describe('the options', () => {
  it('take the body deeper or shallower, never so shallow that the jacks have no room', () => {
    expect(routerModel(1).size.depth).toBe(ROUTER_BODY);
    expect(routerModel(1, { depth: 1200 }).size.depth).toBe(1200);
    expect(routerModel(1, { depth: 100 }).size.depth).toBe(RJ.deep + 80 + 500);
    expect(boxOf(routerModel(3, { depth: 1200, rear: false }).root).min.z).toBeCloseTo(-1200, 3);
  });

  it('add a back panel unless it is left out', () => {
    for (const t of TIERS) {
      const withBack = routerModel(t),
        without = routerModel(t, { rear: false });
      expect(meshes(withBack.root).length, `tier ${t}`).toBeGreaterThan(meshes(without.root).length);
      expect(boxOf(withBack.root).min.z, `tier ${t}`).toBeLessThan(boxOf(without.root).min.z);
    }
  });

  it('leave out the springs and the comb of the jacks at the fine setting off', () => {
    for (const t of TIERS) {
      expect(meshes(routerModel(t, { fine: false }).root).length, `tier ${t}`).toBeLessThan(
        meshes(routerModel(t, { fine: true }).root).length,
      );
    }
  });

  it('build the same router twice, and free it without a trace', () => {
    const a = routerModel(4),
      b = routerModel(4);
    expect(meshes(a.root)).toHaveLength(meshes(b.root).length);
    expect(boxOf(a.root).equals(boxOf(b.root))).toBe(true);
  });
});

describe('where the room stands the router', () => {
  it("fits the box of each tier in the spot at one scale, its east end and its shelf on the spot's, and gives the front bezel from the shell's underside to the top", () => {
    const spot = { x: -8000, y: -4000, w: 2320, h: 609 };
    for (const t of TIERS) {
      const { k, front, face } = routerFit(t, spot),
        { w, h } = must(ROUTER_SIZE[t]);
      expect(k, `tier ${t}`).toBeCloseTo(Math.min(spot.w / w, spot.h / h), 9);
      expect(k * w, `tier ${t} across`).toBeLessThanOrEqual(spot.w + 1e-6);
      expect(k * h, `tier ${t} up`).toBeLessThanOrEqual(spot.h + 1e-6);
      expect(front, `tier ${t}`).toBe(t >= 4 ? 1500 : 1400);
      expect(face.x + face.w, `tier ${t} east end`).toBeCloseTo(spot.x + spot.w, 6);
      expect(face.w, `tier ${t}`).toBeCloseTo(k * w, 6);
      expect(face.y + face.h + k * ROUTER_UNDER, `tier ${t} underside`).toBeCloseTo(spot.y + spot.h, 6);
      expect(face.h, `tier ${t}`).toBeCloseTo(k * (h - ROUTER_UNDER), 6);
      // the front is wide and short: the plan's shape (routerlayout.ts)
      expect(face.w / face.h, `tier ${t}`).toBeGreaterThan(4);
    }
  });

  it("reads the room's router spot when none is given, and has a tier it does not know as the home router", () => {
    setLayoutTier(3, 3);
    const a = routerFit(2),
      b = routerFit(2, ROUTER_SPOT);
    expect(a).toStrictEqual(b);
    expect(routerFit(99)).toStrictEqual(routerFit(1));
  });
});
