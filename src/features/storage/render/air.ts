import { deviceHeat, type AirSource } from '@/core/render/airsource';
import { BASE_BAYS } from '@/features/board/sim/airflow';

/** Is the slot a bay of the main cage (behind the front fans), not the basement's or an M.2 socket? */
const inCage = (slot: string) => { const m = /^sata(\d+)$/.exec(slot); return !!m && Number(m[1]) >= BASE_BAYS; };

/**
 * The drives, a glow per drive, in two heat zones: those of the main cage stand in the front fans' air and the air goes round them (the sim takes that
 * air from the board, board/sim/airflow.ts); the basement's and the M.2 sticks are out of its way.
 */
export const storageAir: AirSource = {
  id: 'storage', kinds: ['storage'],
  heat: (c) => [...deviceHeat(['storage'], 'storage.cage', 'DRIVE', c, false, inCage), ...deviceHeat(['storage'], 'storage', 'DRIVE', c, true, (s) => !inCage(s))],
};
