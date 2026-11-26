// What Build my PC's stage offers and asks outside the stage itself: the bin, a part's motion, a shell the game would refuse, a kept snapshot.
import { fanHost, fittedRadiator, upgradeCase } from '@/features/board/sim/board';
import { upgradeBoard } from '@/features/board/sim/boardEdit';
import { isPump } from '@/features/board/sim/removal';
import { BOARD_TIERS, CASE_TIERS, specsOfKind } from '@/features/board/sim/specs';
import { ISP_SPECS, ROUTER_SPECS } from '@/features/network/sim';
import { OS_SPECS } from '@/features/os/sim';
import type { Snapshot } from '@/worker/protocol';
import type { Game } from '@/worker/game/game';
import type { CueId } from '@/app/audio/mixTokens';
import type { BinPart, Board, Held, Step } from './types';

/** The motion of a part in this slot: a fan on a case mount comes off its own wall first (the mount's id starts with its side), a heatsink's fan lifts off it;
 *  a SATA drive comes out on its cage's tray (`tray`), an M.2 stick off its socket, a loop's pump head twists free (`pump`). */
export function motionOf(kind: string, slot: string, board?: Board): string {
  if (kind === 'fan' && /^(?:vrm|ram)-sink/u.test(fanHost(slot) ?? '')) {
    return 'fan-sink';
  }
  if (kind === 'fan' && (fanHost(slot) ?? '') === '') {
    return board && fittedRadiator(board)?.mounts.includes(slot) === true
      ? 'fan-rad'
      : `fan-${slot.replace(/\d+$/u, '')}`;
  }
  if (kind === 'storage' && slot.startsWith('sata')) {
    return 'tray';
  }
  if (kind === 'cooler' && board?.devices.some((d) => d.slot === slot && isPump(d)) === true) {
    return 'pump';
  }
  return kind;
}

/** A game's snapshot, kept until the game changes (PERF19): `game.snapshot()` builds the inventory and copies the board through JSON, about 8 % of
 *  an idle phone frame when each frame asked for it. Call `drop` after every change to the game; another game object starts over by itself. */
export class SnapCache {
  private game: Game | null = null;
  private snap: Snapshot | null = null;
  of(game: Game): Snapshot {
    if (game !== this.game || !this.snap) {
      this.game = game;
      this.snap = game.snapshot();
    }
    return this.snap;
  }
  /** (the game goes too: a closed stage keeps no game through its cache) */
  drop(): void {
    this.snap = null;
    this.game = null;
  }
}

/** The bin: every case, board and part kind that has a 3D model in the machine. */
export function binParts(): BinPart[] {
  const out: BinPart[] = CASE_TIERS.map((c) => ({ id: `case${c.tier}`, name: c.name, kind: 'case', tier: c.tier }));
  for (const b of BOARD_TIERS) {
    out.push({ id: `board${b.tier}`, name: `${b.name} board`, kind: 'board', tier: b.tier });
  }
  for (const k of [
    'cpu',
    'cooler',
    'radiator',
    'fan',
    'ram',
    'vrm-sink',
    'ram-sink',
    'storage',
    'gpu',
    'npu',
    'nic',
    'tpm',
    'psu',
  ] as const) {
    for (const s of specsOfKind(k)) {
      out.push({ id: s.id, name: s.name, kind: k, tier: s.tier });
    }
  }
  // (the network: an OS goes on a drive, a router stands by the wall, a plan comes in by the wall jack; an OS the game lists as later is not for sale)
  for (const s of OS_SPECS) {
    if (s.later !== true) {
      out.push({ id: s.id, name: s.name, kind: 'os', tier: s.tier });
    }
  }
  for (const s of ROUTER_SPECS) {
    out.push({ id: s.id, name: s.name, kind: 'router', tier: s.tier });
  }
  for (const s of ISP_SPECS) {
    out.push({ id: s.id, name: s.name, kind: 'isp', tier: s.tier });
  }
  return out;
}

/**
 * Why the game would refuse a new case or board (`itemId`: "case2", "board1"), asked of a copy of the machine with its parts out (a swap takes them out
 * first, so what they need does not count); null when it takes it. Asked before anything moves: a swap the game refuses must not lift a case off for nothing.
 */
export function shellRefusal(board: Board, itemId: string): string | null {
  const copy: Board = { ...board, devices: [] },
    tier = Number(itemId.slice(-1));
  const r = itemId.startsWith('case') ? upgradeCase(copy, tier) : upgradeBoard(copy, tier);
  return r.ok ? null : r.reason;
}

/** A held part goes back under the id the game gave it, at its place, shown. */
export function refit(kept: Held, id: string): void {
  kept.obj.traverse((o) => {
    const i: unknown = o.userData['id'];
    if (typeof i === 'string' && (i === kept.id || i.startsWith(`${kept.id}.`))) {
      o.userData['id'] = id + i.slice(kept.id.length);
    }
  });
  kept.obj.position.copy(kept.p);
  kept.obj.rotation.z = kept.z;
  kept.obj.rotation.y = kept.y;
  kept.obj.visible = true;
}

/** The cue of a step the player made (ticket #66): a part or an OS, router or plan in is an install; out, an uninstall. A new machine has none. */
export function stepCue(s: Step): CueId | null {
  if (s.t === 'fit') {
    return 'install';
  }
  if (s.t === 'remove') {
    return 'uninstall';
  }
  if (s.t === 'net') {
    return s.to !== null && s.to !== '' ? 'install' : 'uninstall';
  }
  return null;
}
