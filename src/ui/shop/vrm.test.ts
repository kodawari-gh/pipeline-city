import { describe, expect, it } from 'vitest';
import { BOARD_TIERS, getSpec } from '../../sim/board/specs';
import type { InventorySnap, PurchaseSnap, SlotSnap } from '../../sim/game/game';
import { describeId, statusChip, VRM_IDS } from '../logic';
import { compareRows, ladderFor, pickerFor, statsOf } from './picker';
import { boardSnap, dev, EMPTY_SLOTS, PURCHASES, snap } from '../testdata';
import {
  boardCards, cpuVrmWarning, LIQUID_VRM_NOTE, liquidVrmNote, plannedBoardTier, vrmLines, vrmReadout, vrmZone,
} from './vrm';

const buy = (id: string, price: number, o: Partial<PurchaseSnap> = {}): PurchaseSnap => ({
  id, name: id, kind: id.startsWith('board') ? 'board' : id.startsWith('vsink') ? 'vrm-sink' : 'cooler', price, affordable: false, ...o,
});
const BOARDS: PurchaseSnap[] = [buy('board1', 150), buy('board2', 300, { blocked: 'powered off required: power the machine off to swap the board' })];
const SINKS: PurchaseSnap[] = [buy('vsink0', 30), buy('vsink1', 70), buy('vsink2', 140)];
const SINK_SLOT: SlotSnap = { id: 'vrm-sink0', type: 'vrm-sink', deviceId: null };
const boardItem = (id: string): InventorySnap => ({
  id: 'inv9', spec: id, kind: 'board', name: 'board', freeSlots: ['board'], swapSlots: [], installable: false,
});

describe('VRM zones and readout', () => {
  it('safe under 60 percent, busy to the rating, overload past it', () => {
    expect(vrmZone(0.5)).toBe('safe');
    expect(vrmZone(0.6)).toBe('busy');
    expect(vrmZone(1)).toBe('busy');
    expect(vrmZone(1.2)).toBe('overload');
  });

  it('reads demand, rating, zone, efficiency and loss from the snapshot', () => {
    const s = snap({ board: boardSnap({ vrm: { loadRatio: 0.8, efficiency: 0.7, heatW: 3, tempC: 50 } }), power: { vrmLossW: 4, totalW: 20, budgetW: 40, psuFactor: 1, off: false, tripped: false } });
    const v = vrmReadout(s)!;
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
    const v = vrmReadout(snap({ board: boardSnap({ vrmSink: sink, vrm: { tempC: 100, loadRatio: 1.3 } }) }))!;
    expect(v.sink).toEqual({ name: 'VRM fins', coolingPerC: 0.25 });
    expect(v.tempLevel).toBe('warn');
    expect(v.zone).toBe('overload');
    expect(vrmReadout({ ...snap(), board: undefined } as never)).toBeNull();
  });

  it('plain words for burnt, unstable and no-heatsink states', () => {
    const burnt = vrmLines(vrmReadout(snap({ board: boardSnap({ burnt: true, vrm: { burnt: true } }) }))!);
    expect(burnt).toHaveLength(1);
    expect(burnt[0]!.level).toBe('bad');
    expect(burnt[0]!.text).toMatch(/board is dead/);
    const hot = vrmLines(vrmReadout(snap({ board: boardSnap({ vrm: { unstable: true, throttle: 0.9 } }) }))!);
    expect(hot.some((l) => l.level === 'bad' && /crash/.test(l.text))).toBe(true);
    expect(hot.some((l) => /Throttling/.test(l.text))).toBe(true);
    expect(hot.some((l) => /No VRM heatsink/.test(l.text))).toBe(true);
  });
});

