// What is wrong with a Build my PC machine as it stands, as one list. Build my PC fits any part that fits its socket (`GameOptions.looseFit`), so a supply too
// small, a card with no lead or a hot CPU is not refused: the machine answers as it would in real life, and this list says so in words. It reads the game's own
// rules, no new ones: `checkCompat` for what the part tables say (the supply, the leads, the regulators), `bootCheck` for what stops the power-on test, and a dry
// run of the thermal model for the heat (the machine itself is not run on the stage). The pill at the top, the list in the right panel, the marks on the part
// rows (`ui/buildhud.ts`: `pillOf`) and the stage's amber line after a change (`BuildStage.caution`) all read it.
import { Prng } from '@/core/sim';
import { deviceSpec, type Board } from './board';
import { bootCheck, type Cables } from './cables';
import { checkCompat, type CompatIssue } from './compat';
import type { Shown } from './buildspecs';
import { BOARD_TIERS, type DeviceKind } from './specs';
import { ThermalModel, type FanPower, type Loads } from './thermal';

/** `bad`: it breaks or will not run (the supply trips, a card has no power lead, a part burns). `warn`: it runs badly or is not finished (it slows down, it crashes now and then, a part is missing). */
export type AlertLevel = 'bad' | 'warn';

export interface Alert {
  /** The compat issue's id (`psu-brownout`...), `boot` for what stops the power-on test, or `hot-throttle`, `hot-errors`, `hot-burn` for heat. */
  id: string;
  level: AlertLevel;
  /** A few words: what happens. */
  title: string;
  /** The sentence that says why, and what the machine will do. */
  text: string;
  /** The device it is about (a click picks it, the pointer outlines it); null for the machine as a whole. */
  part: string | null;
}

