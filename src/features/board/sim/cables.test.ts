import { describe, expect, it } from 'vitest';
import {
  allCables,
  bootCheck,
  cableBlocked,
  cablesLost,
  cardLeadIds,
  cardPowered,
  cableNeeded,
  cablesOf,
  caseMounts,
  connectCable,
  createBoard,
  disconnectCable,
  install,
  noCables,
  pruneCables,
  uninstall,
} from './index';
import type * as simTypes from './index';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** The reason `r` was refused; fails the test when it went through. */
function refusal(r: { ok: true } | { ok: false; reason: string }): string {
  if (r.ok) {
    throw new Error('expected a refusal, but it went through');
  }
  return r.reason;
}

const ok = <T extends { ok: boolean }>(r: T): T => {
  expect(r.ok).toBe(true);
  return r;
};

/** A bare machine that passes POST on the big board, with the given PSU and extras. */
function rig(psu: string, extras: string[] = []): simTypes.Board {
  const b = createBoard(3);
  for (const id of [psu, 'cpu0', 'ram0', 'cooler0', ...extras]) {
    ok(install(b, id));
  }
  return b;
}
const basics = (): simTypes.Cables => ({ ...noCables(), atx: true, cpu: true, cpufan: true, pcmains: true });

/** How many PCIe power leads each card of the lead tests asks for. */
const CARD_LEADS: Partial<Record<string, number>> = { gpu3: 2, gpu2: 1 };

describe('pcie power lead', () => {
  it('is refused when the PSU has no lead, or there is no PSU', () => {
    for (const psu of ['psu0', 'psu1']) {
      const r = connectCable(rig(psu), noCables(), 'pcie');
      expect(r.ok).toBe(false);
      expect(refusal(r)).toBe('this PSU has no PCIe power lead');
    }
    const none = connectCable(createBoard(3), noCables(), 'pcie');
    expect(none.ok).toBe(false);
    expect(refusal(none)).toContain('no PSU installed');
  });

  it('plugs into a PSU that has one', () => {
    const cables = noCables();
    ok(connectCable(rig('psu2'), cables, 'pcie'));
    expect(cables['pcie']).toBe(true);
    expect(connectCable(rig('psu3'), { ...noCables(), pcie: true }, 'pcie').ok).toBe(false); // already connected
  });

  it('comes off when the PSU goes, or is swapped for one without a lead', () => {
    const b = rig('psu2');
    const cables = noCables();
    ok(connectCable(b, cables, 'pcie'));
    const psuId = must(b.devices.find((d) => d.spec === 'psu2')).id;
    ok(uninstall(b, psuId));
    expect(pruneCables(b, cables)).toStrictEqual(['pcie']);
    ok(install(b, 'psu3'));
    ok(connectCable(b, cables, 'pcie'));
    const psu3 = must(b.devices.find((d) => d.spec === 'psu3'));
    ok(uninstall(b, psu3.id));
    ok(install(b, 'psu1'));
    expect(pruneCables(b, cables)).toStrictEqual(['pcie']);
    expect(cables['pcie']).toBe(false);
  });

  it('is needed only by a card that draws more than its slot gives, one lead per 75 W', () => {
    expect(cableNeeded(rig('psu3'), 'pcie')).toBe(false);
    expect(cableNeeded(rig('psu3', ['npu1']), 'pcie')).toBe(false); // slot-powered
    expect(cableNeeded(rig('psu3', ['gpu1']), 'pcie')).toBe(false); // 40 W: slot power
    expect(cableNeeded(rig('psu3', ['gpu2']), 'pcie')).toBe(true);
    expect(cableNeeded(rig('psu3', ['gpu2']), 'pcie2')).toBe(false);
    expect(cableNeeded(rig('psu4', ['gpu3']), 'pcie2')).toBe(true); // 180 W: two leads
    expect(cableNeeded(rig('psu3'), 'atx')).toBe(true);
  });

  it("a GPU without its lead fails POST with 'GPU power cable', not noPower", () => {
    const b = rig('psu3', ['gpu2']);
    const cables = basics();
    const chk = bootCheck(b, cables);
    expect(chk.noPower).toBeNull();
    expect(chk.post).toMatchObject({ short: 'GPU power cable' });
    ok(connectCable(b, cables, 'pcie'));
    expect(bootCheck(b, cables).post).toBeNull();
  });

  it('a slot-powered NPU, or no card at all, needs no lead to boot', () => {
    expect(bootCheck(rig('psu3', ['npu1']), basics()).post).toBeNull();
    expect(bootCheck(rig('psu3'), basics()).post).toBeNull();
  });

  it('a burnt GPU no longer asks for the lead', () => {
    const b = rig('psu3', ['gpu1']);
    must(b.devices.find((d) => d.spec === 'gpu1')).burnt = true;
    expect(bootCheck(b, basics()).post).toBeNull();
  });
});

