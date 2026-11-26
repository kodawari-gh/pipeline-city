import { describe, expect, it } from 'vitest';
import { BOARD_TIERS, getSpec } from '../sim/specs';
import type { InventorySnap, PurchaseSnap, SlotSnap } from '@/worker/game/game';
import { describeId, statusChip, VRM_IDS } from '@/core/ui/logic';
import { compareRows, ladderFor, pickerFor, statsOf } from '../../economy/ui/shop/picker';
import { boardSnap, dev, EMPTY_SLOTS, PURCHASES, snap } from '@/core/ui/testdata';
import {
  boardCards,
  cpuVrmWarning,
  LIQUID_VRM_NOTE,
  liquidVrmNote,
  plannedBoardTier,
  vrmLines,
  vrmReadout,
  vrmZone,
} from './vrm';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The kind of a shop row, read off its id the way the fixtures name them. */
function kindOf(id: string): PurchaseSnap['kind'] {
  if (id.startsWith('board')) {
    return 'board';
  }
  if (id.startsWith('vsink')) {
    return 'vrm-sink';
  }
  return 'cooler';
}

const buy = (id: string, price: number, o: Partial<PurchaseSnap> = {}): PurchaseSnap => ({
  id,
  name: id,
  kind: kindOf(id),
  price,
  affordable: false,
  ...o,
});
const BOARDS: PurchaseSnap[] = [
  buy('board1', 150),
  buy('board2', 300, { blocked: 'powered off required: power the machine off to swap the board' }),
];
const SINKS: PurchaseSnap[] = [buy('vsink0', 30), buy('vsink1', 70), buy('vsink2', 140)];
const SINK_SLOT: SlotSnap = { id: 'vrm-sink0', type: 'vrm-sink', deviceId: null };
const boardItem = (id: string): InventorySnap => ({
  id: 'inv9',
  spec: id,
  kind: 'board',
  name: 'board',
  freeSlots: ['board'],
  swapSlots: [],
  installable: false,
});
/** A board whose regulator burnt out. */
const deadBoard = () => boardSnap({ burnt: true, vrm: { burnt: true } });
/** The VRM readout of a snapshot with `board`, which must have one. */
const readoutOf = (board: ReturnType<typeof boardSnap>) => must(vrmReadout(snap({ board })));
/** Whether any of `lines` is at `level` and has `text` in it. */
const hasLine = (lines: readonly { level: string; text: string }[], level: string, text: string) =>
  lines.some((l) => l.level === level && l.text.includes(text));
/** How many slots of `key` a board card lists (none when it lists no such slot). */
const slotsOf = (c: { slots: { key: string; count: number }[] }, key: string) =>
  c.slots.find((x) => x.key === key)?.count ?? 0;
/** A snapshot with the empty VRM heatsink slot and the heatsinks in the shop. */
const sinkSnap = (o: Parameters<typeof snap>[0] = {}) =>
  snap({
    slots: [...EMPTY_SLOTS, SINK_SLOT],
    purchases: [...PURCHASES, ...SINKS],
    ...o,
  });
/** The description of `id`, which must have one. */
const described = (id: string, s?: ReturnType<typeof snap>) => must(describeId(id, s));

describe('VRM zones and readout', () => {
  it('safe under 60 percent, busy to the rating, overload past it', () => {
    expect(vrmZone(0.5)).toBe('safe');
    expect(vrmZone(0.6)).toBe('busy');
    expect(vrmZone(1)).toBe('busy');
    expect(vrmZone(1.2)).toBe('overload');
  });

  it('reads demand, rating, zone, efficiency and loss from the snapshot', () => {
    const s = snap({
      board: boardSnap({ vrm: { loadRatio: 0.8, efficiency: 0.7, heatW: 3, tempC: 50 } }),
      power: { vrmLossW: 4, totalW: 20, budgetW: 40, psuFactor: 1, off: false, tripped: false },
    });
    const v = must(vrmReadout(s));
    expect(v.capacityA).toBe(24);
    expect(v.demandA).toBeCloseTo(19.2);
    expect(v.zone).toBe('busy');
    expect(v.barMax).toBe(1.5);
    expect(v.efficiency).toBe(0.7);
    expect(v.lossW).toBe(4);
    expect(v.tempLevel).toBe('ok');
    expect(v.sink).toBeNull();
  });

  it('names the heatsink when one is fitted and flags a hot regulator', () => {
    const sink = dev({ id: 'sink1', spec: 'vsink0', kind: 'vrm-sink', name: 'VRM fins', slot: 'vrm-sink0' });
    const v = readoutOf(boardSnap({ vrmSink: sink, vrm: { tempC: 100, loadRatio: 1.3 } }));
    expect(v.sink).toStrictEqual({ name: 'VRM fins', coolingPerC: 0.25 });
    expect(v.tempLevel).toBe('warn');
    expect(v.zone).toBe('overload');
    // (a snapshot from before the board existed has none)
    const noBoard = Object.assign(snap(), { board: undefined });
    expect(vrmReadout(noBoard)).toBeNull();
  });

  it('plain words for burnt, unstable and no-heatsink states', () => {
    const burnt = vrmLines(readoutOf(deadBoard()));
    expect(burnt).toHaveLength(1);
    expect(must(burnt[0]).level).toBe('bad');
    expect(must(burnt[0]).text).toMatch(/board is dead/u);
    const hot = vrmLines(readoutOf(boardSnap({ vrm: { unstable: true, throttle: 0.9 } })));
    expect(hasLine(hot, 'bad', 'crash')).toBe(true);
    expect(hot.some((l) => l.text.includes('Throttling'))).toBe(true);
    expect(hot.some((l) => l.text.includes('No VRM heatsink'))).toBe(true);
  });
});

