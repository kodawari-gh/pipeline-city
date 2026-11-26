// BUILD MY PC's network (docs/PC_PARTS.md "Build my PC mode"): the operating system, the router and the internet plan stand on the shelf beside the parts,
// so a player can try the machine on any of them, not only on the ones a start brings. The stage's game is a sandbox with the real rules: each one is the
// game's own purchase and install. What the game has no word for (an internet plan taken away) is set here. Pure TS: no DOM.
import { getIspSpec, getRouterSpec, ispByTier, routerByTier } from '@/features/network/sim';
import { getOsSpec } from '@/features/os/sim';
import type { Game } from '@/worker/game/game';
import type { Result } from '@/worker/game/types';
import type { Snapshot } from '@/worker/protocol';

/** The three network choices, in the order the shelf lists them. */
export type NetKind = 'os' | 'router' | 'isp';
export const NET_KINDS: readonly NetKind[] = ['os', 'router', 'isp'];

/** What the shelf and the machine's list call each one. */
export const NET_LABEL: Record<NetKind, string> = { os: 'Operating system', router: 'Router', isp: 'Internet plan' };

/** Which choice a catalogue id is (`os2`, `router3`, `isp1`), or null for any other id (a part, a case, a board). */
export function netKindOf(id: string): NetKind | null {
  return getRouterSpec(id) ? 'router' : getIspSpec(id) ? 'isp' : getOsSpec(id) ? 'os' : null;
}

/** The name of a network item, or the id when there is no such item. */
export const netName = (id: string): string => (getRouterSpec(id) ?? getIspSpec(id) ?? getOsSpec(id))?.name ?? id;

/** What is in place: the id of the OS, of the router and of the plan, each null when there is none. */
export type NetState = Record<NetKind, string | null>;

export function netState(g: Game): NetState {
  return {
    os: g.os?.spec.id ?? null,
    router: routerByTier(g.routerTier)?.id ?? null,
    isp: ispByTier(g.ispTier)?.id ?? null,
  };
}

/** The same, from a snapshot (the panel reads what the stage drew, not the game). */
export const netOfSnap = (s: Pick<Snapshot, 'os' | 'net'>): NetState => ({
  os: s.os?.spec ?? null,
  router: s.net.router?.id ?? null,
  isp: s.net.isp?.id ?? null,
});

/** Buy an item and fit it: the game's own `purchase` and `install` (a plan is an account purchase: it applies at once and has nothing to install). */
function put(g: Game, id: string): Result {
  const b = g.purchase(id);
  if (!b.ok || getIspSpec(id)) {
    return b.ok ? { ok: true } : b;
  }
  const r = g.install(b.invId, getRouterSpec(id) ? 'router' : undefined);
  return r.ok ? { ok: true } : r;
}

/**
 * Put this item in its place (`id`), or take what is there out (`id` null). A new router or OS replaces the old one; a new plan replaces the old plan. A router
 * that comes in is cabled at once when the cable is out (the ethernet cable has one way to go: the board's jack, or the first network card). A router that
 * leaves takes the cable's far end with it (the game does that). An OS that does not fit (no drive, too big, too little RAM) leaves the old one as it was.
 */
export function setNet(g: Game, kind: NetKind, id: string | null): Result {
  if (kind === 'isp') {
    if (id === null) {
      if (!g.ispTier) {
        return { ok: false, reason: 'no internet plan is in place' };
      }
      g.ispTier = 0;
      return { ok: true };
    }
    return put(g, id);
  }
  if (kind === 'router') {
    if (id === null) {
      const r = g.uninstall('router');
      return r.ok ? { ok: true } : r;
    }
    const r = put(g, id);
    if (r.ok && !g.cables['lan']) {
      g.connectLan(); // (a refusal here, no jack on the board and no card, is the machine's to answer: the cable waits)
    }
    return r;
  }
  const old = g.os?.spec.id ?? null;
  // (an OS left in the bag is put back on a drive when a job ends, `Game.keepOs`: that is for an OS whose drive left, not for one the player chose to take out)
  const bag = (): void => {
    g.inventory = g.inventory.filter((i) => !getOsSpec(i.spec));
  };
  if (id === null) {
    const r = g.uninstallOs();
    if (r.ok) {
      bag();
    }
    return r.ok ? { ok: true } : r;
  }
  if (old) {
    const r = g.uninstallOs();
    if (!r.ok) {
      return r;
    }
  }
  const r = put(g, id);
  if (!r.ok && old) {
    put(g, old); // (the OS that was there comes back)
  }
  bag();
  return r;
}
