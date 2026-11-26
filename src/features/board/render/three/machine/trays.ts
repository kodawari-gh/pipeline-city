// The drive trays' drop boxes and the back wall's slot covers (machine3d.ts): an empty tray is picked by an unseen box over it, an empty PCIe
// slot by its cover.
import { tag } from '@/core/render/three/pick';
import { CASE_KIND } from '@/features/room/render/shell/casedecor';
import { LAYOUT_CASE, nicY } from '../../layout/layout';
import { SLOT_BLANK } from '../casedetail3d';
import { slotBlank } from '../card3d';
import { trayHit } from '../drivecage3d';
import type { CagePlan, MachineParts } from './types';

/** The unseen box over a bare tray: a drop lands on it. */
export function trayPick(m: MachineParts, t: CagePlan['trays'][number]): void {
  const id = `sata${t.slot}`,
    b = tag(trayHit(t), id);
  m.picks.set(id, b);
  m.root.add(b);
}

/** The unseen box over each bare tray. */
export function trayPicks(m: MachineParts, filled: ReadonlySet<string>): void {
  for (const t of m.cages.flatMap((c) => c.trays)) {
    const id = `sata${t.slot}`;
    if (!filled.has(id)) {
      trayPick(m, t);
    }
  }
}

/** The plate over the empty PCIe slot `i`, in the back wall's tone. */
export function addBlank(m: MachineParts, i: number): ReturnType<typeof slotBlank> {
  const b = slotBlank(nicY(i), m.blankTone);
  b.name = `pcie blank ${i}`;
  m.blanks.set(`pcie${i}`, b);
  m.root.add(b);
  return b;
}

/** The back wall's slot covers take the case's own tone (`SLOT_BLANK`). */
export function setBlankTone(m: MachineParts): void {
  m.blankTone = SLOT_BLANK[CASE_KIND[LAYOUT_CASE] ?? 'gamer'];
}
