// The machines Build my PC starts from, as games: Empty (nothing on the stage), the ready-made machines (`BUILD_PRESETS`), the full rig and a saved layout.
// The stage plays them at once (`BuildStage.clear`, `buildPreset`, `reset`, `loadLayout`). The same builds give the baked pictures of the Start list
// (`tools/buildstills.mjs`) and the test that says when one is stale (`buildstills.test.ts`: `recipeOf` hashes what a build holds).
import type { Game } from '@/worker/game/game';
import { deviceSpec, freeSlots } from './board';
import { cableNeeded, cablesOf, cableBlocked } from './cables';
import { BOARD_TIERS, CASE_TIERS, getSpec, specsOfKind, type DeviceKind } from './specs';
import { BUILD_PRESETS, type BuildLayout, type BuildPreset, type Shown } from './buildspecs';

/** The cables that run outside the case (a player does not plug these by hand: the stage counts them plugged). */
export const OUTSIDE = new Set(['video', 'lan', 'pcmains', 'monmains']);

/** The key of a ready-made machine in the Start list and in the baked pictures: its name in lower case. */
export const presetKey = (p: BuildPreset): string => p.name.toLowerCase();

/** The keys of every start, in the Start list's order: Empty, the ready-made machines, the full rig. */
export const START_KEYS: readonly string[] = ['empty', ...BUILD_PRESETS.map(presetKey), 'full'];

/** The starts that have a baked picture: all but Empty (it puts nothing on the stage, so there is nothing to take a picture of). */
export const PICTURE_KEYS: readonly string[] = START_KEYS.filter((k) => k !== 'empty');

/** A new sandbox game with its case empty (a new game's case holds two starter fans: no start wants them). */
async function fresh(): Promise<Game> {
  const { Game } = await import('@/worker/game/game');
  const g = new Game({ seed: 1, sandbox: true, preassembled: false });
  for (const d of g.snapshot().devices) if (d.kind === 'fan') g.uninstall(d.id);
  return g;
}

/** Buy a part and fit it (in `slot` when given): did it go in? */
const put = (g: Game, id: string | null, slot?: string): boolean => {
  if (!id) return false;
  const b = g.purchase(id);
  return b.ok && g.install(b.invId, slot).ok;
};

/** The OS on the first drive, a router and an ISP plan with the LAN cable (what the benchmark's jobs need). Each is skipped when its tier is 0 or it does not fit. */
function addSoftware(g: Game, s: { os: number; router: number; isp: number }): void {
  if (s.os && g.board.devices.some((d) => deviceSpec(d).kind === 'storage')) put(g, `os${s.os}`);
  if (s.router) put(g, `router${s.router}`);
  if (s.isp) g.purchase(`isp${s.isp}`);
  if (s.router && s.isp) g.connectLan();
}

/** Plug every cable the machine needs (the ones outside the case too): a finished machine, as a player leaves it. */
export function plugCables(g: Game): void {
  for (const c of cablesOf(g.board)) if (!OUTSIDE.has(c.id) && cableNeeded(g.board, c.id) && !cableBlocked(g.board, c.id)) g.connectCable(c.id);
  for (const c of OUTSIDE) if (cableNeeded(g.board, c as never)) g.connectCable(c);
}

/**
 * A game with the case of this tier and nothing in it. The game always holds a case and a board: the stage holds them aside while it shows a bare case or
 * nothing (`BuildStage.shown`).
 */
export async function bareGame(caseTier = 0): Promise<Game> {
  const g = await fresh();
  if (caseTier !== g.board.caseTier) { const b = g.purchase(`case${caseTier}`); if (b.ok) g.install(b.invId); }
  return g;
}

/** The biggest rig, as a new sandbox starts: every part the case holds. */
export async function fullGame(): Promise<Game> {
  const { Game } = await import('@/worker/game/game');
  return new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
}

/**
 * A ready-made machine: `level` 0..1 picks how high a tier of each part; `ram`, `storage`, `gpus` and `npus` how many of each to fit. Parts that fit
 * nowhere are skipped. Its cables are plugged.
 */
