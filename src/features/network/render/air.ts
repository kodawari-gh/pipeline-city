import { deviceHeat, type AirSource } from '@/core/render/airsource';

/** The network card: a heat zone. */
export const networkAir: AirSource = { id: 'network', kinds: ['nic'], heat: (c) => deviceHeat(['nic'], 'nic', 'NIC', c) };
