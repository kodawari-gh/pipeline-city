import { clampHeat, type AirFan, type AirHeat, type AirSource } from '@/core/render/airsource';
import { getSpec } from '../sim/specs';
import { CASE, GEO, PSU, PSU_REAR_FAN, PSU_UNIT, RAM_SINK, REAR_FAN, VRM_SINK } from './layout/layout';
import { sinkFanAt } from './layout/pins';
import { psuFanRect, sinkFanRect } from './devices';

/**
 * The board and what hangs on it: the PSU (heat from its load: the sim has no PSU heat), the two voltage regulators (one shape per fitted phase,
 * hot against their own throttle point), and the fans of the PSU and of the two regulators' heatsinks (`psu`, `vrm`, `ramvrm` in `fanBank`,
 * spun by live.ts; a heatsink fan blows along its fins toward the rear exhaust). The case fans and the radiator's are the case's streams in the airflow model itself.
 */
export const boardAir: AirSource = {
  id: 'board',
  kinds: ['psu', 'vrm-sink', 'ram-sink', 'radiator'],
  heat(c) {
    const out: AirHeat[] = [];
    const psu = c.s.devices.find((d) => d.kind === 'psu');
    if (psu) {
      const load = c.live ? Math.max(0, Math.min(1, c.s.power.totalW / Math.max(1, c.s.power.budgetW))) : 0;
      out.push({ id: 'psu', label: 'PSU', rects: [PSU], ids: ['psu'], tempC: 30 + load * 33, heat: load * 0.6 });
    }
    for (const [id, label, v, phases] of [['vrm', 'VRM', c.s.board?.vrm, GEO.vrmPhases], ['rvrm', 'MEM VRM', c.s.board?.ramVrm, GEO.dPhases]] as const) {
      if (!v) continue;
      const rects = phases.slice(0, v.phases);
      if (rects.length) out.push({ id, label, rects, flat: true, tempC: v.tempC, heat: c.live ? clampHeat((v.tempC - 30) / Math.max(10, v.throttleC - 30)) : 0 });
    }
    return out;
  },
  fans(c) {
    const out: AirFan[] = [];
    const psuDev = c.s.devices.find((d) => d.kind === 'psu');
    if (psuDev && (getSpec(psuDev.spec) as { fan?: boolean } | undefined)?.fan) {
      // the PSU draws air from under the case, through its shroud, and blows it out the rear (west) wall's grille
      // the case is seen from the side: the fan sits in the PSU's bottom face, so it shows edge-on (a slab along the floor), not as a round face
      const below = CASE.y + CASE.h + 700, exit = REAR_FAN.x - 700;
      const slab = psuFanRect(), fx = slab.x + slab.w / 2, y = PSU_REAR_FAN ? PSU_REAR_FAN.y + PSU_REAR_FAN.h / 2 : PSU_UNIT.y + PSU_UNIT.h * 0.55;
      out.push({ id: 'psu', rect: PSU, edge: [slab], path: [[fx, below], [fx, slab.y + slab.h], [fx, y], [fx - 500, y], [exit + 400, y], [exit, y]] });
    }
    for (const [id, kind, rect] of [['vrm', 'vrm-sink', VRM_SINK], ['ramvrm', 'ram-sink', RAM_SINK]] as const) {
      const d = c.s.devices.find((x) => x.kind === kind);
      if (!d || !(getSpec(d.spec) as { fan?: boolean } | undefined)?.fan) continue; // a passive sink has no fan
      const at = sinkFanAt(rect);
      // the fan (an edge-on slab at the east end) pulls case air in and pushes it west ALONG the fin channels, toward the rear exhaust (not out of the picture, not onto the processor)
      const slab = sinkFanRect(rect), exit = REAR_FAN.x - 700, exitY = REAR_FAN.y + REAR_FAN.h / 2;
      out.push({ id, rect, edge: [slab], path: [[slab.x, at.y], [rect.x - 60, at.y], [exit + 500, exitY], [exit, exitY]] });
    }
    return out;
  },
};
