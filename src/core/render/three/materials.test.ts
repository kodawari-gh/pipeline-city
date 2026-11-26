import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Texture } from 'three';
import type * as threeTypes from 'three';
import { assert, describe, expect, it } from 'vitest';
import { boxEnv, boxProjected } from './boxenv';
import { GLOW, PartSkin, cloth, mat, materialKey, own, partLook, shareMaterials } from './materials';
import type * as materialsTypes from './materials';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const ON: materialsTypes.PartState = { powered: true, burnt: false };
/** Runs a skin's fades to their end. */
const settleSkin = (s: PartSkin): void => {
  for (let i = 0; i < 400; i++) {
    s.frame(1 / 60);
  }
};
const isMesh = (o: threeTypes.Object3D | undefined): o is Mesh => o instanceof Mesh;
/** The object as a mesh, failing the test when it is something else. */
function asMesh(o: threeTypes.Object3D | undefined): Mesh {
  assert(isMesh(o), 'expected a mesh');
  return o;
}
/** A patch of its own (a shader change that keeps a material from being shared). */
function ownPatch(): void {
  // (the patch itself does nothing here: that there is one is what counts)
}

describe('part looks', () => {
  it('leaves a powered part as it is: one that runs, runs hot or throttles does not glow (the lenses show that)', () => {
    expect(partLook(ON)).toStrictEqual({ tint: 1, glow: 0, glowIntensity: 0 });
    // (the state carries no activity, no heat and no throttle for a look to follow)
    expect(Object.keys(ON).toSorted()).toStrictEqual(['burnt', 'powered']);
  });

  it('darkens a part with no power', () => {
    expect(partLook({ ...ON, powered: false })).toStrictEqual({ tint: 0.5, glow: 0, glowIntensity: 0 });
  });

  it('a burnt part is charred and glows red, whatever its power', () => {
    expect(partLook({ ...ON, burnt: true })).toStrictEqual({ tint: 0.3, glow: GLOW.burnt, glowIntensity: 0.8 });
    expect(partLook({ powered: false, burnt: true })).toStrictEqual({
      tint: 0.3,
      glow: GLOW.burnt,
      glowIntensity: 0.8,
    });
  });

  it('a skin eases its material to the look, from the base colour every time', () => {
    const m = mat(0x80_80_80),
      skin = new PartSkin([m]),
      base = m.color.r;
    skin.set({ ...ON, powered: false });
    for (let i = 0; i < 300; i++) {
      skin.frame(1 / 60);
    }
    expect(m.color.r).toBeCloseTo(base * 0.5, 3);
    skin.set(ON);
    for (let i = 0; i < 300; i++) {
      skin.frame(1 / 60);
    }
    expect(m.color.r).toBeCloseTo(base, 3);
    expect(m.emissiveIntensity).toBeCloseTo(0, 3);
  });

  it("the thermal view darkens a skin and makes it glow the scale's colour by its place on it, hotter brighter; null gives the own look back", () => {
    const m = mat(0x80_80_80),
      skin = new PartSkin([m]),
      base = m.color.r,
      settle = (): void => {
        for (let i = 0; i < 400; i++) {
          skin.frame(1 / 60);
        }
      };
    skin.set(ON);
    skin.thermal(0);
    settle();
    const cold = { r: m.emissive.r, b: m.emissive.b, level: m.emissiveIntensity };
    // (the body goes dark and the glow is the cold end of the scale: blue)
    expect(m.color.r).toBeLessThan(base * 0.5);
    expect(cold.b).toBeGreaterThan(cold.r);
    skin.thermal(1);
    settle();
    expect(m.emissive.r).toBeGreaterThan(0.9);
    expect(m.emissive.g).toBeGreaterThan(0.8);
    expect(m.emissiveIntensity).toBeGreaterThan(cold.level * 5);
    skin.thermal(null);
    settle();
    expect(m.color.r).toBeCloseTo(base, 3);
    expect(m.emissiveIntensity).toBeCloseTo(0, 3);
    expect(skin.easing).toBe(false);
  });

  it('the power view keeps a dim glow on a part that draws nothing and makes one that draws glow amber, more with its draw; a warning glows red; null gives the own look back', () => {
    const m = mat(0x80_80_80),
      skin = new PartSkin([m]),
      base = m.color.r,
      settle = (): void => {
        for (let i = 0; i < 400; i++) {
          skin.frame(1 / 60);
        }
      };
    skin.set(ON);
    skin.electric(0);
    settle();
    // (nothing drawn: a dim glow, so a power part that is off still stands out of the dark veil; its body lifted against that veil)
    const off = m.emissiveIntensity;
    expect(off).toBeGreaterThan(0.2);
    expect(m.color.r).toBeGreaterThan(base);
    skin.electric(0.3);
    settle();
    const low = m.emissiveIntensity;
    expect(low).toBeGreaterThan(off * 1.3);
    // (amber: red leads, blue is least)
    expect(m.emissive.r).toBeGreaterThan(m.emissive.g);
    expect(m.emissive.g).toBeGreaterThan(m.emissive.b);
    skin.electric(1);
    settle();
    expect(m.emissiveIntensity).toBeGreaterThan(low * 2);
    skin.electric(1, true);
    settle();
    expect(m.emissive.r).toBeGreaterThan(m.emissive.g * 2);
    expect(m.emissive.r).toBeGreaterThan(m.emissive.b);
    skin.electric(null);
    settle();
    expect(m.color.r).toBeCloseTo(base, 3);
    expect(m.emissiveIntensity).toBeCloseTo(0, 3);
    expect(skin.easing).toBe(false);
    // (and the thermal view still reads its own scale after it)
    skin.thermal(0);
    settle();
    expect(m.emissive.b).toBeGreaterThan(m.emissive.r);
  });

  it('a hub glows cyan and a source white in the power view, a use amber: the colour is the role, the brightness the draw', () => {
    const [use, hub, src] = [0, 1, 2].map(() => {
      const m = mat(0x80_80_80);
      return { m, skin: new PartSkin([m]) };
    });
    for (const [x, role] of [
      [must(use), 'use'],
      [must(hub), 'hub'],
      [must(src), 'source'],
    ] as const) {
      x.skin.set(ON);
      x.skin.electric(0.8, false, role);
      settleSkin(x.skin);
    }
    expect(must(use).m.emissive.r).toBeGreaterThan(must(use).m.emissive.b * 2);
    expect(must(hub).m.emissive.b).toBeGreaterThan(must(hub).m.emissive.r * 1.5);
    // (white: the three channels are close)
    expect(
      Math.max(must(src).m.emissive.r, must(src).m.emissive.g, must(src).m.emissive.b) -
        Math.min(must(src).m.emissive.r, must(src).m.emissive.g, must(src).m.emissive.b),
    ).toBeLessThan(0.15);
    // (the glow is as strong in each: one brightness for every role)
    expect(must(hub).m.emissiveIntensity).toBeCloseTo(must(use).m.emissiveIntensity, 5);
    // (a warning is red whatever the role)
    must(hub).skin.electric(0.8, true, 'hub');
    settleSkin(must(hub).skin);
    expect(must(hub).m.emissive.r).toBeGreaterThan(must(hub).m.emissive.b);
  });

  it('a part with wide faces glows softer in the power view, and as any part in the thermal view', () => {
    const plain = mat(0x80_80_80),
      wide = mat(0x80_80_80),
      a = new PartSkin([plain]),
      b = new PartSkin([wide], 0.3),
      settle = (): void => {
        for (let i = 0; i < 400; i++) {
          a.frame(1 / 60);
          b.frame(1 / 60);
        }
      };
    a.set(ON);
    b.set(ON);
    a.electric(0.8);
    b.electric(0.8);
    settle();
    expect(wide.emissiveIntensity).toBeGreaterThan(0);
    expect(wide.emissiveIntensity).toBeLessThan(plain.emissiveIntensity * 0.8);
    // (the thermal view, which the airflow lens has settled, does not take the gain in)
    a.thermal(0.8);
    b.thermal(0.8);
    settle();
    expect(wide.emissiveIntensity).toBeCloseTo(plain.emissiveIntensity, 5);
  });

  it('a skin of the thermal view alone ignores the state, and glows in the view all the same', () => {
    const m = mat(0x80_80_80),
      skin = new PartSkin([m], 1, false),
      base = m.color.r,
      settle = (): void => {
        for (let i = 0; i < 400; i++) {
          skin.frame(1 / 60);
        }
      };
    // (a machine that is off, then burnt: the part keeps its own look through both)
    for (const st of [
      { ...ON, powered: false },
      { ...ON, burnt: true },
    ]) {
      skin.set(st);
      settle();
      expect(m.color.r).toBeCloseTo(base, 5);
      expect(m.emissiveIntensity).toBe(0);
      expect(skin.easing).toBe(false);
    }
    skin.thermal(1);
    settle();
    expect(m.emissiveIntensity).toBeGreaterThan(1);
    expect(m.color.r).toBeLessThan(base * 0.5);
    skin.thermal(null);
    settle();
    expect(m.color.r).toBeCloseTo(base, 3);
    expect(m.emissiveIntensity).toBeCloseTo(0, 3);
  });

  it('a skin says it eases until it has reached the look', () => {
    const skin = new PartSkin([mat(0x80_80_80)]);
    expect(skin.easing).toBe(false);
    skin.set({ ...ON, powered: false });
    expect(skin.easing).toBe(true);
    for (let i = 0; i < 600; i++) {
      skin.frame(1 / 60);
    }
    expect(skin.easing).toBe(false);
  });
});

