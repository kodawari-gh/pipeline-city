import * as airsource from '@/core/render/airsource';

/** The neural cards: a heat zone. They have no fan of their own (a fan would be an `AirFan` here, spun by npuview.ts through `fanBank`). */
export const npuAir: airsource.AirSource = {
  id: 'npu',
  kinds: ['npu'],
  heat: (c) => airsource.deviceHeat(['npu'], 'npu', 'NPU', c),
};
