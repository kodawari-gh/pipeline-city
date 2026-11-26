// The picker's upgrade ladder: one rung per tier of a kind, with what the player owns, can buy, or must wait for.

import { BOARD_TIERS, CASE_TIERS, getSpec } from '@/features/board/sim/specs';
import { getOsSpec } from '@/features/os/sim';
import { getIspSpec, getRouterSpec } from '@/features/network/sim/specs';
import type { InventorySnap, PurchaseSnap, Snapshot } from '@/worker/game/types';
import { fmtMoney } from '@/core/ui/logic';
import { isNextLevelLock, lockOf, lockTooltip, moreOffer } from '../progress/levelui';
import { filled } from './pickerBase';
import { boardId, caseId, catalogOf } from './pickerKinds';
import { warnRungs } from './ladderWarnings';
import type { LadderStep, PickerKind } from './pickerTypes';

type BuyState = 'ready' | 'poor' | 'blocked';
/** The fields every rung starts with. */
type RungHead = Pick<LadderStep, 'specId' | 'name' | 'tier'>;
type Lock = NonNullable<LadderStep['lock']>;

/** A part the player has in place: its spec, and the device id for a fitted device ('' for a world object). */
interface Owned {
  spec: string;
  devId: string;
}

/** What every rung of one ladder reads. */
interface LadderCtx {
  s: Snapshot;
  kind: PickerKind;
  installed: Owned[];
  crate: InventorySnap[];
}

function installedOf(s: Snapshot, kind: PickerKind): Owned[] {
  if (kind === 'board') {
    return [{ spec: boardId(s.boardTier), devId: '' }];
  }
  if (kind === 'case') {
    return [{ spec: caseId(s.caseTier), devId: '' }];
  }
  if (kind === 'os') {
    return s.os ? [{ spec: s.os.spec, devId: '' }] : [];
  }
  if (kind === 'router') {
    return s.net.router ? [{ spec: s.net.router.id, devId: '' }] : [];
  }
  if (kind === 'isp') {
    return s.net.isp ? [{ spec: s.net.isp.id, devId: '' }] : [];
  }
  return s.devices.filter((d) => d.kind === kind).map((d) => ({ spec: d.spec, devId: d.id }));
}

function tierOf(kind: PickerKind, id: string): number {
  if (kind === 'board') {
    return Number(id.slice(5));
  }
  if (kind === 'case') {
    return Number(id.slice(4));
  }
  return getSpec(id)?.tier ?? getOsSpec(id)?.tier ?? getRouterSpec(id)?.tier ?? getIspSpec(id)?.tier ?? -1;
}

function nameOf(kind: PickerKind, id: string): string {
  if (kind === 'board') {
    return BOARD_TIERS[Number(id.slice(5))]?.name ?? id;
  }
  if (kind === 'case') {
    return CASE_TIERS[Number(id.slice(4))]?.name ?? id;
  }
  const isp = getIspSpec(id);
  const plan = isp ? `${isp.name} plan` : undefined;
  return getSpec(id)?.name ?? getOsSpec(id)?.name ?? getRouterSpec(id)?.name ?? plan ?? id;
}

/** A tier the shop offers (no level lock, not "later"): ready, too dear, or blocked by the hardware. */
function buyRung(s: Snapshot, rung: RungHead, p: PurchaseSnap): LadderStep {
  // Sandbox: nothing is unaffordable and prices read "free".
  const can = s.sandbox || p.affordable;
  let state: BuyState = can ? 'ready' : 'poor';
  if (filled(p.blocked)) {
    state = 'blocked';
  }
  return {
    ...rung,
    state,
    price: p.price,
    free: s.sandbox || undefined,
    reason: p.blocked ?? (can ? undefined : `Need ${fmtMoney(p.price - s.money)} more`),
  };
}

/** A rung the player level still locks. */
function levelRung(s: Snapshot, rung: RungHead, offer: { p: PurchaseSnap | undefined; lock: Lock }): LadderStep {
  const { p, lock } = offer;
  return {
    ...rung,
    state: 'level',
    price: p?.price,
    free: s.sandbox || undefined,
    lock,
    soon: isNextLevelLock(lock, s.level.level),
    reason: lockTooltip(lock, { blocked: p?.blocked, priceShort: p && !s.sandbox ? p.price - s.money : 0 }),
  };
}

/** One rung: installed, a spare in the inventory, level-locked, later, or for sale. */
function rungFor(c: LadderCtx, id: string): LadderStep {
  const { s } = c;
  const rung = { specId: id, name: nameOf(c.kind, id), tier: tierOf(c.kind, id) };
  const inst = c.installed.find((x) => x.spec === id);
  const copies = c.crate.filter((x) => x.spec === id);
  const p = s.purchases.find((x) => x.id === id);
  // The player level comes first: before money, hardware and "later".
  const lock = lockOf(s, id, p);
  const spares = copies.length > 0 ? copies.length : undefined;
  const more = p && p.later !== true ? moreOffer(s, p, lock) : undefined;
  if (inst) {
    return { ...rung, state: 'installed', devId: inst.devId || undefined, spares, more };
  }
  const [inv] = copies;
  if (inv) {
    // A spare that the sim will not fit right now says why (memory minimum, free capacity, no slot); otherwise it can go in.
    const reason = inv.installable
      ? 'In your inventory: drag it onto its socket'
      : (inv.reason ?? 'Nothing to fit it to right now');
    return { ...rung, state: 'crate', invId: inv.id, reason, spares, more };
  }
  if (lock) {
    return levelRung(s, rung, { p, lock });
  }
  if (p?.later === true) {
    return { ...rung, state: 'locked', reason: p.description ?? 'Not available yet' };
  }
  return p ? buyRung(s, rung, p) : { ...rung, state: 'locked', reason: 'Not available yet' };
}

/**
 * The ladder for a kind: installed and inventory rungs, then each tier the shop sells (ready, poor, blocked, level). Every tier is
 * for sale whatever you own, and a tile you own carries a `more` offer (buy another: a spare, a downgrade, a second machine).
 */
export function ladderFor(s: Snapshot, kind: PickerKind): LadderStep[] {
  const c: LadderCtx = {
    s,
    kind,
    installed: installedOf(s, kind),
    crate: kind === 'isp' ? [] : s.inventory.filter((i) => i.kind === kind),
  };
  const out = catalogOf(kind).map((id) => rungFor(c, id));
  warnRungs(s, kind, out);
  return out;
}

/**
 * The next tier up from the fitted part: a spare you own above it (the lowest), else the lowest-tier rung above the installed tier
 * (a buy, a poor or blocked rung, or a later tier). Undefined when the fitted part is the top tier.
 * With nothing fitted (an empty socket) every rung is "up".
 */
export function nextUpgrade(ladder: LadderStep[]): LadderStep | undefined {
  const fitted = ladder.find((r) => r.state === 'installed');
  const fittedTier = fitted ? fitted.tier : -1;
  const above = ladder
    .filter((r) => r.state !== 'installed' && r.tier > fittedTier)
    .toSorted((a, b) => a.tier - b.tier);
  return above.find((r) => r.state === 'crate') ?? above[0];
}
