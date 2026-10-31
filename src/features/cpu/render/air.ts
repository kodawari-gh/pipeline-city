import { deviceHeat, type AirFan, type AirSource } from '@/core/render/airsource';
import { getSpec } from '@/features/board/sim/specs';
import { coolerFanAt, STOCK_VANES_R, towerFanRect } from '@/features/board/render/cooler';
import { COOLER, REAR_FAN } from '@/features/board/render/layout/layout';

/**
 * The processor: a heat zone, and the cooler's fan (live.ts's `cooler`) when a cooler is fitted. The stock cooler's is round, seen face on: it blows down
 * into the vanes and the air leaves them sideways. The tower's is an edge-on slab on the east end that blows west through the fins, toward the rear
 * exhaust. The stock cooler's fan blows down into its vanes, so its air leaves all round them (a ring). The loop's round rotor is its pump (it moves coolant, no air; the radiator's fans are the case's).
 */
export const cpuAir: AirSource = {
  id: 'cpu',
  kinds: ['cpu', 'cooler'],
  heat: (c) => deviceHeat(['cpu'], 'cpu', 'CPU', c, true),
  fans: (c) => c.s.devices.filter((d) => d.kind === 'cooler').map((d): AirFan => {
    const visual = getSpec(d.spec)?.visual ?? '';
    if (visual === 'cooler-tower') {
      const slab = towerFanRect(), y = slab.y + slab.h / 2, exit = REAR_FAN.x - 700, exitY = REAR_FAN.y + REAR_FAN.h / 2;
      return { id: 'cooler', rect: COOLER, edge: [slab], path: [[slab.x, y], [COOLER.x - 60, y], [exit + 500, exitY], [exit, exitY]] };
    }
    return { id: 'cooler', rect: COOLER, rotor: coolerFanAt(visual), ...(visual === 'cooler-liquid' ? { noStream: true } : { ring: STOCK_VANES_R }) };
  }),
};