describe('fan cables', () => {
  it('every case has a hub cable and one per fan mount; the CPU fan cable needs the cooler', () => {
    for (const t of [0, 1, 2, 3]) {
      const b = createBoard(t);
      const ids = cablesOf(b)
        .map((c) => c.id)
        .filter((id) => id.startsWith('fan:'));
      expect(ids, `case ${t}`).toStrictEqual(caseMounts(t).map((m) => `fan:${m}`));
      expect(ids.length).toBeGreaterThanOrEqual(2);
      expect(cableBlocked(b, 'sysfan')).toBeNull();
      expect(cableBlocked(b, 'cpufan')).toMatch(/no CPU cooler/u);
      expect(cableNeeded(b, 'cpufan')).toBe(false);
    }
    expect(caseMounts(0)).toStrictEqual(['front0', 'front1']); // the Mini has a grille at the back, not a fan
    expect(caseMounts(3)).toStrictEqual(['front0', 'front1', 'front2', 'top0', 'top1', 'rear']); // 140 mm fans: three high, two across
  });

  it("a missing pump cable stops POST; a heatsink's fans and the other fans never do", () => {
    const b = rig('psu2');
    ok(install(b, 'fan92', 'cooler0.fan0'));
    const cables: simTypes.Cables = { ...basics(), cpufan: false };
    expect(bootCheck(b, cables).post).toBeNull(); // the heatsink cools by itself, hot
    const loop = createBoard(3);
    for (const id of ['psu2', 'cpu0', 'ram0', 'cooler2']) {
      ok(install(loop, id));
    }
    expect(bootCheck(loop, cables).post).toMatchObject({ short: 'NO CPU FAN' });
    ok(connectCable(loop, cables, 'cpufan'));
    expect(bootCheck(loop, cables).post).toBeNull();
    expect(cables['sysfan']).not.toBe(true);
    expect(cables['fan:rear']).not.toBe(true);
  });

  it("the CPU fan cable waits for a fan on the heatsink; a case fan's cable for a fan on its mount", () => {
    const b = rig('psu2');
    expect(cableBlocked(b, 'cpufan')).toMatch(/no fan on the CPU heatsink/u);
    ok(install(b, 'fan92', 'cooler0.fan0'));
    expect(cableBlocked(b, 'cpufan')).toBeNull();
    expect(cableBlocked(b, 'fan:rear')).toMatch(/no fan on the rear/u);
    ok(install(b, 'fan140', 'rear'));
    expect(cableBlocked(b, 'fan:rear')).toBeNull();
    const cables = noCables();
    ok(connectCable(b, cables, 'fan:rear'));
    const rear = must(b.devices.find((d) => d.slot === 'rear'));
    ok(uninstall(b, rear.id));
    expect(pruneCables(b, cables)).toStrictEqual(['fan:rear']);
  });

  it("a case fan's cable plugs and unplugs; one the case does not have is refused", () => {
    const b = createBoard(1);
    ok(install(b, 'fan92', 'top0'));
    const cables = noCables();
    ok(connectCable(b, cables, 'fan:top0'));
    expect(cables['fan:top0']).toBe(true);
    expect(connectCable(b, cables, 'fan:top0').ok).toBe(false); // already
    expect(connectCable(b, cables, 'fan:top1').ok).toBe(false); // the Micro tower has one top fan
    ok(disconnectCable(cables, 'fan:top0', b));
    expect(cables['fan:top0']).toBe(false);
  });

  it("the sink fans' cables need fan fins with a fan on them, and come off with the fan", () => {
    expect(cableBlocked(rig('psu2', ['vsink0']), 'vrmfan')).toMatch(/no VRM fan fins/u);
    const b = rig('psu2', ['vsink2']);
    expect(cableBlocked(b, 'vrmfan')).toMatch(/no fan on the VRM fan fins/u);
    ok(install(b, 'fan40'));
    expect(must(b.devices.find((d) => d.spec === 'fan40')).slot).toBe('vrm-sink0.fan0');
    expect(cableBlocked(b, 'vrmfan')).toBeNull();
    expect(cableNeeded(b, 'vrmfan')).toBe(true);
    const cables = noCables();
    ok(connectCable(b, cables, 'vrmfan'));
    const fan40 = must(b.devices.find((d) => d.spec === 'fan40'));
    ok(uninstall(b, fan40.id));
    expect(pruneCables(b, cables)).toStrictEqual(['vrmfan']);
  });

  it('allCables plugs the fans a board has and leaves the ones it has no fan for', () => {
    const b = rig('psu2', ['vsink2', 'fan40', 'fan92', 'fan140']);
    expect(must(b.devices.find((d) => d.spec === 'fan140')).slot).toBe('front0');
    const c = allCables(b);
    expect([c['cpufan'], c['sysfan'], c['vrmfan'], c['fan:front0']]).toStrictEqual([true, true, true, true]);
    expect(c['ramfan']).toBe(false); // no RAM VRM heatsink with a fan
    expect(c['fan:rear']).toBe(false); // an empty mount
  });

  it('leads fill the cards in slot order, and a card runs only with all its own leads', () => {
    const b = rig('psu4', ['gpu3', 'gpu2']);
    const [big, small] = [
      must(b.devices.find((d) => d.spec === 'gpu3')),
      must(b.devices.find((d) => d.spec === 'gpu2')),
    ];
    const first = must([big, small].toSorted((a, c) => a.slot.localeCompare(c.slot))[0]);
    expect(cardLeadIds(b, first)).toHaveLength(must(CARD_LEADS[first.spec]));
    const cables = noCables();
    expect(cardPowered(b, cables, big)).toBe(false);
    for (const id of ['pcie', 'pcie2', 'pcie3'] as const) {
      ok(connectCable(b, cables, id));
    }
    expect([cardPowered(b, cables, big), cardPowered(b, cables, small)]).toStrictEqual([true, true]);
    expect(cableBlocked(rig('psu2'), 'pcie2')).toBe('this PSU has only 1 PCIe power lead');
  });
});

