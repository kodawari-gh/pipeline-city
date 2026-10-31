import { deviceHeat, type AirSource } from '@/core/render/airsource';

/** The security module: a heat zone. */
export const tpmAir: AirSource = { id: 'tpm', kinds: ['tpm'], heat: (c) => deviceHeat(['tpm'], 'tpm', 'TPM', c) };
