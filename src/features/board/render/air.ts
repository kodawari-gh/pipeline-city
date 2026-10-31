import { clampHeat, type AirFan, type AirHeat, type AirSource } from '@/core/render/airsource';
import { getSpec } from '../sim/specs';
import { CASE, GEO, PSU, PSU_FAN, RAM_SINK, REAR_FAN, VRM_SINK } from './layout/layout';
import { SINK_FAN_R, sinkFanAt } from './layout/pins';

/**
 * The board and what hangs on it: the PSU (heat from its load: the sim has no PSU heat), the two voltage regulators (one shape per fitted phase,
 * hot against their own throttle point), and the fans of the PSU and of the two regulators' heatsinks (`psu`, `vrm`, `ramvrm` in `fanBank`,
 * spun by live.ts). The case fans and the radiator's are the case's streams in the airflow model itself.
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
    if (c.s.devices.some((d) => d.kind === 'psu')) {
      // the PSU draws air from under the case, through its shroud, and blows it out the rear (west) wall's grille
      const f = PSU_FAN, below = CASE.y + CASE.h + 700, exit = REAR_FAN.x - 700;
      out.push({ id: 'psu', rect: PSU, rotor: { x: f.x, y: f.y, r: f.r, blades: 7 }, path: [[f.x, below], [f.x, f.y], [f.x - 500, f.y], [exit + 400, f.y], [exit, f.y]] });
    }
    for (const [id, kind, rect] of [['vrm', 'vrm-sink', VRM_SINK], ['ramvrm', 'ram-sink', RAM_SINK]] as const) {
      const d = c.s.devices.find((x) => x.kind === kind);
      if (!d || !(getSpec(d.spec) as { fan?: boolean } | undefined)?.fan) continue; // a passive sink has no fan
      const at = sinkFanAt(rect);
      out.push({ id, rect, rotor: { x: at.x, y: at.y, r: SINK_FAN_R, blades: 5 } });
    }
    return out;
  },
};