describe('motherboard tier cards', () => {
  it('one card per tier from the installed one up, with the state and the purchase reason', () => {
    const cards = boardCards(snap({ purchases: [...PURCHASES, ...BOARDS] }));
    expect(cards.map((c) => c.tier)).toEqual([0, 1, 2, 3]);
    expect(cards.map((c) => c.state)).toEqual(['installed', 'poor', 'blocked', 'level']);
    expect(cards[1]).toMatchObject({ canBuy: false, reason: 'Need $150 more' });
    expect(cards[2]!.reason).toMatch(/powered off required/);
    expect(cards[3]!.reason).toMatch(/^Unlocks at Level 9/);
  });

  it('a bought board in your inventory is a spare, and a richer one is ready when affordable', () => {
    const s = snap({
      money: 500,
      purchases: [...PURCHASES, buy('board1', 150, { affordable: true }), buy('board2', 300, { affordable: true })],
      inventory: [{ id: 'inv9', spec: 'board1', kind: 'board', name: 'Basic', freeSlots: ['board'], swapSlots: [], installable: true }],
    });
    const cards = boardCards(s);
    expect(cards[1]).toMatchObject({ state: 'crate', canBuy: false });
    expect(cards[2]).toMatchObject({ state: 'ready', canBuy: true, price: 300 });
  });

  it('every tier has a card, the smaller ones too: a Mainstream machine can still buy a Starter board', () => {
    const cards = boardCards(snap({ boardTier: 2, board: boardSnap({ tier: 2 }), purchases: [...PURCHASES, buy('board3', 700)] }));
    expect(cards.map((c) => c.tier)).toEqual([0, 1, 2, 3]);
    expect(cards[2]!.state).toBe('installed');
  });

  it('slot counts, features and VRM strength with before and after bars', () => {
    const cards = boardCards(snap({ purchases: [...PURCHASES, ...BOARDS, buy('board3', 700)] }));
    expect(cards.map((c) => c.totalA)).toEqual([24, 36, 60, 120]);
    expect(cards[0]!.curBar).toBeCloseTo(0.2);
    expect(cards[3]!.optBar).toBe(1);
    expect(cards[1]).toMatchObject({ trend: 'better', deltaText: '+12 A' });
    expect(cards[0]).toMatchObject({ trend: 'same', deltaText: 'same' });
    expect(cards.map((c) => c.ethernetMbps)).toEqual([0, 100, 100, 1000]);
    expect(cards.map((c) => c.usbPorts)).toEqual([1, 2, 3, 4]);
    expect(cards.map((c) => c.displayPorts)).toEqual([1, 1, 2, 2]);
    const slotsOf = (c: { slots: Array<{ key: string; count: number }> }, key: string) => c.slots.find((x) => x.key === key)?.count ?? 0;
    expect(slotsOf(cards[0]!, 'dimm')).toBe(1);
    expect(slotsOf(cards[0]!, 'pcie')).toBe(1);
    expect(slotsOf(cards[2]!, 'm2')).toBe(2);
    expect(cards.map((c) => slotsOf(c, 'sata'))).toEqual([2, 3, 4, 8]);
    expect(slotsOf(cards[3]!, 'dimm')).toBe(8);
  });

  it('a dead board offers the same tier as a replacement, priced, and refuses it while powered', () => {
    const replace = buy('board0', 40, { affordable: true });
    const dead = snap({ board: boardSnap({ burnt: true, vrm: { burnt: true } }), purchases: [...PURCHASES, replace, ...BOARDS] });
    const c = boardCards(dead)[0]!;
    expect(c).toMatchObject({ state: 'dead', price: 40, canBuy: true });
    expect(c.reason).toBeUndefined();
    const powered = boardCards(snap({
      board: boardSnap({ burnt: true, vrm: { burnt: true } }),
      purchases: [...PURCHASES, buy('board0', 40, { affordable: true, blocked: 'powered off required: power the machine off to swap the board' })],
    }))[0]!;
    expect(powered).toMatchObject({ state: 'dead', canBuy: false });
    expect(powered.reason).toMatch(/powered off required/);
  });

  it('the status chip names the replacement and its price, and sandbox says free', () => {
    const s = snap({ board: boardSnap({ burnt: true, vrm: { burnt: true } }), purchases: [...PURCHASES, buy('board0', 40, { affordable: true })] });
    expect(statusChip(s)).toMatchObject({ text: 'Board dead: replace it', level: 'bad' });
    expect(statusChip(s).title).toMatch(/Starter \(\$40\)/);
    const sb = snap({ sandbox: true, board: boardSnap({ burnt: true, vrm: { burnt: true } }), purchases: [buy('board0', 40, { affordable: true })] });
    expect(statusChip(sb).title).toMatch(/\(free\)/);
    expect(statusChip(snap()).text).toBe('Off');
  });

  it('the board picker shows the cards, and a dead board gets a line that says what to do', () => {
    const m = pickerFor('board', snap({ purchases: [...PURCHASES, ...BOARDS] }))!;
    expect(m.boardCards?.map((c) => c.id)).toEqual(['board0', 'board1', 'board2', 'board3']);
    const dm = pickerFor('board', snap({ board: boardSnap({ burnt: true, vrm: { burnt: true } }), purchases: [buy('board0', 40, { affordable: true })] }))!;
    expect(dm.lines.some((l) => l.level === 'bad' && /board is dead/.test(l.text))).toBe(true);
  });

  it('the planned tier counts a bigger board in the inventory', () => {
    expect(plannedBoardTier(snap())).toBe(0);
    expect(plannedBoardTier(snap({ inventory: [boardItem('board2')] }))).toBe(2);
  });
});

