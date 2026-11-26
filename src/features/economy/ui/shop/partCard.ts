// The picker card of a part: a slot (empty socket or the part in it), a device, a spec id, an inventory item or a world object.

import { getSpec } from '@/features/board/sim/specs';
import type { Snapshot } from '@/worker/game/game';
import { describeId, KIND_LABEL } from '@/core/ui/logic';
import { unlockedFirst } from '../progress/levelui';
import { boardCards, vrmReadout } from '@/features/board/ui/vrm';
import { emptyCard } from './pickerBase';
import { ladderFor, nextUpgrade } from './pickerLadder';
import type { LadderStep, PickerModel, SelectedKind } from './pickerTypes';
import { partLines } from './partLines';
import { currentOf, focusOf, partActions, partCtx } from './partCtx';

type PartCtx = ReturnType<typeof partCtx>;

function titleOf({ kind, dev, emptySocket, fanSize }: PartCtx, fallback: string): string {
  if (emptySocket) {
    return kind === 'fan' ? `${String(fanSize)} mm fan spot` : `${KIND_LABEL[kind]} socket`;
  }
  return dev ? dev.name : fallback;
}

/** The VRM readout rides on the CPU card (what it draws from the regulator) and the memory card. */
function vrmOf({ s, kind, dev }: PartCtx): PickerModel['vrm'] {
  if (!dev || dev.burnt) {
    return undefined;
  }
  if (kind === 'cpu') {
    return vrmReadout(s);
  }
  return kind === 'ram' ? vrmReadout(s, 'ram') : undefined;
}

/** The ladder of the part's kind; a fan spot offers its own size only (the next tier of the whole catalog would not fit). */
function partLadder({ s, kind, fanSize }: PartCtx): LadderStep[] {
  return ladderFor(s, kind).filter((r) => {
    const f = fanSize === undefined || fanSize === 0 ? undefined : getSpec(r.specId);
    return f?.kind !== 'fan' || f.size === fanSize;
  });
}

/** The picker card of a part of a known kind. */
export function partCard(id: string, s: Snapshot, kind: SelectedKind): PickerModel {
  const c = partCtx(id, s, kind);
  const { dev, emptySocket, sec } = c;
  const d = (dev && !emptySocket ? describeId(dev.spec) : describeId(id, s)) ??
    describeId(id) ?? { title: KIND_LABEL[kind], plain: '', nerd: '' };
  const ladder = partLadder(c);
  return {
    ...emptyCard(id, kind, { ...d, title: titleOf(c, d.title) }),
    // With an OS installed, its ladder is in the OS section; the bay offers the systems while none is installed.
    ladder: sec && kind === 'os' ? [] : ladder,
    osSection: sec,
    shelf: id === 'bay' && !s.os ? unlockedFirst(ladderFor(s, 'os'), (r) => r.lock) : undefined,
    vrm: vrmOf(c),
    boardCards: kind === 'board' ? boardCards(s) : undefined,
    current: currentOf(c),
    lines: partLines(c),
    actions: partActions(c),
    focus: focusOf(c),
    device: emptySocket ? undefined : dev,
    clock: ((kind === 'cpu' && Boolean(s.cpuClock)) || kind === 'ram') && dev !== undefined && !dev.burnt,
    // Only when the fitted part is the top tier: any higher tier (spare, buyable, blocked or later) gets its own line.
    emptyText: nextUpgrade(ladder) ? undefined : 'Nothing better to buy right now.',
  };
}
