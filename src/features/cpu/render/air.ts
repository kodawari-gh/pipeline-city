import { deviceHeat, type AirSource } from '@/core/render/airsource';
import { getSpec } from '@/features/board/sim/specs';
import { coolerFanAt } from '@/features/board/render/cooler';
import { COOLER } from '@/features/board/render/layout/layout';

/** The processor: a heat zone, and the cooler's fan (live.ts's `cooler`; on a liquid cooler the pump's impeller) when a cooler is fitted. */
export const cpuAir: AirSource = {
  id: 'cpu',
  kinds: ['cpu', 'cooler'],
  heat: (c) => deviceHeat(['cpu'], 'cpu', 'CPU', c, true),
  fans: (c) => c.s.devices.filter((d) => d.kind === 'cooler').map((d) => ({ id: 'cooler', rect: COOLER, rotor: coolerFanAt(getSpec(d.spec)?.visual ?? '') })),
};