describe('warnings', () => {
  it("a CPU the board's VRM cannot feed gets the warning (demand at the stock clock over the rating)", () => {
    expect(cpuVrmWarning(snap(), 'cpu2')).toBe("this board's VRM can't feed it: expect throttling or crashes");
    expect(cpuVrmWarning(snap(), 'cpu1')).toBeNull();
    expect(cpuVrmWarning(snap(), 'cpu0')).toBeNull();
    expect(cpuVrmWarning(snap({ inventory: [boardItem('board1')] }), 'cpu2')).toBeNull();
    expect(cpuVrmWarning(snap({ boardTier: 1, board: boardSnap({ tier: 1 }) }), 'cpu2')).toBeNull();
  });

  it('the warning sits on the CPU upgrade rows, not on the fitted part', () => {
    const rows = ladderFor(snap({ purchases: [...PURCHASES] }), 'cpu');
    expect(rows.find((r) => r.specId === 'cpu2')!.warn).toMatch(/can't feed it/);
    expect(rows.find((r) => r.specId === 'cpu1')!.warn).toBeUndefined();
    const m = pickerFor('cpu0', snap({ purchases: [...PURCHASES] }))!;
    expect(m.ladder.find((r) => r.specId === 'cpu2')!.warn).toBeTruthy();
  });

  it('a liquid cooler gives the VRM no airflow: the note shows until a VRM heatsink is fitted', () => {
    expect(LIQUID_VRM_NOTE).toBe("liquid coolers don't cool the VRM: add a VRM heatsink");
    expect(liquidVrmNote(snap(), 'cooler2')).toBe(LIQUID_VRM_NOTE);
    expect(liquidVrmNote(snap(), 'cooler1')).toBeNull();
    expect(liquidVrmNote(snap(), 'cooler0')).toBeNull();
    const sink = dev({ id: 'sink1', spec: 'vsink0', kind: 'vrm-sink', name: 'VRM fins', slot: 'vrm-sink0' });
    expect(liquidVrmNote(snap({ board: boardSnap({ vrmSink: sink }) }), 'cooler2')).toBeNull();
    const rows = ladderFor(snap({ purchases: [...PURCHASES, buy('cooler2', 300)] }), 'cooler');
    expect(rows.find((r) => r.specId === 'cooler2')!.warn).toBe(LIQUID_VRM_NOTE);
  });
});

describe('VRM heatsink rows and slot', () => {
  const sinkSnap = (o: Parameters<typeof snap>[0] = {}) => snap({
    slots: [...EMPTY_SLOTS, SINK_SLOT],
    purchases: [...PURCHASES, ...SINKS],
    ...o,
  });

  it('the empty heatsink slot is a drop target with its own rows', () => {
    const m = pickerFor('vrm-sink0', sinkSnap())!;
    expect(m.kind).toBe('vrm-sink');
    expect(m.ladder.map((r) => r.specId)).toEqual(['vsink0', 'vsink1', 'vsink2']);
    expect(m.ladder.map((r) => r.state)).toEqual(['poor', 'poor', 'poor']);
    expect(m.lines.some((l) => /Drop a VRM heatsink here/.test(l.text))).toBe(true);
    expect(describeId('vrm-sink0', sinkSnap())).toMatchObject({ title: 'Empty socket' });
    expect(describeId('vrm-sink0', sinkSnap())!.plain).toMatch(/VRM heatsink slot/);
  });

  it('stats: cooling for the bars, power draw for the fan version', () => {
    expect(statsOf('vsink0').map((x) => x.key)).toEqual(['cooling', 'power']);
    expect(statsOf('vsink2').find((x) => x.key === 'power')).toMatchObject({ value: 1.5, unit: 'W' });
    expect(statsOf('vsink0').find((x) => x.key === 'power')!.value).toBe(0);
    const rows = compareRows('vrm-sink', 'vsink0', 'vsink2');
    expect(rows.find((r) => r.key === 'cooling')!.trend).toBe('better');
    expect(rows.find((r) => r.key === 'power')!.trend).toBe('worse');
  });

  it('every heatsink tier has art (no empty svg)', () => {
    for (const id of ['vsink0', 'vsink1', 'vsink2']) expect(getSpec(id)?.kind).toBe('vrm-sink');
  });
});

describe('descriptions for the VRM and the board features', () => {
  it('every VRM id has a description, and the nerd line carries the numbers', () => {
    for (const id of VRM_IDS) expect(describeId(id, snap()), id).not.toBeNull();
    expect(describeId('vrm', snap())!.nerd).toBe('2 phases x 12 A = 24 A, now 0% of rating');
    expect(describeId('vrm.phases')!.nerd).toBe('2 phases x 12 A');
    expect(describeId('vrm.ripple')!.nerd).toContain('0.60');
  });

  it('the feature ids follow the board tier', () => {
    const s3 = snap({ boardTier: 3, board: boardSnap({ tier: 3 }) });
    expect(describeId('feature.ethernet', s3)!.nerd).toBe('1000 Mbit/s');
    expect(describeId('feature.usb', s3)!.nerd).toBe('4 USB ports on this board');
    expect(describeId('feature.display', s3)!.nerd).toBe('2 display ports on this board');
    expect(describeId('feature.ethernet', snap())!.nerd).toBe('none on this board');
  });

  it('each board tier has its own plain line and names its features', () => {
    const plain = [0, 1, 2, 3].map((t) => describeId(`board${t}`)!);
    expect(new Set(plain.map((d) => d.plain)).size).toBe(4);
    for (const d of plain) expect(d.nerd).toMatch(/ethernet/);
    expect(describeId('board0')!.nerd).toContain(`VRM ${BOARD_TIERS[0]!.vrm.phases} x ${BOARD_TIERS[0]!.vrm.ampsPerPhase} A`);
  });
});

describe('the VRM picker card and the CPU card', () => {
  it('the vrm id opens the readout card', () => {
    const m = pickerFor('vrm', snap())!;
    expect(m.kind).toBe('info');
    expect(m.vrm).not.toBeNull();
    expect(m.lines.some((l) => /No VRM heatsink/.test(l.text))).toBe(true);
  });

  it('a fitted CPU carries the VRM readout, an empty socket does not', () => {
    const s = snap({
      devices: [dev({ id: 'dev1', spec: 'cpu0', kind: 'cpu', slot: 'cpu0' })],
      slots: [{ id: 'cpu0', type: 'cpu', deviceId: 'dev1' }],
      cpuClock: { value: 1, min: 0.25, max: 1.5 },
      inventory: [],
    });
    expect(pickerFor('cpu0', s)!.vrm).not.toBeNull();
    expect(pickerFor('cpu0', snap())!.vrm).toBeUndefined();
  });
});