const sentence = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The words of each compat issue in the pill and the list (an id with no entry gets its message's first words). */
const TITLES: Record<string, string | ((i: CompatIssue) => string)> = {
  'psu-trip': 'Supply trips',
  'psu-brownout': 'Supply too small',
  'pcie-leads': 'Card has no power lead',
  'vrm-burn': 'Board will burn out',
  'vrm-overload': 'Board crashes under load',
  'ram-vrm-burn': 'Memory will burn the board',
  'ram-vrm-overload': 'Memory crashes the machine',
  'cpu-cooling': (i) => (i.severity === 'error' ? 'CPU gets too hot' : 'CPU throttles'),
};

// ---------------------------------------------------------------------------------------------------------------------------------- heat
/** A drive and a network card work in bursts: they are warm while they work, and a machine that does a long job holds them near idle (the game's `idleLoad`). */
const BURST_LOAD = 0.1;
/** The machine busy: the processor, the memory, the monitor and the cards flat out. */
const BUSY: Loads = { cpu: 1, ram: 1, display: 1, gpu: 1, npu: 1, storage: BURST_LOAD, nic: BURST_LOAD };
/** Ticks of the dry run: every part has settled (or burnt) by about 400. */
const SETTLE_TICKS = 500;
/** What a part is called in a title (the spec's own name is long: "Tiny-OoO (out-of-order, ROB 8)"). The benchmark names a part the same way. */
export const KIND_NAME: Partial<Record<DeviceKind, string>> = {
  cpu: 'CPU',
  gpu: 'GPU',
  npu: 'AI card',
  ram: 'Memory',
  storage: 'Drive',
  nic: 'Network card',
  tpm: 'Security chip',
};

/**
 * What the heat does to the machine working flat out (`BUSY`), from the game's own thermal model run on a copy of the board (the run burns parts; the real ones
 * stay as they are) with the fans that turn (`fans`: `Game.fanPower`). The static check of the CPU's cooling (`checkCompat`) leaves the case fans out and so
 * calls a machine too hot that they keep cool; the model does not. A part past its throttle point runs slower, past its error point it makes errors, past its
 * damage point for long enough it burns. The board's regulators the same. A machine with no working supply does not run, and has no heat to judge.
 */
export function heatAlerts(board: Board, fans: FanPower, skip: ReadonlySet<string> = new Set()): Alert[] {
  const copy = structuredClone(board),
    th = new ThermalModel(new Prng(1)),
    out: Alert[] = [];
  // (the temperature a part reached, not the one it cooled down to: a burnt part stops drawing and cools)
  const peak = new Map<string, number>();
  for (let i = 0; i < SETTLE_TICKS; i++) {
    th.step(copy, BUSY, true, fans);
    for (const d of copy.devices) {
      const t = th.state(d.id)?.tempC ?? 0;
      if (t > (peak.get(d.id) ?? 0)) peak.set(d.id, t);
    }
  }
  if (th.power.off) return out;
  for (const d of copy.devices) {
    const spec = deviceSpec(d),
      st = th.state(d.id),
      t = peak.get(d.id) ?? st?.tempC ?? 0,
      name = KIND_NAME[spec.kind];
    if (!name || !st || spec.thermal.throttleC >= 900) continue;
    const near = `${Math.round(t)} C`;
    if (d.burnt)
      out.push({
        id: 'hot-burn',
        level: 'bad',
        title: `${name} burns out`,
        part: d.id,
        text: `${spec.name} reaches ${near} at full load, past its damage point (${spec.thermal.damageC} C): it burns out. It needs more cooling.`,
      });
    else if (st.unstable)
      out.push({
        id: 'hot-errors',
        level: 'bad',
        title: `${name} makes errors`,
        part: d.id,
        text: `${spec.name} settles near ${near} at full load, past ${spec.thermal.unstableC} C where it makes errors${spec.kind === 'cpu' ? ': the machine crashes at random' : ''}. It needs more cooling.`,
      });
    else if (st.throttle < 0.995)
      out.push({
        id: 'hot-throttle',
        level: 'warn',
        title: `${name} throttles`,
        part: d.id,
        text: `${spec.name} settles near ${near} at full load, past its throttle point (${spec.thermal.throttleC} C): it runs at ${Math.round(st.throttle * 100)}% of its speed. ${spec.kind === 'cpu' ? 'A better cooler or more case fans cool it.' : 'More case fans cool it.'}`,
      });
  }
  // the regulators (heat only: what they are asked for is the part tables' business, `vrm-overload` and `vrm-burn`)
  if (copy.burnt) {
    // (a board the part tables already say will burn is said once, by that issue)
    if (!skip.has('vrm-burn') && !skip.has('ram-vrm-burn'))
      out.push({
        id: 'board-hot-burn',
        level: 'bad',
        title: 'Board burns out',
        part: null,
        text: "The board's voltage regulators burn out at full load. They need more cooling, or a lighter load.",
      });
  } else {
    const board0 = BOARD_TIERS[board.tier]!;
    for (const [v, spec, what, own] of [
      [th.vrm, board0.vrm, "the board's voltage regulator", 'vrm'],
      [th.ramVrm, board0.ramVrm, "the memory's regulator", 'ram-vrm'],
    ] as const) {
      const near = `${Math.round(v.tempC)} C`;
      if (v.unstable && v.tempC > spec.unstableC)
        out.push({
          id: `${own}-hot-errors`,
          level: 'bad',
          title: 'Board regulator too hot',
          part: null,
          text: `${sentence(what)} settles near ${near} at full load, past ${spec.unstableC} C: the machine crashes at random. A fan on its fins cools it.`,
        });
      else if (v.throttle < 0.995)
        out.push({
          id: `${own}-hot-throttle`,
          level: 'warn',
          title: 'Board regulator throttles',
          part: null,
          text: `${sentence(what)} settles near ${near} at full load, past its throttle point (${spec.throttleC} C): the processor runs at ${Math.round(v.throttle * 100)}% of its speed. A fan on its fins cools it.`,
        });
    }
  }
  return out.sort((a, b) => Number(b.level === 'bad') - Number(a.level === 'bad'));
}

/**
 * Everything wrong with the machine as it stands: the compat issues that break it or make it run badly (`checkCompat`, errors and warnings; the tips are the game's
 * advice, not Build my PC's), what stops the power-on test (`bootCheck`) and, when the fans are given, the heat (`heatAlerts`, which stands in for the static
 * cooling check), as one list: the breaking ones first, then the missing part, then the rest. The cord to the wall counts as plugged (a player cannot unplug it
 * here). With a bare case or an empty stage there is no machine to judge.
 */
export function buildAlerts(board: Board, cables: Cables, shown: Shown = 'machine', fans?: FanPower): Alert[] {
  if (shown !== 'machine') return [];
  const issues = checkCompat(board).filter(
    (i) => i.severity !== 'tip' && i.id !== 'psu-missing' && !(fans && i.id === 'cpu-cooling'),
  );
  const of = (i: CompatIssue): Alert => {
    const t = TITLES[i.id];
    return {
      id: i.id,
      level: i.severity === 'error' ? 'bad' : 'warn',
      title: typeof t === 'function' ? t(i) : (t ?? sentence(i.message.split(/[.:]/)[0] ?? i.id)),
      text: i.message,
      part: i.part,
    };
  };
  const c = bootCheck(board, { ...cables, pcmains: true });
  const why = c.noPower ?? c.post?.reason ?? null;
  // (a card with no lead is said once, by the issue that names the supply)
  const said = !c.noPower && c.post?.short === 'GPU power cable' && issues.some((i) => i.id === 'pcie-leads');
  const boot: Alert[] =
    why && !said
      ? [
          {
            id: 'boot',
            level: 'warn',
            title: sentence(why).split(':')[0]!,
            text: `${sentence(why)}. The machine does not start until it is fixed.`,
            part: null,
          },
        ]
      : [];
  const heat = fans ? heatAlerts(board, fans, new Set(issues.map((i) => i.id))) : [];
  const all = [...issues.map(of), ...heat];
  return [...all.filter((a) => a.level === 'bad'), ...boot, ...all.filter((a) => a.level === 'warn')];
}

// ---------------------------------------------------------------------------------------------------------------------------------- news
/**
 * Alerts that are one problem in two degrees: a supply that trips and one that only sags are both a supply too small, a part that throttles, makes errors or
 * burns is too hot. The alert's level is the degree (`warn` runs badly, `bad` breaks). An id with no entry is a problem of its own.
 */
const FAMILY: Record<string, string> = {
  'psu-trip': 'psu',
  'psu-brownout': 'psu',
  'vrm-burn': 'vrm',
  'vrm-overload': 'vrm',
  'ram-vrm-burn': 'ram-vrm',
  'ram-vrm-overload': 'ram-vrm',
  'hot-throttle': 'hot',
  'hot-errors': 'hot',
  'hot-burn': 'hot',
  'vrm-hot-errors': 'vrm-hot',
  'vrm-hot-throttle': 'vrm-hot',
  'board-hot-burn': 'vrm-hot',
  'ram-vrm-hot-errors': 'ram-vrm-hot',
  'ram-vrm-hot-throttle': 'ram-vrm-hot',
};
const RANK: Record<AlertLevel, number> = { warn: 1, bad: 2 };

/**
 * What an alert is, apart from how bad it is and which device it names: its family and the part's spec. A part that came out and went back in has a new id,
 * and its problem is the same one, so a change that only moved parts about is not news (`newAlerts`).
 */
export const alertKey = (a: Alert, board: Board): string =>
  `${FAMILY[a.id] ?? a.id}:${board.devices.find((d) => d.id === a.part)?.spec ?? ''}`;

/**
 * The problems a machine has, each by its key (`alertKey`) with how bad the worst of it is (1 runs badly, 2 breaks). The power-on test (`boot`) is left out: a
 * part still missing is the build in progress, not a problem a change made.
 */
export function standing(list: readonly Alert[], board: Board): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of list)
    if (a.id !== 'boot') {
      const k = alertKey(a, board);
      out.set(k, Math.max(out.get(k) ?? 0, RANK[a.level]));
    }
  return out;
}

/**
 * The alerts of a machine that are news against what it had (`standing`): a problem it did not have, or has in a worse degree (a sag that became a trip). One
 * that stayed, or only eased (a trip that became a sag), is not news: the pill and the list still say it, the hint line does not say it twice. Worst first.
 */
export function newAlerts(list: readonly Alert[], board: Board, had: ReadonlyMap<string, number>): Alert[] {
  return list
    .filter((a) => a.id !== 'boot' && RANK[a.level] > (had.get(alertKey(a, board)) ?? 0))
    .sort((a, b) => RANK[b.level] - RANK[a.level]);
}
