// The router model (router3d.ts), built in Node (no canvas: no printed legend, no debossed lockup): the four tiers, their size, the five jacks, the lights.
import { describe, expect, it } from 'vitest';
import { Box3, Mesh, MeshStandardMaterial, type Object3D } from 'three';
import { MM } from './pcbkit3d';
import { LED_ON, PITCH, RJ, ROUTER_BODY, ROUTER_SIZE, routerJack, routerModel, routerTier } from './router3d';

const TIERS = [1, 2, 3, 4];
const meshes = (o: Object3D): Mesh[] => { const out: Mesh[] = []; o.traverse((c) => { if ((c as Mesh).isMesh) out.push(c as Mesh); }); return out; };
const boxOf = (o: Object3D): Box3 => new Box3().setFromObject(o);
/** A light that gives light: a colour and an intensity. */
const lit = (m: MeshStandardMaterial): boolean => m.emissive.getHex() !== 0 && m.emissiveIntensity > 0;
/** The shell's room behind the bezel, and the lowest a jack's mouth may go: the shell starts 110 above the shelf. */
const UNDER = 110;

describe('routerTier', () => {
  it('reads the tier of a game router id, and nothing else', () => {
    expect(TIERS.map((t) => routerTier(`router${t}`))).toEqual(TIERS);
    for (const id of ['isp1', 'router', 'os2', '', null, undefined]) expect(routerTier(id), String(id)).toBeNull();
  });
});

