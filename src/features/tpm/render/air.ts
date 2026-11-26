import * as airsource from '@/core/render/airsource';

/** The security module: a heat zone. */
export const tpmAir: airsource.AirSource = {
  id: 'tpm',
  kinds: ['tpm'],
  heat: (c) => airsource.deviceHeat(['tpm'], 'tpm', 'TPM', c),
};
