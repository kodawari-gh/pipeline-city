import { deviceHeat, type AirSource } from '@/core/render/airsource';

/** The drives (SATA and M.2): one heat zone, a glow per drive. */
export const storageAir: AirSource = { id: 'storage', kinds: ['storage'], heat: (c) => deviceHeat(['storage'], 'storage', 'DRIVE', c) };