describe('the four routers', () => {
  it('stand on the shelf with their east end at x = 0, the body the size of its tier', () => {
    for (const t of TIERS) {
      const m = routerModel(t), b = boxOf(m.root), { w, h } = ROUTER_SIZE[t]!;
      expect(m.size, `tier ${t}`).toEqual({ w, h, depth: ROUTER_BODY });
      expect(b.min.y, `tier ${t} feet on the shelf`).toBeCloseTo(0, 3);
      expect(b.max.y, `tier ${t} top`).toBeGreaterThanOrEqual(h);
      // (the 10G router is the body alone; the core router has rack ears 200 out at each end; the two aerials of the others lean out, 250 at most)
      const out = t === 3 ? 0 : t === 4 ? 200 : 250;
      expect(b.max.x, `tier ${t} east end`).toBeGreaterThanOrEqual(-1e-6);
      expect(b.max.x, `tier ${t} east end`).toBeLessThanOrEqual(out + 1e-6);
      expect(b.min.x, `tier ${t} west end`).toBeLessThanOrEqual(-w + 1e-6);
      expect(b.min.x, `tier ${t} west end`).toBeGreaterThanOrEqual(-w - out - 1e-6);
      if (t >= 3) { expect(b.max.x, `tier ${t}`).toBeCloseTo(out, 3); expect(b.min.x, `tier ${t}`).toBeCloseTo(-w - out, 3); }
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
    for (const t of [3, 4]) expect(boxOf(routerModel(t).root).max.y, `tier ${t}`).toBeLessThanOrEqual(ROUTER_SIZE[t]!.h + 60);
  });

  it('give the home and the gigabit router two aerials that reach over the body, and the others none', () => {
    for (const t of TIERS) {
      const over = boxOf(routerModel(t).root).max.y - ROUTER_SIZE[t]!.h;
      if (t <= 2) expect(over, `tier ${t}`).toBeGreaterThan(2000);
      else expect(over, `tier ${t}`).toBeLessThan(100);
    }
  });

  it('differ from each other: no two tiers have the same parts', () => {
    expect(new Set(TIERS.map((t) => meshes(routerModel(t).root).length)).size).toBe(TIERS.length);
  });

  it('take any tier but 1 to 4 for the home router', () => {
    for (const t of [0, 5, 99]) expect(routerModel(t).size).toEqual(routerModel(1).size);
    expect(meshes(routerModel(7).root).length).toBe(meshes(routerModel(1).root).length);
  });
});

describe('the front jacks', () => {
  it('are real RJ45 faces: 13.75 mm wide, 10.7 mm tall, seated 3 behind the front', () => {
    expect(RJ.w / MM).toBeCloseTo(13.75, 5);
    expect(RJ.h / MM).toBeCloseTo(10.7, 5);
    for (let k = 0; k < 5; k++) expect(routerJack(k)[2]).toBe(-3);
  });

  it('are five in a row at one pitch, the first LAN east and the WAN west, and do not touch', () => {
    const xs = [0, 1, 2, 3, 4].map((k) => routerJack(k)[0]);
    for (let k = 1; k < 5; k++) expect(xs[k - 1]! - xs[k]!).toBe(PITCH);
    expect(PITCH).toBeGreaterThan(RJ.w);
    expect(new Set([0, 1, 2, 3, 4].map((k) => routerJack(k)[1])).size).toBe(1);
  });

  it('stand inside the front of every tier, clear of its lights and its rim', () => {
    for (const t of TIERS) {
      const { w, h } = ROUTER_SIZE[t]!;
      for (let k = 0; k < 5; k++) {
        const [x, y] = routerJack(k);
        expect(x - RJ.w / 2, `tier ${t} jack ${k} west`).toBeGreaterThan(-w);
        expect(x + RJ.w / 2, `tier ${t} jack ${k} east`).toBeLessThan(0);
        expect(y - RJ.h / 2, `tier ${t} jack ${k} low`).toBeGreaterThan(UNDER);
        // (the lights: the lowest row sits 100 under the top, 210 on the core router, its strip 46 either side of the middle)
        expect(y + RJ.h / 2, `tier ${t} jack ${k} high`).toBeLessThan(h - (t === 4 ? 210 : 100) - 46);
      }
    }
  });

  it('have two lights of their own on each jack, all out as built: the link and its frames light them, never the model', () => {
    for (const t of TIERS) {
      const m = routerModel(t), j = m.jacks as { link: MeshStandardMaterial; act: MeshStandardMaterial }[];
      expect(j, `tier ${t}`).toHaveLength(5);
      expect(new Set(j.flatMap((x) => [x.link, x.act])).size, `tier ${t}`).toBe(10);
      for (const x of j) expect(lit(x.link) || lit(x.act), `tier ${t}`).toBe(false);
      // (each light is a lens on the front: some mesh draws with it)
      const used = new Set(meshes(m.root).map((c) => c.material));
      for (const x of j) { expect(used.has(x.link), `tier ${t} link`).toBe(true); expect(used.has(x.act), `tier ${t} act`).toBe(true); }
    }
  });

  it('have lights only on the jacks the scene drives: a plain dark lens, with no glow to draw, on the others', () => {
    const glowing = (o: Object3D): number => meshes(o).filter((c) => (c.material as MeshStandardMaterial).emissive.getHex() !== 0).length;
    const none = routerModel(3, { drive: [] }), wan = routerModel(3, { drive: [4] }), both = routerModel(3, { drive: [0, 4] }), all = routerModel(3);
    expect(none.jacks).toEqual([null, null, null, null, null]);
    expect(wan.jacks.map((x) => x !== null)).toEqual([false, false, false, false, true]);
    expect(both.jacks.map((x) => x !== null)).toEqual([true, false, false, false, true]);
    expect(glowing(none.root)).toBeLessThan(glowing(wan.root));
    expect(glowing(wan.root)).toBeLessThan(glowing(both.root));
    expect(glowing(both.root)).toBeLessThan(glowing(all.root));
    // (the driven jacks' lights are out as well)
    for (const x of both.jacks) if (x) expect(lit(x.link) || lit(x.act)).toBe(false);
  });
});

describe('the status lights', () => {
  it('are one lit material in a bright but not blown out step', () => {
    for (const t of TIERS) {
      const s = routerModel(t).status;
      expect(s, `tier ${t}`).toHaveLength(1);
      expect(lit(s[0]!), `tier ${t}`).toBe(true);
      expect(s[0]!.emissiveIntensity, `tier ${t}`).toBe(LED_ON);
    }
    expect(LED_ON).toBeLessThan(2);
  });

  it('are a row of dots (4, 6, 8 and two rows of 8), and a lit bar on the 10G and the core router', () => {
    const want: Record<number, number> = { 1: 4, 2: 6, 3: 8 + 1, 4: 16 + 1 };
    for (const t of TIERS) {
      const m = routerModel(t);
      expect(meshes(m.root).filter((x) => x.material === m.status[0]).length, `tier ${t}`).toBe(want[t]);
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
      const withBack = routerModel(t), without = routerModel(t, { rear: false });
      expect(meshes(withBack.root).length, `tier ${t}`).toBeGreaterThan(meshes(without.root).length);
      expect(boxOf(withBack.root).min.z, `tier ${t}`).toBeLessThan(boxOf(without.root).min.z);
    }
  });

  it('leave out the springs and the comb of the jacks at the fine setting off', () => {
    for (const t of TIERS) expect(meshes(routerModel(t, { fine: false }).root).length, `tier ${t}`).toBeLessThan(meshes(routerModel(t, { fine: true }).root).length);
  });

  it('build the same router twice, and free it without a trace', () => {
    const a = routerModel(4), b = routerModel(4);
    expect(meshes(a.root).length).toBe(meshes(b.root).length);
    expect(boxOf(a.root).equals(boxOf(b.root))).toBe(true);
  });
});