const idOf = (b: simTypes.Board, spec: string): string => must(b.devices.find((d) => d.spec === spec)).id;

describe('cables that go with their part', () => {
  it('the PSU takes its leads and its cord with it, and no other cable', () => {
    const b = rig('psu4', ['gpu3', 'gpu2']);
    const lost = cablesLost(b, idOf(b, 'psu4'));
    for (const id of ['atx', 'cpu', 'pcmains', 'pcie', 'pcie2', 'pcie3']) {
      expect(lost).toContain(id);
    }
    expect(lost).not.toContain('cpufan');
    expect(lost).not.toContain('sysfan');
    expect(lost).not.toContain('lan');
  });

  it('a monitor takes the video cable and its cord, a fan its cord, a card the leads no card needs', () => {
    const b = rig('psu4', ['gpu3', 'gpu2', 'fan140', 'display1']);
    expect(cablesLost(b, idOf(b, 'display1')).toSorted()).toStrictEqual(['monmains', 'video']);
    expect(cablesLost(b, idOf(b, 'fan140'))).toStrictEqual(['fan:front0']);
    // the big card asks for two of the three leads: without it the last two are not needed
    expect(cablesLost(b, idOf(b, 'gpu3')).length).toBeGreaterThan(0);
    expect(cablesLost(b, idOf(b, 'gpu3')).every((id) => id.startsWith('pcie'))).toBe(true);
  });

  it('a part with no cable of its own loses none', () => {
    const b = rig('psu2');
    expect(cablesLost(b, idOf(b, 'ram0'))).toStrictEqual([]);
    expect(cablesLost(b, idOf(b, 'cpu0'))).toStrictEqual([]);
  });
});
