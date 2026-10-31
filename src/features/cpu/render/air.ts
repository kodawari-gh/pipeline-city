import { deviceHeat, type AirSource } from '@/core/render/airsource';
import { COOLER } from '@/features/board/render/layout/layout';

/** The processor: a heat zone, and the cooler's fan (live.ts's `cooler`) when a cooler is fitted. */
export const cpuAir: AirSource = {
  id: 'cpu',
  kinds: ['cpu', 'cooler'],
  heat: (c) => deviceHeat(['cpu'], 'cpu', 'CPU', c),
  fans: (c) => (c.s.devices.some((d) => d.kind === 'cooler') ? [{ id: 'cooler', rect: COOLER }] : []),
};
