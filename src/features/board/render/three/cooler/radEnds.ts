// The radiator's end tanks (cooler3d.ts `radiatorModel`): one past the fans at each end, each closed by an end cap; the near one (to the pump)
// with the two G1/4 ports and their fittings, the far one with the fill plug.
import { Vector3 } from 'three';
import { softBox } from '@/core/render/three/geometry';
import { TANK } from '../../cooler';
import { chrome, fitting, plug } from './kit';
import { TANK_LIP, radiatorPorts3d } from './radiator';
import type { Material, Rad, RadiatorFit } from './types';

/** The end tanks, each closed by its cap. */
export function radTanks(rad: Rad, bodyM: Material, plateM: Material): void {
  const { root, fr, L, v0, t, z0, z1 } = rad,
    CAP = 50;
  for (const near of [true, false]) {
    const u0 = near ? -TANK : L;
    root.add(
      softBox(
        fr.rect(near ? u0 + CAP : u0, v0 - TANK_LIP, TANK - CAP, t + 2 * TANK_LIP),
        z0 - TANK_LIP,
        z1 + TANK_LIP,
        bodyM,
        24,
      ),
    );
    root.add(
      softBox(
        fr.rect(near ? u0 : u0 + TANK - CAP, v0 - TANK_LIP + 8, CAP, t + 2 * TANK_LIP - 16),
        z0 - TANK_LIP + 8,
        z1 + TANK_LIP - 8,
        plateM,
        16,
      ),
    );
  }
}

/** The two ports on the near tank's inboard face, a fitting in each; the fill plug on the far one's. */
export function radPorts(rad: Rad, fit: RadiatorFit): void {
  const { root, fr, L, v1, zc } = rad;
  const m = chrome(),
    inward = new Vector3(fr.inward[0], -fr.inward[1], 0),
    fill = fr.P(L + TANK / 2, v1 + TANK_LIP);
  for (const p of radiatorPorts3d(fit)) {
    fitting(root, { p: new Vector3(...p.at), dir: inward }, m);
  }
  plug(root, { p: new Vector3(fill[0], -fill[1], zc), dir: inward }, m);
}
