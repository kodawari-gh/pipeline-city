import { clampHeat, type AirFan, type AirHeat, type AirSource, type Box } from '@/core/render/airsource';
import { GEO, PSU, PSU_FAN, RAM_SINK, VRM_SINK } from './layout/layout';

const box = (c: { x: number; y: number; r: number }): Box => ({ x: c.x - c.r, y: c.y - c.r, w: 2 * c.r, h: 2 * c.r });

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
    if (c.s.devices.some((d) => d.kind === 'psu')) {
      const load = c.live ? Math.max(0, Math.min(1, c.s.power.totalW / Math.max(1, c.s.power.budgetW))) : 0;
      out.push({ id: 'psu', label: 'PSU', rects: [PSU], tempC: 30 + load * 33, heat: load * 0.6 });
    }
    for (const [id, label, v, phases] of [['vrm', 'VRM', c.s.board?.vrm, GEO.vrmPhases], ['rvrm', 'MEM VRM', c.s.board?.ramVrm, GEO.dPhases]] as const) {
      if (!v) continue;
      const rects = phases.slice(0, v.phases);
      if (rects.length) out.push({ id, label, rects, tempC: v.tempC, heat: c.live ? clampHeat((v.tempC - 30) / Math.max(10, v.throttleC - 30)) : 0 });
    }
    return out;
  },
  fans(c) {
    const out: AirFan[] = [];
    if (c.s.devices.some((d) => d.kind === 'psu')) out.push({ id: 'psu', rect: box(PSU_FAN) });
    if (c.s.devices.some((d) => d.kind === 'vrm-sink')) out.push({ id: 'vrm', rect: VRM_SINK });
    if (c.s.devices.some((d) => d.kind === 'ram-sink')) out.push({ id: 'ramvrm', rect: RAM_SINK });
    return out;
  },
};
