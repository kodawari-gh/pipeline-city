// The numbers and words of Build my PC's HUD, pure (BuildMode.tsx and its panels draw them): can the machine boot yet, the power meter, the fitted
// parts by kind, what a tile costs, and the one line that says what to do now.
import type { Board } from '@/features/board/sim/board';
import { bootCheck, type Cables } from '@/features/board/sim/cables';
import type { SpecSheet } from '@/features/board/sim/buildspecs';
import { BOARD_TIERS, CASE_TIERS, getSpec } from '@/features/board/sim/specs';

export interface Readiness { ok: boolean; line: string }

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Would the machine start as it stands? The game's own power-on check (`bootCheck`). The cord to the wall is the stage's own business here (a
 * player cannot unplug it), so it counts as plugged.
 */
export function readiness(board: Board, cables: Cables): Readiness {
  const c = bootCheck(board, { ...cables, pcmains: true });
  if (c.noPower) return { ok: false, line: sentence(c.noPower) };
  if (c.post) return { ok: false, line: sentence(c.post.reason) };
  return { ok: true, line: 'Ready to start' };
}

export type Tone = 'none' | 'ok' | 'warn' | 'bad';

/** The power meter: how full the supply is at full load (in percent, held at 100 for the bar), and the colour that says so. */
export function powerMeter(sheet: Pick<SpecSheet, 'headroom'>): { pct: number; tone: Tone } {
  const h = sheet.headroom;
  if (h === null) return { pct: 0, tone: 'none' };
  return { pct: Math.min(100, Math.round(h * 100)), tone: h > 1 ? 'bad' : h > 0.75 ? 'warn' : 'ok' };
}

/** The devices grouped by kind, in the order of `order` (a kind it does not list goes last); each group keeps the devices' own order. */
export function groupByKind<D extends { spec: string }>(devices: readonly D[], order: readonly string[]): { kind: string; items: D[] }[] {
  const by = new Map<string, D[]>();
  for (const d of devices) {
    const k = getSpec(d.spec)?.kind ?? 'other';
    (by.get(k) ?? by.set(k, []).get(k)!).push(d);
  }
  const rank = (k: string): number => { const i = order.indexOf(k); return i < 0 ? order.length : i; };
  return [...by].map(([kind, items]) => ({ kind, items })).sort((a, b) => rank(a.kind) - rank(b.kind));
}

/** The list price of a catalogue item (a part, a board tier or a case tier), or null for an id it does not know. */
export function priceOf(item: string): number | null {
  const shell = /^(board|case)(\d+)$/.exec(item);
  if (shell) return (shell[1] === 'board' ? BOARD_TIERS : CASE_TIERS)[Number(shell[2])]?.price ?? null;
  return getSpec(item)?.price ?? null;
}

/** How many of `n` pips a tier lights: at least one, all of them at the kind's top tier. */
export function pips(tier: number, top: number, n = 5): number {
  if (top <= 0) return n;
  return Math.max(1, Math.min(n, Math.round((tier / top) * n)));
}

export interface HintState {
  busy: boolean;
  /** The words for this moment of the animation. */
  step: string;
  /** A drag in the air: from the shelf or out of the machine, and what is under the pointer. */
  dragging: 'shelf' | 'machine' | null;
  over: 'stage' | 'bin' | null;
  /** A part is picked. */
  picked: boolean;
  /** The side panel is open. */
  open: boolean;
  fitted: number;
}

/** The one line under the stage: what the player can do now. */
export function hintLine(h: HintState): string {
  if (h.busy) return h.step || 'Working…';
  if (h.dragging === 'shelf') return h.over === 'stage' ? 'Let go on a lit socket to fit it' : 'Drag it onto the PC';
  if (h.dragging === 'machine') return h.over === 'bin' ? 'Let go to take it out' : 'Drop it on the shelf to take it out';
  if (h.fitted === 0) return 'The case is empty. Drag a part from the shelf onto the PC.';
  if (h.picked) return 'Drag it onto the shelf to take it out, or press Delete';
  if (!h.open) return 'Click the side panel to reach the parts inside';
  return 'Drag a part onto the PC, or off it onto the shelf';
}
