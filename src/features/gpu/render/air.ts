import { deviceHeat, type AirFan, type AirSource } from '@/core/render/airsource';
import { cardOrigin } from '@/core/render/accelart';
import { getSpec } from '@/features/board/sim/specs';
import { gpuPlan, moveRect } from './gpulayout';

/** The graphics cards: a heat zone, and each card's own fans (`gpu:<slot>` in `fanBank`, spun by gpuview.ts), seen edge-on along the card's top edge. */
export const gpuAir: AirSource = {
  id: 'gpu',
  kinds: ['gpu'],
  heat: (c) => deviceHeat(['gpu'], 'gpu', 'GPU', c),
  fans: (c) => c.s.devices.filter((d) => d.kind === 'gpu').flatMap((d): AirFan[] => {
    const r = c.slots.get(d.slot), visual = getSpec(d.spec)?.visual;
    if (!r || !visual) return [];
    const o = cardOrigin(Number(/\d+$/.exec(d.slot)?.[0] ?? 0), visual);
    return [{ id: `gpu:${d.slot}`, rect: r, edge: gpuPlan(visual).fans.map((f) => moveRect(f, o)) }];
  }),
};