const box = () => new BoxGeometry(1, 1, 1);
const tagged = (id: string) => Object.assign(new Group(), { userData: { id } });
const matsOf = (root: Group) => {
  const s = new Set<threeTypes.Material>();
  root.traverse((o) => {
    if (isMesh(o)) {
      for (const m of [o.material].flat()) {
        s.add(m);
      }
    }
  });
  return s;
};

describe('material key', () => {
  it('is the same for equal materials and differs on any field that changes the picture', () => {
    const t = new Texture();
    expect(materialKey(mat(0x33_44_55, { roughness: 0.4, map: t }))).toBe(
      materialKey(mat(0x33_44_55, { roughness: 0.4, map: t })),
    );
    const k = must(materialKey(mat(0x33_44_55)));
    for (const m of [
      mat(0x33_44_56),
      mat(0x33_44_55, { roughness: 0.5 }),
      mat(0x33_44_55, { metalness: 0.5 }),
      mat(0x33_44_55, { map: new Texture() }),
      mat(0x33_44_55, { side: 2 }),
      mat(0x33_44_55, { polygonOffset: true }),
      mat(0x33_44_55, { envMapIntensity: 0.5 }),
      cloth(0x33_44_55),
    ]) {
      expect(materialKey(m)).not.toBe(k);
    }
    const d = mat(0x33_44_55);
    d.defines = { A: '' };
    expect(materialKey(d)).not.toBe(k);
    const u = mat(0x33_44_55);
    u.userData['x'] = 1;
    expect(materialKey(u)).not.toBe(k);
  });

  it('keys a known patch by its program key and refuses an unknown one', () => {
    const b = boxEnv([0, 0, 0], [1, 1, 1], [0, 0, 0]),
      p = mat(0x33_44_55);
    boxProjected(p, b);
    expect(materialKey(p)).not.toBeNull();
    expect(materialKey(p)).not.toBe(materialKey(mat(0x33_44_55)));
    const q = mat(0x33_44_55);
    q.onBeforeCompile = ownPatch;
    expect(materialKey(q)).toBeNull();
    expect(materialKey(new MeshBasicMaterial())).toBeNull();
  });

  it('never throws on a cycle or an object inside userData: an object of its own is keyed by identity', () => {
    const loop: Record<string, unknown> = { a: 1 };
    loop['self'] = loop;
    const m = mat(0x33_44_55),
      n = mat(0x33_44_55),
      o = new Group();
    m.userData['loop'] = loop;
    m.userData['holder'] = { o };
    n.userData['loop'] = loop;
    n.userData['holder'] = { o };
    expect(() => materialKey(m)).not.toThrow();
    expect(materialKey(m)).toBe(materialKey(n));
    n.userData['holder'] = { o: new Group() };
    expect(materialKey(n)).not.toBe(materialKey(m));
  });

  it('leaves out the fields it is told to (the palette merge: colour, roughness, metalness)', () => {
    const omit = new Set(['color', 'roughness', 'metalness']),
      k = materialKey(mat(0x33_44_55), omit);
    expect(materialKey(mat(0x99_88_77, { roughness: 0.1, metalness: 0.9 }), omit)).toBe(k);
    expect(materialKey(mat(0x33_44_55, { side: 2 }), omit)).not.toBe(k);
  });
});

