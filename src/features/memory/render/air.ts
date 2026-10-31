import { deviceHeat, type AirSource } from '@/core/render/airsource';

/** The memory sticks: one heat zone, a glow per stick. */
export const memoryAir: AirSource = { id: 'memory', kinds: ['ram'], heat: (c) => deviceHeat(['ram'], 'ram', 'RAM', c) };
