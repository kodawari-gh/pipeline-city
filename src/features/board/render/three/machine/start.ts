// What the machine sets before its build (machine3d.ts): the merge, the tiers, the live dies' scene, the radiator and the parts fitted.
import { radiatorSpan } from '@/features/room/render/desk/props/case';
import { COOLER } from '../../layout/layout';
import { radiatorFit, radiatorGrade } from '../../cooler';
import { visualOf } from './keys';
import type { MachineParts, Snapshot } from './types';

/** What the constructor sets before the build: the merge, the tiers, the live dies' scene, the radiator and the parts fitted. */
export function start(m: MachineParts, s: Snapshot | null, merge: boolean): void {
  m.merged = merge;
  m.tiers = s ? `${s.boardTier}|${s.caseTier}` : '';
  m.chips?.setScene(s);
  const radDev = s?.devices.find((d) => d.kind === 'radiator'),
    span = radDev ? radiatorSpan(radDev.slot === 'rad-front' ? 'front' : 'top') : null;
  if (span && radDev) {
    m.rad = {
      fit: radiatorFit(span, COOLER.x + COOLER.w / 2, radiatorGrade(visualOf(radDev.spec))),
      count: span.ids.length,
      span,
    };
  }
  m.devs = s?.devices ?? [];
}