describe('shared materials', () => {
  it('gives equal materials in one scope one material and disposes the others', () => {
    const root = new Group(),
      a = new Mesh(box(), mat(0x22_33_44)),
      b = new Mesh(box(), mat(0x22_33_44)),
      c = new Mesh(box(), mat(0x55_66_77));
    root.add(a, b, c);
    const gone: threeTypes.Material[] = [],
      replaced: threeTypes.Material[] = [];
    b.material.addEventListener('dispose', () => {
      gone.push(b.material);
    });
    const old = b.material;
    const onReplace = (m: threeTypes.Material) => {
      replaced.push(m);
    };
    expect(shareMaterials(root, { onReplace })).toStrictEqual({ before: 3, after: 2 });
    expect(b.material).toBe(a.material);
    expect(c.material).not.toBe(a.material);
    expect(replaced).toStrictEqual([old]);
    expect(gone).toHaveLength(1);
  });

  it('leaves glowing, see-through, owned and skipped materials, and keeps scopes and kinds of mesh apart', () => {
    const root = new Group(),
      lamp = tagged('lamp'),
      rack = new Group();
    const glow = [0, 1].map(() => new Mesh(box(), mat(0x11_11_11, { emissive: 0xff_aa_00 })));
    const fade = [0, 1].map(() => new Mesh(box(), mat(0x11_11_11, { transparent: true, opacity: 0.5 })));
    const mine = [0, 1].map(() => new Mesh(box(), own(mat(0x11_11_11))));
    const scoped = [new Mesh(box(), mat(0x22_22_22)), new Mesh(box(), mat(0x22_22_22))];
    const skipped = [new Mesh(box(), mat(0x33_33_33)), new Mesh(box(), mat(0x33_33_33))];
    const plain = new Mesh(box(), mat(0x44_44_44)),
      other = new Mesh(box(), mat(0x44_44_44));
    other.geometry.deleteAttribute('uv');
    lamp.add(must(scoped[1]));
    rack.add(must(skipped[0]));
    root.add(...glow, ...fade, ...mine, must(scoped[0]), lamp, rack, must(skipped[1]), plain, other);
    const n = matsOf(root).size;
    expect(shareMaterials(root, { skip: [rack] })).toStrictEqual({ before: n, after: n });
    expect(matsOf(root).size).toBe(n);
  });

  it('keeps each fade apart: a material under a fading lid is never shared with one outside it', () => {
    const root = new Group(),
      part = tagged('cpu0'),
      lid = new Group();
    const body = [new Mesh(box(), mat(0x22_22_22)), new Mesh(box(), mat(0x22_22_22))],
      top = [new Mesh(box(), mat(0x22_22_22)), new Mesh(box(), mat(0x22_22_22))];
    part.add(...body, lid);
    lid.add(...top);
    root.add(part);
    expect(shareMaterials(root, { apart: [lid] })).toStrictEqual({ before: 4, after: 2 });
    expect(must(body[1]).material).toBe(must(body[0]).material);
    expect(must(top[1]).material).toBe(must(top[0]).material);
    expect(must(top[0]).material).not.toBe(must(body[0]).material);
  });

  it('across: equal materials of different parts become one; a fade, a skin and a glow stay out of it', () => {
    const root = new Group(),
      a = tagged('ram0'),
      b = tagged('ram1'),
      lid = new Group(),
      c = tagged('ram2');
    const ma = new Mesh(box(), mat(0x22_33_44)),
      mb = new Mesh(box(), mat(0x22_33_44)),
      mc = new Mesh(box(), mat(0x22_33_44));
    const ga = new Mesh(box(), mat(0x22_33_44, { emissive: 0xff_aa_00 })),
      gb = new Mesh(box(), mat(0x22_33_44, { emissive: 0xff_aa_00 }));
    const sa = new Mesh(box(), mat(0x55_66_77)),
      sb = new Mesh(box(), mat(0x55_66_77));
    const fa = new Mesh(box(), mat(0x22_33_44)),
      fb = new Mesh(box(), mat(0x22_33_44));
    a.add(ma, ga, sa);
    b.add(mb, gb, sb);
    c.add(mc);
    lid.add(fa, fb);
    b.add(lid);
    root.add(a, b, c);
    const skin = new PartSkin([sa.material]);
    // (without `across`: no equal materials between parts)
    expect(shareMaterials(root, { apart: [lid] })).toStrictEqual({ before: 9, after: 9 - 1 });
    const solo = new Set([ma.material, mb.material, mc.material]);
    expect(solo.size).toBe(3);
    expect(shareMaterials(root, { apart: [lid], across: true })).toStrictEqual({ before: 8, after: 6 });
    expect(mb.material).toBe(ma.material);
    expect(mc.material).toBe(ma.material);
    expect(ga.material).not.toBe(gb.material);
    expect(sa.material).not.toBe(sb.material);
    expect(fa.material).toBe(fb.material);
    expect(fa.material).not.toBe(ma.material);
    skin.set({ ...ON, burnt: true });
    skin.frame(1);
    expect(sb.material.emissive.getHex()).toBe(0);
  });

  it('across: a material used by two parts is left as it is', () => {
    const root = new Group(),
      a = tagged('a'),
      b = tagged('b'),
      m = mat(0x22_33_44);
    a.add(new Mesh(box(), m));
    b.add(new Mesh(box(), m), new Mesh(box(), mat(0x22_33_44)));
    root.add(a, b);
    shareMaterials(root, { across: true });
    expect(asMesh(a.children[0]).material).toBe(m);
  });

  it('skin materials are never shared (a part state look stays on its own part)', () => {
    const root = new Group(),
      a = new Mesh(box(), mat(0x22_33_44)),
      b = new Mesh(box(), mat(0x22_33_44));
    root.add(a, b);
    const skin = new PartSkin([a.material]);
    shareMaterials(root);
    expect(b.material).not.toBe(a.material);
    skin.set({ ...ON, burnt: true });
    skin.frame(1);
    expect(b.material.emissive.getHex()).toBe(0);
  });

  it('shares equal box-projected materials: every mesh takes the first', () => {
    const root = new Group(),
      b = boxEnv([0, 0, 0], [1, 1, 1], [0, 0, 0]);
    const meshes = [0, 1, 2].map(() => {
      const m = mat(0x22_33_44);
      boxProjected(m, b);
      return new Mesh(box(), m);
    });
    root.add(...meshes);
    shareMaterials(root);
    expect(new Set(meshes.map((m) => m.material)).size).toBe(1);
  });
});
