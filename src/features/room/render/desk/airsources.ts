import type { AirSource } from '@/core/render/airsource';
import { boardAir } from '@/features/board/render/air';
import { cpuAir } from '@/features/cpu/render/air';
import { gpuAir } from '@/features/gpu/render/air';
import { memoryAir } from '@/features/memory/render/air';
import { networkAir } from '@/features/network/render/air';
import { npuAir } from '@/features/npu/render/air';
import { storageAir } from '@/features/storage/render/air';
import { tpmAir } from '@/features/tpm/render/air';

/**
 * Every component's contribution to the airflow lens. A new part kind with thermals: write its `render/air.ts` and add it here.
 * (`airsources.test.ts` fails until every kind with thermals is claimed by one of them, or is listed in `OUTSIDE_THE_CASE`.)
 */
export const AIR_SOURCES: AirSource[] = [cpuAir, gpuAir, npuAir, memoryAir, storageAir, networkAir, tpmAir, boardAir];

/** Kinds with thermals that sit outside the case: no air of the case reaches them. */
export const OUTSIDE_THE_CASE = ['display'];
