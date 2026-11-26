// The stock heatsink (cooler3d.ts): a copper core in a ring of swept vanes under a plastic shroud on four push pins, a 92 mm fan on top blowing down.
import { Shape, Vector2 } from 'three';
import { SEG, drum, extrude, instanced } from '@/core/render/three/geometry';
import { tag } from '@/core/render/three/pick';
import { fanDepth, fanPart } from '../fans3d';
import { mount } from './kit';
import { L, alu, copper, plastic } from './look';
import { SHROUD, STOCK_FAN } from './plan';
import { stockShroud } from './stockShroud';
import type { FanFit, Group, MeshStandardMaterial, Spin } from './types';

/** A stock vane seen from the glass: a thin blade from the core out to the rim, bending back as it goes (the fan's swirl leaves along it). */
function vaneShape(r0: number, r1: number, blade: { t: number; sweep: number }): Shape {
  const { t, sweep } = blade;
  const side = (o: number) =>
    Array.from({ length: 9 }, (_, k) => {
      const u = k / 8,
        r = r0 + (r1 - r0) * u,
        a = sweep * u * u;
      return new Vector2(Math.cos(a) * r - Math.sin(a) * o, Math.sin(a) * r + Math.cos(a) * o);
    });
  return new Shape([...side(-t / 2), ...side(t / 2).toReversed()]);
}

/** The stock heatsink on `g`, its fan fitted if there is one; the vanes' material is its skin. */
export function stock(g: Group, spins: Spin[], fans: readonly FanFit[]): MeshStandardMaterial {
  const { z0, z1 } = SHROUD,
    vane = alu(0xa7_af_bf, 0.3),
    black = plastic(),
    cu = copper();
  mount(g, {});
  // the copper core on the lid, a ring of sixty swept vanes round it
  g.add(drum(0, 0, L, L + 40, 360, cu, SEG.wideDisc), drum(0, 0, L + 40, z0, 300, cu, SEG.wideDisc));
  const blades = extrude(vaneShape(290, 1020, { t: 16, sweep: 0.45 }), { depth: z0 - L - 40, bevelEnabled: false });
  g.add(
    instanced(
      blades,
      vane,
      Array.from({ length: 60 }, (_, k) => ({ x: 0, y: 0, z: L + 40, rz: (k / 60) * Math.PI * 2 })),
    ),
  );
  stockShroud(g, black);
  const [fan] = fans;
  if (fan) {
    const f = fanPart(fan.spec, STOCK_FAN, fanDepth(92));
    f.root.position.set(0, 0, z1 + fanDepth(92) / 2);
    g.add(tag(f.root, fan.id));
    spins.push({ ...f.spin, needs: 'cpufan', gain: 0 });
  }
  return vane;
}