export async function presetGame(p: BuildPreset): Promise<Game> {
  const g = await fresh();
  const pick = (kind: DeviceKind): string | null => {
    // (a RAID module holds data only: no OS boots from it, so the benchmark's jobs could not run)
    const all = [...specsOfKind(kind as never)].filter((s) => !(s as { mirror?: boolean }).mirror).sort((a, b) => a.tier - b.tier || a.price - b.price);
    // (a drive rounds up: the slowest drives make every job wait on the disk)
    const at = p.level * (all.length - 1);
    return all.length ? all[Math.min(all.length - 1, kind === 'storage' ? Math.ceil(at) : Math.round(at))]!.id : null;
  };
  const shell = (list: readonly { tier: number }[]) => Math.round(p.level * (list.length - 1));
  put(g, `case${shell(CASE_TIERS)}`);
  put(g, `board${shell(BOARD_TIERS)}`);
  const fill = (kind: DeviceKind, n: number): void => {
    const id = pick(kind), spec = id ? getSpec(id) : undefined;
    for (let i = 0; spec && i < n; i++) { const free = freeSlots(g.board, spec.slot, spec)[0]; if (!free || !put(g, id, free.id)) break; }
  };
  fill('psu', 1); fill('cpu', 1); fill('cooler', 1); fill('ram', p.ram); fill('storage', p.storage); fill('gpu', p.gpus); fill('npu', p.npus);
  fill('nic', 1); fill('display', 1);
  // fans come in sizes (a heatsink takes 40 mm, a case mount its own): from the chosen tier down, each spec goes in every spot that takes it
  const fans = [...specsOfKind('fan')].sort((a, b) => a.tier - b.tier || a.price - b.price);
  for (const f of fans.slice(0, 1 + Math.round(p.level * (fans.length - 1))).reverse()) {
    for (let i = 0; i < 40; i++) { const free = freeSlots(g.board, f.slot, f)[0]; if (!free || !put(g, f.id, free.id)) break; }
  }
  const t = (n: number) => Math.min(n, 1 + Math.round(p.level * (n - 1)));
  addSoftware(g, { os: t(3), router: t(4), isp: t(5) });
  plugCables(g);
  return g;
}

/** A saved layout built again. Parts that no longer fit are skipped. Its cables are plugged. */
export async function layoutGame(l: BuildLayout): Promise<Game> {
  const g = await fresh();
  put(g, `case${l.caseTier}`);
  put(g, `board${l.boardTier}`);
  for (const p of l.parts) put(g, p.spec, p.slot);
  addSoftware(g, { os: l.os ?? 0, router: l.router ?? 0, isp: l.isp ?? 0 });
  plugCables(g);
  return g;
}

/** The game of a start by its key (`START_KEYS`), and what stands on the stage for it: Empty is nothing, every other start is a whole machine. */
export async function startGame(key: string): Promise<{ game: Game; shown: Shown }> {
  if (key === 'empty') return { game: await bareGame(), shown: 'nothing' };
  if (key === 'full') return { game: await fullGame(), shown: 'machine' };
  const p = BUILD_PRESETS.find((x) => presetKey(x) === key);
  if (!p) throw new Error(`There is no start named "${key}"`);
  return { game: await presetGame(p), shown: 'machine' };
}

/**
 * What a machine holds, as eight hex digits: what stands on the stage, the case and board tier, each part with its socket, the OS, router and ISP plan.
 * A baked picture records the recipe it was taken from; one that no longer matches is stale (`buildstills.test.ts`).
 */
export function recipeOf(g: Game, shown: Shown = 'machine'): string {
  const parts = g.board.devices.map((d) => `${d.spec}@${d.slot}`).sort().join(',');
  const key = [shown, g.board.caseTier, g.board.tier, parts, g.snapshot().os?.tier ?? 0, g.routerTier, g.ispTier].join('|');
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return (h >>> 0).toString(16).padStart(8, '0');
}