describe('motherboard tier cards', () => {
  it('one card per tier from the installed one up, with the state and the purchase reason', () => {
    const cards = boardCards(snap({ purchases: [...PURCHASES, ...BOARDS] }));
    expect(cards.map((c) => c.tier)).toStrictEqual([0, 1, 2, 3]);
    expect(cards.map((c) => c.state)).toStrictEqual(['installed', 'poor', 'blocked', 'level']);
    expect(cards[1]).toMatchObject({ canBuy: false, reason: 'Need $150 more' });
    expect(must(cards[2]).reason).toMatch(/powered off required/u);
    expect(must(cards[3]).reason).toMatch(/^Unlocks at Level 9/u);
  });

  it('a bought board in your inventory is a spare, and a richer one is ready when affordable', () => {
    const s = snap({
      money: 500,
      purchases: [...PURCHASES, buy('board1', 150, { affordable: true }), buy('board2', 300, { affordable: true })],
      inventory: [
        {
          id: 'inv9',
          spec: 'board1',
          kind: 'board',
          name: 'Basic',
          freeSlots: ['board'],
          swapSlots: [],
          installable: true,
        },
      ],
    });
    const cards = boardCards(s);
    expect(cards[1]).toMatchObject({ state: 'crate', canBuy: false });
    expect(cards[2]).toMatchObject({ state: 'ready', canBuy: true, price: 300 });
  });

  it('every tier has a card, the smaller ones too: a Mainstream machine can still buy a Starter board', () => {
    const cards = boardCards(
      snap({ boardTier: 2, board: boardSnap({ tier: 2 }), purchases: [...PURCHASES, buy('board3', 700)] }),
    );
    expect(cards.map((c) => c.tier)).toStrictEqual([0, 1, 2, 3]);
    expect(must(cards[2]).state).toBe('installed');
  });

  it('slot counts, features and VRM strength with before and after bars', () => {
    const cards = boardCards(snap({ purchases: [...PURCHASES, ...BOARDS, buy('board3', 700)] }));
    expect(cards.map((c) => c.totalA)).toStrictEqual([24, 36, 60, 120]);
    expect(must(cards[0]).curBar).toBeCloseTo(0.2);
    expect(must(cards[3]).optBar).toBe(1);
    expect(cards[1]).toMatchObject({ trend: 'better', deltaText: '+12 A' });
    expect(cards[0]).toMatchObject({ trend: 'same', deltaText: 'same' });
    expect(cards.map((c) => c.ethernetMbps)).toStrictEqual([0, 100, 100, 1000]);
    expect(cards.map((c) => c.usbPorts)).toStrictEqual([1, 2, 3, 4]);
    expect(cards.map((c) => c.displayPorts)).toStrictEqual([1, 1, 2, 2]);
    expect(slotsOf(must(cards[0]), 'dimm')).toBe(1);
    expect(slotsOf(must(cards[0]), 'pcie')).toBe(1);
    expect(slotsOf(must(cards[2]), 'm2')).toBe(2);
    expect(cards.map((c) => slotsOf(c, 'sata'))).toStrictEqual([2, 3, 4, 8]);
    expect(slotsOf(must(cards[3]), 'dimm')).toBe(8);
  });

  it('a dead board offers the same tier as a replacement, priced, and refuses it while powered', () => {
    const replace = buy('board0', 40, { affordable: true });
    const dead = snap({
      board: deadBoard(),
      purchases: [...PURCHASES, replace, ...BOARDS],
    });
    const c = must(boardCards(dead)[0]);
    expect(c).toMatchObject({ state: 'dead', price: 40, canBuy: true });
    expect(c.reason).toBeUndefined();
    const blocked = buy('board0', 40, {
      affordable: true,
      blocked: 'powered off required: power the machine off to swap the board',
    });
    const poweredSnap = snap({ board: deadBoard(), purchases: [...PURCHASES, blocked] });
    const powered = must(boardCards(poweredSnap)[0]);
    expect(powered).toMatchObject({ state: 'dead', canBuy: false });
    expect(powered.reason).toMatch(/powered off required/u);
  });

  it('the status chip names the replacement and its price, and sandbox says free', () => {
    const s = snap({
      board: deadBoard(),
      purchases: [...PURCHASES, buy('board0', 40, { affordable: true })],
    });
    expect(statusChip(s)).toMatchObject({ text: 'Board dead: replace it', level: 'bad' });
    expect(statusChip(s).title).toMatch(/Starter \(\$40\)/u);
    const sb = snap({
      sandbox: true,
      board: deadBoard(),
      purchases: [buy('board0', 40, { affordable: true })],
    });
    expect(statusChip(sb).title).toMatch(/\(free\)/u);
    expect(statusChip(snap()).text).toBe('Off');
  });

  it('the board picker shows the cards, and a dead board gets a line that says what to do', () => {
    const m = must(pickerFor('board', snap({ purchases: [...PURCHASES, ...BOARDS] })));
    expect(m.boardCards?.map((c) => c.id)).toStrictEqual(['board0', 'board1', 'board2', 'board3']);
    const replacement = buy('board0', 40, { affordable: true });
    const deadSnap = snap({ board: deadBoard(), purchases: [replacement] });
    const dm = must(pickerFor('board', deadSnap));
    expect(hasLine(dm.lines, 'bad', 'board is dead')).toBe(true);
  });

  it('the planned tier counts a bigger board in the inventory', () => {
    expect(plannedBoardTier(snap())).toBe(0);
    const spare = snap({ inventory: [boardItem('board2')] });
    expect(plannedBoardTier(spare)).toBe(2);
  });
});

