// The power lens's view of the parts (Machine3D.powerGlow, docs/render/power.md): a part glows by what it draws in the colour of its role, a fan or the module glows alone
// (it has no skin in the other views), and the part's own look comes back.
import { beforeAll, describe, expect, it } from 'vitest';
import type { Mesh, MeshStandardMaterial } from 'three';
import { BakeQueue } from '@/core/render/three/artlod';
import { findById, idOf } from '@/core/render/three/pick';
import { roomGeo } from '@/features/room/render/shell/room';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { Machine3D } from './machine3d';
import { quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const isMesh = (o: unknown): o is Mesh => typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;
function asMesh(o: unknown): Mesh {
  if (!isMesh(o)) {
    throw new Error('expected a Mesh');
  }
  return o;
}

quietCanvas();

describe('Machine3D.powerGlow', () => {
  let snap: Snapshot, m: Machine3D;
  beforeAll(() => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }),
      bought = g.purchase('tpm1');
    if (bought.ok) {
      g.install(bought.invId, 'tpm0');
    }
    // (a machine that is off: no fan turns and no ring of light shines, so a glow is the lens's)
    snap = { ...g.snapshot(), powered: false };
    m = new Machine3D(snap, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false });
  });

  const ids = (kind: string): string[] => snap.devices.filter((d) => d.kind === kind).map((d) => d.id);
  /** The glow of the materials of one part: the strongest of its meshes' (intensity), and the colour of that one. (The supply answers to its kind, not its id.) */
  const glow = (id: string): { k: number; rgb: [number, number, number] } => {
    const tag = findById(m.root, id) ? id : (snap.devices.find((d) => d.id === id)?.kind ?? id);
    let best = { k: 0, rgb: [0, 0, 0] as [number, number, number] };
    m.root.traverse((o) => {
      if (!isMesh(o)) {
        return;
      }
      const mat = asMesh(o).material as MeshStandardMaterial | undefined;
      if (!isMesh(o) || !mat || Array.isArray(mat) || !mat.emissive || idOf(o) !== tag) {
        return;
      }
      const k = mat.emissiveIntensity * Math.max(mat.emissive.r, mat.emissive.g, mat.emissive.b);
      if (k > best.k) {
        best = { k, rgb: [mat.emissive.r, mat.emissive.g, mat.emissive.b] };
      }
    });
    return best;
  };
  /** Ease the parts all the way to the look they were given. */
  const settle = (): void => {
    m.frame(snap, { dt: 5 });
  };
  const lens = (
    levels: [string, number][],
    roles: [string, 'source' | 'hub' | 'use'][] = levels.map(([id]) => [id, 'use'] as [string, 'use']),
    warn: string[] = [],
  ): void => {
    m.powerGlow(new Map(levels), new Set(warn), new Map(roles));
    settle();
  };

  function assert_lights_a_fan_by_what_it_draws_and_one_fan_alone_(): void {
    const fans = ids('fan');
    expect(fans.length).toBeGreaterThanOrEqual(2);
    const [a, b] = fans as [string, string];
    lens([
      [a, 1],
      [b, 0.1],
    ]);
    expect(glow(a).k).toBeGreaterThan(glow(b).k);
    expect(glow(b).k).toBeGreaterThan(0);
    // (the other fans are not in the lens: they have no role and stay dark)
    const rest = fans.filter((f) => f !== a && f !== b);
    for (const f of rest) {
      expect(glow(f).k).toBe(0);
    }
    m.powerGlow(null);
    settle();
  }

  it('lights a fan by what it draws, and one fan alone: the fans share no material in the lens', () => {
    expect.hasAssertions();
    assert_lights_a_fan_by_what_it_draws_and_one_fan_alone_();
  });

  it("lights the module (the TPM) too, and gives the lens's glow back to nothing when it is off", () => {
    const tpm = ids('tpm')[0];
    expect(tpm).toBeDefined();
    expect(glow(must(tpm)).k).toBe(0);
    lens([[must(tpm), 0.6]]);
    expect(glow(must(tpm)).k).toBeGreaterThan(0.1);
    m.powerGlow(null);
    settle();
    expect(glow(must(tpm)).k).toBeLessThan(1e-3);
  });

  function assert_gives_a_fan_materials_of_its_own_only_while_the_(): void {
    const fan = must(ids('fan')[0]);
    const mats = (): unknown[] => {
      const out: unknown[] = [];
      findById(m.root, fan)?.traverse((o) => {
        if (isMesh(o)) {
          out.push(asMesh(o).material);
        }
      });
      return out;
    };
    m.powerGlow(null);
    const before = mats();
    expect(before.length).toBeGreaterThan(0);
    lens([[fan, 1]]);
    // (the ring of light is the fan's own glow and stays as it was: every other material is a copy)
    const during = mats();
    expect(during).toHaveLength(before.length);
    expect(during.filter((x, i) => x !== before[i]).length).toBeGreaterThan(0);
    m.powerGlow(null);
    settle();
    const after = mats();
    expect(after.every((x, i) => x === before[i])).toBe(true);
    // (and again: the lens can be turned on and off any number of times)
    lens([[fan, 0.5]]);
    expect(glow(fan).k).toBeGreaterThan(0);
    m.powerGlow(null);
    settle();
    expect(mats().every((x, i) => x === before[i])).toBe(true);
  }

  it("gives a fan materials of its own only while the lens shows (a material that no other part shares costs a draw each: the other views keep the build's), and puts the build's back", () => {
    expect.hasAssertions();
    assert_gives_a_fan_materials_of_its_own_only_while_the_();
  });

  it('shows a use in amber, a hub in cyan and a source in white', () => {
    const cpu = must(ids('cpu')[0]),
      psu = must(ids('psu')[0]);
    lens(
      [
        [cpu, 0.7],
        [psu, 0.7],
      ],
      [
        [cpu, 'use'],
        [psu, 'hub'],
      ],
    );
    const use = glow(cpu).rgb,
      hub = glow(psu).rgb;
    expect(use[0]).toBeGreaterThan(use[2]);
    expect(hub[2]).toBeGreaterThan(hub[0]);
    lens([[psu, 0.7]], [[psu, 'source']]);
    const src = glow(psu).rgb;
    expect(Math.min(...src) / Math.max(...src)).toBeGreaterThan(0.6);
    m.powerGlow(null);
    settle();
  });

  it('shows a part that is over its budget in red', () => {
    const psu = must(ids('psu')[0]);
    lens([[psu, 1]], [[psu, 'hub']], [psu]);
    const [r, g, b] = glow(psu).rgb;
    expect(r).toBeGreaterThan(g * 2);
    expect(r).toBeGreaterThan(b * 2);
    m.powerGlow(null);
    settle();
  });

  it("takes the basement's shroud off while the lens shows (the supply and the fan hub stand under it), and puts it back", () => {
    const shroud = m.root.getObjectByName('shroud');
    expect(shroud).toBeDefined();
    expect(must(shroud).visible).toBe(true);
    lens([[must(ids('cpu')[0]), 0.5]]);
    expect(must(shroud).visible).toBe(false);
    m.powerGlow(null);
    expect(must(shroud).visible).toBe(true);
  });

  function assert_puts_the_fans_rings_of_light_low_while_the_lens_(): void {
    const on = {
      ...snap,
      powered: true,
      power: { ...snap.power, off: false, tripped: false },
      cables: snap.cables.map((c) => ({ ...c, connected: true })),
    };
    const fans = ids('fan')
      .slice(1)
      .map((id) => must(findById(m.root, id)));
    expect(fans.length).toBeGreaterThan(0);
    // (the ring of light is the brightest glow the fans' meshes carry; the first fan is the one the lens lights, so it stays out)
    const ring = (): number =>
      Math.max(
        0,
        ...fans.flatMap((f) =>
          f
            .getObjectsByProperty('isMesh', true)
            .flatMap((o) =>
              [Reflect.get(o, 'material')].flat().map((x) => Number(Reflect.get(x, 'emissiveIntensity'))),
            ),
        ),
      );
    m.powerGlow(null);
    // (the fans spin up: their rings shine)
    for (let i = 0; i < 80; i++) {
      m.frame(on, { dt: 0.1 });
    }
    const own = ring();
    expect(own).toBeGreaterThan(0.5);
    const fanId = must(ids('fan')[0]);
    m.powerGlow(new Map([[fanId, 1]]), new Set(), new Map([[fanId, 'use']]));
    m.frame(on, { dt: 0.1 });
    expect(ring()).toBeLessThan(own * 0.25);
    m.powerGlow(null);
    m.frame(on, { dt: 0.1 });
    expect(ring()).toBeGreaterThan(own * 0.9);
    // (the machine off again: the next tests see the rings dark)
    for (let i = 0; i < 80; i++) {
      m.frame(snap, { dt: 0.1 });
    }
  }

  it("puts the fans' rings of light low while the lens shows: a decoration is no power", () => {
    expect.hasAssertions();
    assert_puts_the_fans_rings_of_light_low_while_the_lens_();
  });

  it('keeps the own look of a part that has no role (a heatsink, a radiator), and brings every look back when the lens ends', () => {
    const cpu = must(ids('cpu')[0]);
    const before = glow(cpu).k;
    // (roles say none for the cpu: it is not in the map)
    m.powerGlow(new Map([[cpu, 0.9]]), new Set(), new Map());
    settle();
    expect(glow(cpu).k).toBeCloseTo(before, 5);
    lens([[cpu, 0.9]]);
    expect(glow(cpu).k).toBeGreaterThan(before + 0.1);
    m.powerGlow(null);
    settle();
    expect(glow(cpu).k).toBeCloseTo(before, 3);
  });
});
