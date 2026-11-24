// The numbers and words of Build my PC's HUD, pure (BuildMode.tsx and its panels draw them): can the machine boot yet, the power meter, the fitted
// parts by kind, what a tile costs, and the one line that says what to do now.
import type { Board } from '@/features/board/sim/board';
import { bootCheck, type Cables } from '@/features/board/sim/cables';
import type { Alert } from '@/features/board/sim/buildalerts';
import type { BuildPreset, Shown, SpecSheet } from '@/features/board/sim/buildspecs';
import { getSpec } from '@/features/board/sim/specs';
import type { NetSnap } from '@/worker/game/types';

export interface Readiness {
  ok: boolean;
  line: string;
}

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Would the machine start as it stands? The game's own power-on check (`bootCheck`). The cord to the wall is the stage's own business here (a
 * player cannot unplug it), so it counts as plugged. `shown`: with a bare case (no board in it) or an empty stage (no case) there is nothing
 * to start, which the game's check does not know.
 */
export function readiness(board: Board, cables: Cables, shown: Shown = 'machine'): Readiness {
  if (shown === 'nothing') return { ok: false, line: 'No case' };
  if (shown === 'case') return { ok: false, line: 'No motherboard' };
  const c = bootCheck(board, { ...cables, pcmains: true });
  if (c.noPower) return { ok: false, line: sentence(c.noPower) };
  if (c.post) return { ok: false, line: sentence(c.post.reason) };
  return { ok: true, line: 'Ready to start' };
}

// (what is wrong with the machine, as a list, is the sim's: `sim/buildalerts.ts`, worked out once per change by the stage: `BuildStage.alerts`)
export type { Alert, AlertLevel } from '@/features/board/sim/buildalerts';

export type Tone = 'none' | 'ok' | 'warn' | 'bad';

/** The pill at the top: the machine's state at a glance, in one colour and a few words. `alerts` are the list the panel shows. */
export interface Pill {
  tone: 'ok' | 'warn' | 'bad';
  label: string;
  title: string;
  alerts: readonly Alert[];
}

/**
 * What the summary's pill says of `alerts` (`BuildStage.alerts`). Green: it starts and nothing is overloaded. Amber: a part is missing, or it runs badly. Red:
 * something breaks. One problem gives its own words, several give their count. With a bare case or an empty stage the pill says what is missing.
 */
export function pillOf(alerts: readonly Alert[], shown: Shown = 'machine'): Pill {
  if (shown !== 'machine') {
    const line = shown === 'nothing' ? 'No case' : 'No motherboard';
    return { tone: 'warn', label: line, title: `${line}: there is no machine to start yet.`, alerts: [] };
  }
  if (!alerts.length)
    return {
      tone: 'ok',
      label: 'Ready to start',
      title: 'Every part the power-on test needs is fitted, and nothing is overloaded.',
      alerts,
    };
  const tone = alerts.some((a) => a.level === 'bad') ? 'bad' : 'warn';
  const one = alerts.length === 1;
  return {
    tone,
    label: one ? alerts[0]!.title : `${alerts.length} ${tone === 'bad' ? 'problems' : 'warnings'}`,
    title: one ? alerts[0]!.text : alerts.map((a) => `${a.title}: ${a.text}`).join('\n'),
    alerts,
  };
}

/** The power meter: how full the supply is at full load (in percent, held at 100 for the bar), and the colour that says so: red from the first watt over (the machine slows down). */
export function powerMeter(sheet: Pick<SpecSheet, 'headroom'>): { pct: number; tone: Tone } {
  const h = sheet.headroom;
  if (h === null) return { pct: 0, tone: 'none' };
  return { pct: Math.min(100, Math.round(h * 100)), tone: h > 1 ? 'bad' : h > 0.75 ? 'warn' : 'ok' };
}

/** The devices grouped by kind, in the order of `order` (a kind it does not list goes last); each group keeps the devices' own order. */
export function groupByKind<D extends { spec: string }>(
  devices: readonly D[],
  order: readonly string[],
): { kind: string; items: D[] }[] {
  const by = new Map<string, D[]>();
  for (const d of devices) {
    const k = getSpec(d.spec)?.kind ?? 'other';
    (by.get(k) ?? by.set(k, []).get(k)!).push(d);
  }
  const rank = (k: string): number => {
    const i = order.indexOf(k);
    return i === -1 ? order.length : i;
  };
  return [...by].map(([kind, items]) => ({ kind, items })).sort((a, b) => rank(a.kind) - rank(b.kind));
}

// (what a tile costs and how many pips a tier lights are the catalogue's: the Gallery's shelf says them the same way)
export { pips, priceOf } from '@/features/economy/ui/shop/shopdata';

