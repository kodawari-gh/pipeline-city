// What the machine is keyed by (machine3d.ts): what forces a rebuild, a part's key, what a patch may take, and what the cables are built from.
import { getSpec } from '@/features/board/sim/specs';
import { netPropsVisible } from '@/features/network/render/netvis';
import { own } from '@/core/render/three/materials';
import { lowDetail } from '@/core/render/three/detail';
import { fanHost } from '../../../sim/board';
import { routerTier } from '../studiowall3d';
import type { DeviceSnap, DeviceSpec, Object3D, PartState, Shown, Snapshot, Spin } from './types';

/** The parts of the key: the tier, the case and the parts where they sit, or what the stage shows instead. */
function keyBody(s: Snapshot, shown: Shown): string {
  if (shown === 'nothing') {
    return 'nothing';
  }
  if (shown === 'case') {
    return `bare|${s.caseTier}`;
  }
  return [
    s.boardTier,
    s.caseTier,
    s.devices
      .map((d) => `${d.spec}@${d.slot}`)
      .toSorted()
      .join(','),
  ].join('|');
}

/**
 * What forces a rebuild: the tier, the parts and where they sit. The cables and the key rebuild only themselves (`Machine3D.syncCables`).
 * `shown` (Build my PC's empty start): a bare case is keyed by its case tier alone; with nothing on the stage the key is the same whatever the game holds.
 */
export function machineKey(s: Snapshot | null, shown: Shown = 'machine'): string {
  if (!s) {
    return 'none';
  }
  const key = keyBody(s, shown);
  return lowDetail() ? `${key}|low` : key; // (High's key is what it was)
}

/** A device's state for its look: its power and a burn (a part that runs, runs hot or throttles looks as ever; the lenses show those). */
export function stateOf(s: Snapshot, d: DeviceSnap): PartState {
  return { powered: s.powered && !s.power.tripped, burnt: d.burnt };
}

/** Fill `list` in place with `items` (the public lists keep their identity). */
export const refill = <T>(list: T[], items: readonly T[]): void => {
  list.length = 0;
  for (const x of items) {
    list.push(x);
  }
};
/** Mark a spin's rotor as one that turns, and give its ring its own material (its glow is its own). */
export const markSpin = (s: Spin): void => {
  s.rotor.userData['spin'] = true;
  if (s.ring) {
    own(s.ring);
  }
};

export const keyOf = (d: { spec: string; slot: string }): string => `${d.spec}@${d.slot}`;
/** The kinds a patch always may add or take away (`patchable`). */
const PATCH_ALWAYS: ReadonlySet<string> = new Set([
  'ram',
  'gpu',
  'npu',
  'nic',
  'cpu',
  'vrm-sink',
  'ram-sink',
  'storage',
]);
/**
 * The parts a patch may add or take away: a stick, an M.2 or SATA drive, a card, the CPU, an air cooler, a VRM or memory heat sink, and a fan on one of those
 * (the host is built again with it). Not a liquid loop's pump (the hoses join it), a radiator, a case fan, a PSU, a cable or a case or board.
 */
export const patchable = (d: DeviceSnap): boolean => {
  const spec = getSpec(d.spec) as { visual?: string; loop?: unknown } | undefined;
  if (PATCH_ALWAYS.has(d.kind)) {
    return true;
  }
  if (d.kind === 'cooler') {
    return spec?.loop === undefined;
  }
  if (d.kind === 'fan') {
    return fanHost(d.slot) !== null;
  }
  return false;
};
/** A part a patch took away answers to no id (`findById`, a pick, the outline): its host, built again, keeps the same id. */
export const untag = (root: Object3D): void => {
  root.traverse((o) => {
    if (typeof o.userData['id'] === 'string') {
      delete o.userData['id'];
    }
  });
};

/** What the video and LAN cables' PC ends depend on: the port each is in and the cards and display that offer ports (they are built again when these change). */
export const netVisible = (s: Snapshot): boolean =>
  netPropsVisible({
    level: s.level.level,
    hasRouter: Boolean(s.net?.router),
    hasIsp: Boolean(s.net?.isp),
    routerInInventory: s.inventory.some((i) => i.kind === 'router'),
    lanConnected: s.cables.find((c) => c.id === 'lan')?.connected === true,
  });
/**
 * The cables that stand: the sim lists a cable with the part it runs from fitted (or while it is plugged); `blocked` says that part is missing. A
 * cable never stands without its part: no PSU, no leads and no PC cord; no monitor, no video cable and no monitor cord.
 */
export const standing = (s: Snapshot): Snapshot['cables'] =>
  s.cables.filter((c) => c.connected || (c.blocked ?? '') === '');
/** What the cables are built from: the net's lens, the router's tier (another tier has other ports, so the LAN lead's router end is another plug, in the room as on the stage, where its body is also a box the cords keep off), the ports the leads are in, the cards and display that offer them. */
export const videoKey = (s: Snapshot): string =>
  `${netVisible(s)}|${routerTier(s.net?.router?.id) ?? ''}|${s.videoPort}|${s.net?.port.kind}${s.net?.port.deviceId ?? ''}|${s.devices
    .filter((d) => d.kind === 'gpu' || d.kind === 'display' || d.kind === 'nic')
    .map((d) => `${d.id}@${d.slot}${d.burnt ? 'x' : ''}`)
    .join(',')}`;

/** Run a build to its end (the constructor, `setCables`: no page turn between its steps). */
export function drain(run: Generator<void>): void {
  let step = run.next();
  while (step.done !== true) {
    step = run.next();
  }
}

/** The `i`th item of a list the build made as long as it needs. */
export const nth = <T>(list: readonly T[], i: number): T => {
  const x = list[i];
  if (x === undefined) {
    throw new Error(`no item ${i} of ${list.length}`);
  }
  return x;
};

/** A device's spec (the sim lists only devices of known specs). */
export const specOf = (id: string): DeviceSpec => {
  const spec = getSpec(id);
  if (!spec) {
    throw new Error(`no spec ${id}`);
  }
  return spec;
};

/** A spec's look, `''` with none (`visual`). */
export const visualOf = (id: string): string => (getSpec(id) as { visual?: string } | undefined)?.visual ?? '';