describe('warnings', () => {
  it("a CPU the board's VRM cannot feed gets the warning (demand at the stock clock over the rating)", () => {
    expect(cpuVrmWarning(snap(), 'cpu2')).toBe("this board's VRM can't feed it: expect throttling or crashes");
    expect(cpuVrmWarning(snap(), 'cpu1')).toBeNull();
    expect(cpuVrmWarning(snap(), 'cpu0')).toBeNull();
    const spare = snap({ inventory: [boardItem('board1')] });
    expect(cpuVrmWarning(spare, 'cpu2')).toBeNull();
    const tier1 = snap({ boardTier: 1, board: boardSnap({ tier: 1 }) });
    expect(cpuVrmWarning(tier1, 'cpu2')).toBeNull();
  });

  it('the warning sits on the CPU upgrade rows, not on the fitted part', () => {
    const rows = ladderFor(snap({ purchases: [...PURCHASES] }), 'cpu');
    expect(must(rows.find((r) => r.specId === 'cpu2')).warn).toMatch(/can't feed it/u);
    expect(must(rows.find((r) => r.specId === 'cpu1')).warn).toBeUndefined();
    const m = must(pickerFor('cpu0', snap({ purchases: [...PURCHASES] })));
    expect(must(m.ladder.find((r) => r.specId === 'cpu2')).warn).toMatch(/can't feed it/u);
  });

  it('a liquid cooler gives the VRM no airflow: the note shows until a VRM heatsink is fitted', () => {
    expect(LIQUID_VRM_NOTE).toBe("liquid coolers don't cool the VRM: add a VRM heatsink");
    expect(liquidVrmNote(snap(), 'cooler2')).toBe(LIQUID_VRM_NOTE);
    expect(liquidVrmNote(snap(), 'cooler1')).toBeNull();
    expect(liquidVrmNote(snap(), 'cooler0')).toBeNull();
    const sink = dev({ id: 'sink1', spec: 'vsink0', kind: 'vrm-sink', name: 'VRM fins', slot: 'vrm-sink0' });
    const sunk = snap({ board: boardSnap({ vrmSink: sink }) });
    expect(liquidVrmNote(sunk, 'cooler2')).toBeNull();
    const rows = ladderFor(snap({ purchases: [...PURCHASES, buy('cooler2', 300)] }), 'cooler');
    expect(must(rows.find((r) => r.specId === 'cooler2')).warn).toBe(LIQUID_VRM_NOTE);
  });
});

describe('VRM heatsink rows and slot', () => {
  it('the empty heatsink slot is a drop target with its own rows', () => {
    const m = must(pickerFor('vrm-sink0', sinkSnap()));
    expect(m.kind).toBe('vrm-sink');
    expect(m.ladder.map((r) => r.specId)).toStrictEqual(['vsink0', 'vsink1', 'vsink2']);
    expect(m.ladder.map((r) => r.state)).toStrictEqual(['poor', 'poor', 'poor']);
    expect(m.lines.some((l) => l.text.includes('Drop a VRM heatsink here'))).toBe(true);
    expect(describeId('vrm-sink0', sinkSnap())).toMatchObject({ title: 'Empty socket' });
    expect(described('vrm-sink0', sinkSnap()).plain).toMatch(/VRM heatsink slot/u);
  });

  it('stats: cooling for the bars; the fan fins draw no power, the fan clipped on them does', () => {
    expect(statsOf('vsink0').map((x) => x.key)).toStrictEqual(['cooling', 'power']);
    expect(must(statsOf('vsink2').find((x) => x.key === 'power')).value).toBe(0);
    expect(must(statsOf('vsink0').find((x) => x.key === 'power')).value).toBe(0);
    expect(statsOf('fan40').find((x) => x.key === 'power')).toMatchObject({ value: 0.5, unit: 'W' });
    const rows = compareRows('vrm-sink', 'vsink0', 'vsink2');
    expect(must(rows.find((r) => r.key === 'cooling')).trend).toBe('better');
  });

  it.each(['vsink0', 'vsink1', 'vsink2'])('every heatsink tier has art (no empty svg): %s', (id) => {
    expect(getSpec(id)?.kind).toBe('vrm-sink');
  });
});

describe('descriptions for the VRM and the board features', () => {
  it.each(VRM_IDS)('every VRM id has a description: %s', (id) => {
    expect(describeId(id, snap())).not.toBeNull();
  });

  it('the nerd line of the VRM ids carries the numbers', () => {
    expect(described('vrm', snap()).nerd).toBe('2 phases x 12 A = 24 A, now 0% of rating');
    expect(must(describeId('vrm.phases')).nerd).toBe('2 phases x 12 A');
    expect(must(describeId('vrm.ripple')).nerd).toContain('0.60');
  });

  it('the feature ids follow the board tier', () => {
    const s3 = snap({ boardTier: 3, board: boardSnap({ tier: 3 }) });
    expect(must(describeId('feature.ethernet', s3)).nerd).toBe('1000 Mbit/s');
    expect(must(describeId('feature.usb', s3)).nerd).toBe('4 USB ports on this board');
    expect(must(describeId('feature.display', s3)).nerd).toBe('2 display ports on this board');
    expect(described('feature.ethernet', snap()).nerd).toBe('none on this board');
  });

  it('each board tier has its own plain line and names its features', () => {
    const plain = [0, 1, 2, 3].map((t) => must(describeId(`board${t}`)));
    expect(new Set(plain.map((d) => d.plain)).size).toBe(4);
    for (const d of plain) {
      expect(d.nerd).toMatch(/ethernet/u);
    }
    expect(must(describeId('board0')).nerd).toContain(
      `VRM ${must(BOARD_TIERS[0]).vrm.phases} x ${must(BOARD_TIERS[0]).vrm.ampsPerPhase} A`,
    );
  });
});

describe('the VRM picker card and the CPU card', () => {
  it('the vrm id opens the readout card', () => {
    const m = must(pickerFor('vrm', snap()));
    expect(m.kind).toBe('info');
    expect(m.vrm).not.toBeNull();
    expect(m.lines.some((l) => l.text.includes('No VRM heatsink'))).toBe(true);
  });

  it('a fitted CPU carries the VRM readout, an empty socket does not', () => {
    const s = snap({
      devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu', slot: 'cpu0' })],
      slots: [{ id: 'cpu0', type: 'cpu', deviceId: 'dev1' }],
      cpuClock: { value: 1, min: 0.25, max: 1.5 },
      inventory: [],
    });
    expect(must(pickerFor('cpu0', s)).vrm).not.toBeNull();
    const empty = snap();
    expect(must(pickerFor('cpu0', empty)).vrm).toBeUndefined();
  });
});
