import { deviceHeat } from '@/core/render/airsource';
import type * as airsourceTypes from '@/core/render/airsource';

/** The memory sticks: one heat zone, a glow per stick. */
export const memoryAir: airsourceTypes.AirSource = {
  id: 'memory',
  kinds: ['ram'],
  heat: (c) => deviceHeat(['ram'], 'ram', 'RAM', c),
};
