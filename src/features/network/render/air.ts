import * as airsource from '@/core/render/airsource';

/** The network card: a heat zone. */
export const networkAir: airsource.AirSource = {
  id: 'network',
  kinds: ['nic'],
  heat: (c) => airsource.deviceHeat(['nic'], 'nic', 'NIC', c),
};
