import { deviceHeat, type AirFan, type AirSource } from '@/core/render/airsource';

/** The graphics cards: a heat zone, and each card's own fans (`gpu:<slot>` in `fanBank`, spun by gpuview.ts). */
export const gpuAir: AirSource = {
  id: 'gpu',
  kinds: ['gpu'],
  heat: (c) => deviceHeat(['gpu'], 'gpu', 'GPU', c),
  fans: (c) => c.s.devices.filter((d) => d.kind === 'gpu').flatMap((d): AirFan[] => { const r = c.slots.get(d.slot); return r ? [{ id: `gpu:${d.slot}`, rect: r }] : []; }),
};