/** `3 parts`, `1 drive`. */
export const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What a preset fits besides the tiered parts, in a few words (`8 RAM`, `4 drives`, `2 GPU`, `AI card`). */
export function presetBits(p: BuildPreset): string[] {
  const bits = [`${p.ram} RAM`, plural(p.storage, 'drive')];
  if (p.gpus) bits.push(`${p.gpus} GPU`);
  if (p.npus) bits.push('AI card');
  return bits;
}

/** The names with how many of each, in the order each first appears: `['fan', 'fan', 'ram']` is `fan ×2 · ram`. */
export function countNames(names: readonly string[]): string {
  const by = new Map<string, number>();
  for (const n of names) by.set(n, (by.get(n) ?? 0) + 1);
  return [...by].map(([n, c]) => (c > 1 ? `${n} ×${c}` : n)).join(' · ');
}

/** A name for a build to save that no saved build has yet (`My build 3`). */
export function freeName(taken: readonly string[], base = 'My build'): string {
  let n = taken.length + 1;
  while (taken.includes(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

/** A speed in Mbit/s, in Gbit/s from a thousand. */
export const rate = (mbps: number): string =>
  mbps >= 1000 ? `${+(mbps / 1000).toFixed(1)} Gbit/s` : `${Math.round(mbps)} Mbit/s`;

/**
 * What the machine's link says (the network rows' last line): the speed it gets and what holds it back, or what is missing (a router, a plan, an OS, the
 * cable). `tone`: amber while something is missing or the machine is off, green once the link is up.
 */
export function linkLine(n: Pick<NetSnap, 'state' | 'reason' | 'bandwidth' | 'router' | 'isp'>): {
  tone: 'ok' | 'warn';
  text: string;
} {
  // (the game's words say "buy one" and "install one next to the monitor": here the shelf has them)
  if (!n.router || !n.isp)
    return {
      tone: 'warn',
      text: `No ${!n.router && !n.isp ? 'router and no internet plan' : !n.router ? 'router' : 'internet plan'}: pick ${!n.router && !n.isp ? 'them' : 'one'} from the shelf`,
    };
  if (n.state === 'no-cable') return { tone: 'warn', text: 'The ethernet cable is not plugged in' };
  if (n.state === 'no-os') return { tone: 'warn', text: n.reason ?? 'The OS is missing' };
  const b = n.bandwidth,
    off = n.state === 'down';
  const speed = `${rate(b.downMbps)} down · ${rate(b.upMbps)} up${b.binding ? ` · held back by the ${b.binding}` : ''}`;
  return { tone: off ? 'warn' : 'ok', text: off && n.reason ? `${speed} (${n.reason})` : speed };
}

/** A group of parts of one kind shows its rows when it has this many or fewer; more fold to one line (the player's click decides after that). */
export const OPEN_UP_TO = 3;

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
  /** What stands on the stage: with a bare case only a board (or another case) can go in; with nothing, only a case. */
  shown?: Shown;
  /** For a part dragged off the shelf: it is a case or a board (the things a bare case or an empty stage takes), or `net`: an OS, a router or an internet plan (they fit the room, whatever stands on the stage). */
  shell?: 'case' | 'board' | 'net';
  /** The machine is on (it runs on the stage). */
  on?: boolean;
  /** A cable's plug is in the player's hand. */
  holding?: boolean;
}

/** The one line under the stage: what the player can do now. */
export function hintLine(h: HintState): string {
  if (h.busy) return h.step || 'Working…';
  if (h.holding) return 'Carry the plug to its socket and let go · Esc drops it';
  if (h.dragging === 'shelf' && h.shell === 'net')
    return h.over === 'stage' ? 'Let go to fit it' : 'Drag it onto the stage';
  if (h.dragging === 'shelf' && h.shown === 'nothing')
    return h.shell === 'case'
      ? h.over === 'stage'
        ? 'Let go to bring the case in'
        : 'Drag it onto the stage'
      : 'Fit a case first: every part goes in it';
  if (h.dragging === 'shelf' && h.shown === 'case')
    return h.shell
      ? h.over === 'stage'
        ? 'Let go on the case to fit it'
        : 'Drag it onto the case'
      : 'Fit a motherboard first: every other part plugs into it';
  if (h.dragging === 'shelf') return h.over === 'stage' ? 'Let go on a lit socket to fit it' : 'Drag it onto the PC';
  if (h.dragging === 'machine')
    return h.over === 'bin' ? 'Let go to take it out' : 'Drop it on the shelf to take it out';
  if (h.shown === 'nothing') return 'The stage is empty. Click a case on the shelf to bring it in.';
  if (h.shown === 'case') return 'The case is empty. Drag a motherboard from the shelf onto it.';
  if (h.fitted === 0) return 'The case is empty. Drag a part from the shelf onto the PC.';
  if (h.picked) return 'Drag it onto the shelf to take it out, or press Delete';
  if (h.on) return 'The machine is on: fitting or taking out a part switches it off first';
  if (!h.open) return 'Click the side panel to reach the parts inside';
  return 'Drag a part onto the PC, or off it onto the shelf';
}
