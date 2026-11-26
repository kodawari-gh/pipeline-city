import { afterEach, describe, expect, it } from 'vitest';
import { assemble } from '../../cpu/sim/asm';
import { Machine, Prng } from '@/core/sim';
import {
  applyEngine,
  applyRates,
  boardFromJson,
  boardSlots,
  boardToJson,
  createBoard,
  engineConfigFor,
  install,
  installedPsu,
  machineConfigFor,
  setClock,
  ThermalModel,
  uninstall,
  upgradeBoard,
} from './index';
import type * as simTypes from './index';
import { pcieLeadsNeeded } from './board';
import { BOARD_TIERS, DEVICE_SPECS, PCIE_SLOT_W, cardLeads } from './specs';
import type * as specsTypes from './specs';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

type Kind = simTypes.DeviceSpec['kind'];
type SpecOf<K extends Kind> = Extract<simTypes.DeviceSpec, { kind: K }>;

/** Whether `spec` is a part of `kind`. */
function isKind<K extends Kind>(spec: simTypes.DeviceSpec, kind: K): spec is SpecOf<K> {
  return spec.kind === kind;
}

/** `spec` narrowed to its `kind`; fails the test when it is missing or some other part. */
function specOf<K extends Kind>(spec: simTypes.DeviceSpec | undefined, kind: K): SpecOf<K> {
  if (spec === undefined || !isKind(spec, kind)) {
    throw new Error(`expected a ${kind} spec, got ${spec?.kind ?? 'nothing'}`);
  }
  return spec;
}

/** The reason `r` was refused; fails the test when it went through. */
function refusal(r: { ok: true } | { ok: false; reason: string }): string {
  if (r.ok) {
    throw new Error('expected a refusal, but it went through');
  }
  return r.reason;
}

function ok<T extends { ok: boolean }>(r: T): T {
  expect(r.ok).toBe(true);
  return r;
}

function basicBoard(opts: { cpu?: string; cooler?: string; psu?: string } = {}): simTypes.Board {
  const b = createBoard(1);
  ok(install(b, opts.cpu ?? 'cpu0'));
  ok(install(b, 'ram0'));
  ok(install(b, 'display0'));
  ok(install(b, opts.cooler ?? 'cooler0'));
  ok(install(b, opts.psu ?? 'psu0'));
  return b;
}

const cpuId = (b: simTypes.Board) => must(b.devices.find((d) => d.spec.startsWith('cpu'))).id;
const dropCooler = (b: simTypes.Board) => {
  const cooler = must(b.devices.find((d) => d.spec.startsWith('cooler')));
  ok(uninstall(b, cooler.id));
};

describe('slots and PSU validation', () => {
  it('installs into matching free slots', () => {
    const b = createBoard(1);
    expect(ok(install(b, 'ram0'))).toMatchObject({ slot: 'dimm0' });
    expect(ok(install(b, 'ram0'))).toMatchObject({ slot: 'dimm1' });
  });

  it('rejects wrong slot, no free slot, no such slot, unknown spec', () => {
    const b = createBoard(1);
    ok(install(b, 'ram0', 'dimm1'));
    const wrong = install(b, 'ram0', 'sata0');
    expect(refusal(wrong)).toMatch(/needs a dimm slot/u);
    const used = install(b, 'ram0', 'dimm1');
    expect(refusal(used)).toMatch(/already used/u);
    ok(install(b, 'ram0'));
    const full = install(b, 'ram0');
    expect(refusal(full)).toMatch(/no free dimm slot/u);
    expect(install(b, 'ram0', 'nope').ok).toBe(false);
    expect(install(b, 'bogus').ok).toBe(false);
    ok(install(b, 'cpu0'));
    const second = install(b, 'cpu1');
    expect(refusal(second)).toMatch(/no free cpu slot/u);
    const noPcie = install(createBoard(1), 'cpu0', 'cpu0');
    expect(noPcie.ok).toBe(true);
  });

  it('PSU needs a matching connector', () => {
    const r = install(createBoard(1), 'psu2');
    expect(refusal(r)).toMatch(/no atx-plus slot/u);
    expect(install(createBoard(2), 'psu2').ok).toBe(true);
    expect(install(createBoard(2), 'psu0').ok).toBe(true); // a plain ATX PSU fits the ATX+ connector
  });

  it('PSU watts are checked both ways', () => {
    const b = createBoard(1);
    ok(install(b, 'cpu1'));
    ok(install(b, 'ram0'));
    ok(install(b, 'display0'));
    ok(install(b, 'psu0')); // rated 20 + 2 + 3 = 25 W <= 40
    ok(install(b, 'ram2')); // 30 W
    ok(install(b, 'cooler2')); // 36 W
    const over = install(createBoard(1), 'ram2');
    expect(over.ok).toBe(true);
    const b2 = createBoard(1);
    ok(install(b2, 'psu0'));
    ok(install(b2, 'cpu2')); // 35 W
    const tooMuch = install(b2, 'ram2'); // 40 W exactly: fits
    expect(tooMuch.ok).toBe(true);
    const full = install(b2, 'display0'); // 43 W
    expect(refusal(full)).toMatch(/PSU gives 40 W/u);
    const weak = createBoard(1);
    ok(install(weak, 'cpu2'));
    ok(install(weak, 'ram2'));
    ok(install(weak, 'display0'));
    const small = install(weak, 'psu0');
    expect(refusal(small)).toMatch(/gives 40 W but installed parts need 43 W/u);
    expect(install(weak, 'psu1').ok).toBe(true);
  });

  it('with the power rules off only the shape of a part decides (Build my PC)', () => {
    const loose = { power: false };
    // a part that pushes the draw past the supply goes in
    const b2 = createBoard(1);
    ok(install(b2, 'psu0'));
    ok(install(b2, 'cpu2'));
    ok(install(b2, 'ram2'));
    expect(install(b2, 'display0').ok).toBe(false);
    ok(install(b2, 'display0', loose)); // 43 W on a 40 W supply
    // a supply smaller than the parts goes in
    const weak = createBoard(1);
    ok(install(weak, 'cpu2'));
    ok(install(weak, 'ram2'));
    ok(install(weak, 'display0'));
    expect(install(weak, 'psu0').ok).toBe(false);
    ok(install(weak, 'psu0', loose));
    // a card with no lead for it, and on the board with no PCIe power connector
    const start = createBoard(0);
    expect(install(start, 'gpu2').ok).toBe(false); // 90 W needs a lead, and the Starter board has no PCIe power connector
    ok(install(start, 'gpu2', loose));
    const top = createBoard(3);
    ok(install(top, 'psu2')); // one lead
    ok(install(top, 'gpu2')); // 90 W: one lead
    expect(install(top, 'gpu3').ok).toBe(false); // 180 W: two more leads, three in all
    ok(install(top, 'gpu3', loose));
    expect(pcieLeadsNeeded(top)).toBe(3);
    // the shape still decides: a socket the part does not fit, and one that is taken
    expect(install(createBoard(1), 'cpu1', { slotId: 'dimm0', ...loose }).ok).toBe(false);
    expect(install(top, 'psu1', loose).ok).toBe(false);
    expect(install(createBoard(0), 'gpu3', loose).ok).toBe(false); // x16 Gen5 card in a narrower slot
  });

  it('uninstall frees the slot; setClock validates range', () => {
    const b = basicBoard();
    const id = cpuId(b);
    expect(setClock(b, id, 1.25).ok).toBe(true);
    expect(setClock(b, id, 5).ok).toBe(false);
    const psu0 = must(b.devices.find((d) => d.spec === 'psu0'));
    expect(setClock(b, psu0.id, 1).ok).toBe(false);
    ok(uninstall(b, id));
    expect(install(b, 'cpu1').ok).toBe(true);
    expect(uninstall(b, 'zzz').ok).toBe(false);
  });
});

describe('board upgrade', () => {
  it('carries every device over, moving the ATX PSU to the ATX+ connector', () => {
    const b = basicBoard({ psu: 'psu1', cpu: 'cpu1' });
    const before = boardToJson(b);
    ok(setClock(b, cpuId(b), 2.5));
    ok(upgradeBoard(b, 2));
    expect(b.tier).toBe(2);
    expect(b.devices.map((d) => d.id)).toStrictEqual(before.devices.map((d) => d.id));
    expect(must(b.devices.find((d) => d.spec === 'psu1')).slot).toBe('atx-plus0');
    expect(must(b.devices.find((d) => d.spec === 'cpu1')).clock).toBe(2.5);
    expect(must(b.devices.find((d) => d.spec === 'ram0')).slot).toBe('dimm0');
    expect(boardFromJson(boardToJson(b)).tier).toBe(2); // still a valid save
    expect(must(installedPsu(b)).spec.id).toBe('psu1');
  });

  it('unlocks the ATX+ PSU and extra DIMMs, and refuses smaller or unknown tiers', () => {
    const small = basicBoard({ psu: 'psu1' });
    expect(install(small, 'psu2').ok).toBe(false);
    ok(upgradeBoard(small, 2));
    const smallPsu = must(installedPsu(small));
    ok(uninstall(small, smallPsu.dev.id));
    ok(install(small, 'psu2'));
    ok(install(small, 'ram0'));
    ok(install(small, 'ram0'));
    expect(upgradeBoard(small, 2).ok).toBe(false);
    expect(refusal(upgradeBoard(small, 1))).toMatch(/no slot for/u); // a smaller board refuses while a part has no slot on it
    expect(small.tier).toBe(2);
    expect(upgradeBoard(small, 9).ok).toBe(false);
  });
});

describe('serialization', () => {
  it('round-trips through JSON, including clocks and burnt', () => {
    const b = basicBoard({ cpu: 'cpu1' });
    setClock(b, cpuId(b), 2.5);
    must(b.devices.find((d) => d.spec === 'ram0')).burnt = true;
    const saved = boardToJson(b),
      text = JSON.stringify(saved);
    expect(JSON.parse(text)).toStrictEqual(saved); // the save survives its JSON text
    const b2 = boardFromJson(structuredClone(saved));
    expect(b2).toStrictEqual(b);
    expect(install(b2, 'ram0').ok).toBe(true);
  });

  it('rejects invalid saves', () => {
    const b = basicBoard();
    const j = boardToJson(b);
    must(j.devices[0]).spec = 'nope';
    expect(() => boardFromJson(j)).toThrow(/unknown device/u);
    const j2 = boardToJson(b);
    must(j2.devices[0]).slot = 'dimm0';
    expect(() => boardFromJson(j2)).toThrow(/bad slot/u);
  });
});

function run(b: simTypes.Board, ticks: number, o: { seed?: number; loads?: Parameters<ThermalModel['step']>[1] } = {}) {
  const { seed = 7, loads = {} } = o;
  const th = new ThermalModel(new Prng(seed));
  const id = cpuId(b);
  const trace: { temp: number; eff: number; unstable: boolean; burnt: boolean }[] = [];
  for (let t = 0; t < ticks; t++) {
    th.step(b, loads);
    const s = must(th.state(id)),
      dev = must(b.devices.find((d) => d.id === id));
    trace.push({
      temp: s.tempC,
      eff: s.effClock,
      unstable: s.unstable,
      burnt: Boolean(dev.burnt),
    });
  }
  return { th, trace };
}

/** Whether a trace step runs throttled: slowed below the 1.5 GHz overclock, but not stopped. */
const isThrottled = (x: { eff: number }): boolean => x.eff > 0 && x.eff < 1.5;

/** The tick an overclocked basic board burns with `cooler` in place of its own (or none), -1 when it never does. */
function burnTime(cooler: string | null): number {
  const b = basicBoard();
  dropCooler(b);
  if (cooler !== null) {
    ok(install(b, cooler));
  }
  setClock(b, cpuId(b), 1.5);
  return run(b, 600).trace.findIndex((x) => x.burnt);
}

/** An uncooled overclocked board run 100 ticks on `seed`: its error rolls and the parts' end temperatures. */
function seededRun(seed: number) {
  const b = basicBoard();
  dropCooler(b);
  setClock(b, cpuId(b), 1.5);
  const th = new ThermalModel(new Prng(seed));
  const rolls: boolean[] = [];
  for (let t = 0; t < 100; t++) {
    th.step(b);
    rolls.push(th.errorRoll(cpuId(b)));
  }
  return { rolls, temps: [...th.devices.values()].map((s) => s.tempC) };
}

/** Steps `engine` until it halts, at most `max` times. */
function stepUntilHalted(engine: { halted: boolean; step: () => unknown }, max: number): void {
  for (let i = 0; i < max && !engine.halted; i++) {
    engine.step();
  }
}

/** How many slots of `type` a board tier has. */
const slotsOf = (t: (typeof BOARD_TIERS)[number], type: 'tpm' | 'pcie'): number => t.slots[type] ?? 0;

/** A writable view of the spec table, for the made-up parts the accelerator tests add. */
const SPECS: Record<string, specsTypes.DeviceSpec> = DEVICE_SPECS;

describe('thermal', () => {
  it('idle stays cool; stock load at base clock is fine', () => {
    const idle = run(basicBoard(), 400, { seed: 1, loads: { cpu: 0, ram: 0, display: 0 } });
    expect(Math.max(...idle.trace.map((x) => x.temp))).toBeLessThan(35);
    const loaded = run(basicBoard(), 400);
    expect(Math.max(...loaded.trace.map((x) => x.temp))).toBeLessThan(70);
    expect(must(loaded.trace.at(-1)).eff).toBe(1);
  });

  it('overclock without cooling heats, throttles, errors, then burns', () => {
    // psu1: the VRM loss is now drawn from the PSU, so the 40 W PSU would brown out on the first tick.
    const b = basicBoard({ psu: 'psu1' });
    dropCooler(b);
    setClock(b, cpuId(b), 1.5);
    const { trace } = run(b, 200);
    const throttled = trace.findIndex((x) => isThrottled(x));
    const errors = trace.findIndex((x) => x.unstable);
    const burnt = trace.findIndex((x) => x.burnt);
    expect(throttled).toBeGreaterThan(0);
    expect(errors).toBeGreaterThan(throttled);
    expect(burnt).toBeGreaterThan(errors);
    expect(must(trace[burnt + 1]).eff).toBe(0);
  });

  it('a better cooler delays or prevents it', () => {
    expect(burnTime(null)).toBeGreaterThan(0);
    expect(burnTime('cooler0')).toBe(-1);
    expect(burnTime('cooler1')).toBe(-1);
  });

  it('PSU overload throttles; a big overload trips until powerCycle', () => {
    const b = basicBoard({ cpu: 'cpu1', cooler: 'cooler2' });
    const id = cpuId(b);
    setClock(b, id, 3); // r=1.5 -> ~62 W on a 40 W PSU
    const th = new ThermalModel(new Prng(1));
    th.step(b);
    expect(th.power.tripped).toBe(true);
    expect(th.effectiveClock(id)).toBe(0);
    th.step(b);
    expect(th.power.off).toBe(true);
    setClock(b, id, 2);
    th.powerCycle();
    th.step(b);
    expect(th.power.tripped).toBe(false);
    expect(th.effectiveClock(id)).toBe(2);

    // Moderate overload (~1.2x): forced throttle by budget / draw.
    setClock(b, id, 2.5);
    const t2 = new ThermalModel(new Prng(1));
    t2.step(b);
    expect(t2.power.psuFactor).toBeLessThan(1);
    expect(t2.power.tripped).toBe(false);
    expect(t2.effectiveClock(id)).toBeLessThan(2.5);
    expect(t2.effectiveClock(id)).toBeGreaterThan(0);
  });

  it('no PSU means off', () => {
    const b = basicBoard();
    const fitted = must(installedPsu(b));
    ok(uninstall(b, fitted.dev.id));
    const { th } = run(b, 3);
    expect(th.power.off).toBe(true);
    expect(th.effectiveClock(cpuId(b))).toBe(0);
  });

  it('is deterministic per seed, including errorRoll', () => {
    const a = seededRun(5);
    expect(seededRun(5)).toStrictEqual(a);
    expect(a.rolls.some(Boolean)).toBe(true);
    expect(seededRun(6).rolls).not.toStrictEqual(a.rolls);
  });

  it('errorRoll does not touch the PRNG while stable', () => {
    const prng = new Prng(3);
    const before = prng.getState();
    const b = basicBoard();
    const th = new ThermalModel(prng);
    for (let t = 0; t < 50; t++) {
      th.step(b);
      th.errorRoll(cpuId(b));
    }
    expect(prng.getState()).toBe(before);
  });
});

describe('apply', () => {
  it('sets clock rates, including throttled effective ones', () => {
    const b = basicBoard();
    const id = cpuId(b);
    setClock(b, id, 1.25);
    const m = new Machine(machineConfigFor(b, 1));
    expect(m.clock.getRate('cpu')).toStrictEqual({ mul: 125, div: 100 });
    expect(m.ram).toHaveLength(16 * 1024);
    const th = new ThermalModel(m.prng);
    th.step(b);
    applyRates(b, m, th);
    expect(m.clock.getRate('cpu')).toStrictEqual({ mul: 125, div: 100 });
    expect(m.clock.getRate('display')).toStrictEqual({ mul: 100, div: 100 });
    // Heat it up until it throttles: the applied rate drops below the requested one.
    dropCooler(b);
    setClock(b, id, 1.5);
    for (let i = 0; i < 40; i++) {
      th.step(b);
    }
    applyRates(b, m, th);
    const r = m.clock.getRate('cpu');
    expect(r.mul).toBeGreaterThan(0);
    expect(r.mul).toBeLessThan(150);
    // Burn it: rate 0.
    must(b.devices.find((d) => d.id === id)).burnt = true;
    th.step(b);
    applyRates(b, m, th);
    expect(m.clock.getRate('cpu').mul).toBe(0);
  });

  it('selects the engine from the CPU tier and miss penalty from RAM', () => {
    expect(engineConfigFor(basicBoard())).toStrictEqual({ kind: 'unpipelined', missPenalty: 200 });
    expect(engineConfigFor(basicBoard({ cpu: 'cpu2', psu: 'psu1' }))).toMatchObject({
      kind: 'inorder',
      forwarding: true,
      cacheLines: 16,
    });
    expect(engineConfigFor(basicBoard({ cpu: 'cpu1', psu: 'psu1' }))).toMatchObject({
      kind: 'inorder',
      forwarding: false,
      missPenalty: 400,
    });
  });

  it('with several RAM sticks the slowest one sets the miss penalty', () => {
    const b = basicBoard();
    ok(install(b, 'ram1')); // a fast stick next to the starter stick
    expect(engineConfigFor(b)).toStrictEqual({ kind: 'unpipelined', missPenalty: 200 });
    must(b.devices.find((d) => d.spec === 'ram0')).burnt = true; // a burnt stick does not count
    expect(engineConfigFor(b)).toStrictEqual({ kind: 'unpipelined', missPenalty: 6 });
  });

  it('applyEngine attaches a runnable engine', () => {
    const b = basicBoard();
    const m = new Machine(machineConfigFor(b, 1));
    const prog = assemble('addi a0, zero, 5\necall\n').program;
    expect(applyEngine(b, m, prog)).toBe(true);
    stepUntilHalted(must(m.engine), 20);
    expect(must(m.engine).halted).toBe(true);
    expect(applyEngine(createBoard(1), m, prog)).toBe(false);
  });
});

// Accelerator slots and rules (docs/ACCEL.md "Shared shape"). The card and TPM specs arrive in T69, so these tests add their own.
const fake = (spec: specsTypes.DeviceSpec) => {
  SPECS[spec.id] = spec;
};

describe('accelerator slots', () => {
  const base = {
    tier: 1,
    slot: 'pcie',
    price: 1,
    idleW: 1,
    heatFactor: 1,
    visual: 'x',
    thermal: must(DEVICE_SPECS['nic1']).thermal,
  } as const;
  afterEach(() => {
    delete SPECS['tpmT'];
    delete SPECS['gpuHot'];
    delete SPECS['npuSlot'];
  });

  it('the TPM header exists on Mainstream and Enthusiast only', () => {
    expect(BOARD_TIERS.map((t) => slotsOf(t, 'tpm'))).toStrictEqual([0, 0, 1, 1]);
  });

  it('a TPM goes in the header, and Starter and Basic refuse it', () => {
    fake({ ...base, id: 'tpmT', kind: 'tpm', slot: 'tpm', name: 'Test TPM', loadW: 0.5 });
    expect(install(createBoard(2), 'tpmT')).toMatchObject({ ok: true, slot: 'tpm0' });
    for (const tier of [0, 1]) {
      const r = install(createBoard(tier), 'tpmT');
      expect(r.ok).toBe(false);
      expect(refusal(r)).toContain('no tpm slot');
    }
  });

  it('the header takes one TPM', () => {
    fake({ ...base, id: 'tpmT', kind: 'tpm', slot: 'tpm', name: 'Test TPM', loadW: 0.5 });
    const b = createBoard(2);
    ok(install(b, 'tpmT'));
    expect(install(b, 'tpmT').ok).toBe(false);
  });

  it('PSUs carry PCIe leads: none on the small two, one on the ATX+', () => {
    const leads = ['psu0', 'psu1', 'psu2'].map((id) => specOf(DEVICE_SPECS[id], 'psu').pcieLeads);
    expect(leads).toStrictEqual([0, 0, 1]);
  });

  it("a card above the slot's power needs PCIe leads: refused on Starter, counted against the PSU leads", () => {
    fake({ ...base, id: 'gpuHot', kind: 'gpu', name: 'Hot card', loadW: PCIE_SLOT_W + 5 });
    fake({ ...base, id: 'npuSlot', kind: 'npu', name: 'Slot-powered card', loadW: PCIE_SLOT_W });
    expect(cardLeads({ loadW: PCIE_SLOT_W })).toBe(0);
    expect(cardLeads({ loadW: PCIE_SLOT_W + 5 })).toBe(1);
    expect(cardLeads({ loadW: PCIE_SLOT_W + 76 })).toBe(2);
    const start = createBoard(0);
    const r = install(start, 'gpuHot');
    expect(r.ok).toBe(false);
    expect(refusal(r)).toContain('no PCIe power connector');
    ok(install(start, 'npuSlot'));
    const b = createBoard(2);
    ok(install(b, 'psu2')); // one lead
    ok(install(b, 'gpuHot'));
    const two = install(b, 'gpuHot');
    expect(two.ok).toBe(false);
    expect(refusal(two)).toContain('2 PCIe power leads but the PSU has 1');
    ok(install(b, 'npuSlot'));
  });

  it('cards compete with NIC cards for the PCIe slots', () => {
    fake({ ...base, id: 'npuSlot', kind: 'npu', name: 'Slot-powered card', loadW: 15 });
    const b = createBoard(1); // Basic: two PCIe slots
    ok(install(b, 'nic1'));
    ok(install(b, 'npuSlot'));
    expect(install(b, 'npuSlot').ok).toBe(false);
  });
});

const placedIn = (b: simTypes.Board, spec: string): string => {
  const r = install(b, spec);
  if (!r.ok) {
    throw new Error(r.reason);
  }
  return r.slot;
};

const widths = (b: simTypes.Board) =>
  boardSlots(b)
    .filter((s) => s.type === 'pcie')
    .map((s) => s.width);

describe('PCIe slot widths', () => {
  it('each tier lists a width per pcie slot, widest first', () => {
    for (const t of BOARD_TIERS) {
      expect(t.pcieWidths).toHaveLength(slotsOf(t, 'pcie'));
      expect(t.pcieWidths.toSorted((a, b) => b - a)).toStrictEqual(t.pcieWidths);
    }
  });

  it("the 32 lane GPU only fits the top board's x16 Gen5 slot", () => {
    for (const tier of [0, 1, 2]) {
      const r = install(createBoard(tier), 'gpu3');
      expect(r.ok).toBe(false);
      expect(refusal(r)).toMatch(/wide enough|needs a x16 Gen5/u);
    }
    const b = createBoard(3);
    expect(refusal(install(b, 'gpu3', 'pcie1'))).toContain('x16 Gen5');
    expect(placedIn(b, 'gpu3')).toBe('pcie0');
  });

  it('a small card takes the narrowest free slot, leaving the wide one for a GPU', () => {
    const b = createBoard(3);
    expect(placedIn(b, 'nic1')).toBe('pcie3'); // x4
    expect(placedIn(b, 'nic3')).toBe('pcie2'); // x8
    expect(placedIn(b, 'gpu2')).toBe('pcie1'); // x16 (the x32 stays free)
    expect(widths(b)).toStrictEqual([32, 16, 8, 4]);
  });

  it('a card is refused a slot narrower than it needs, and a wider one is fine', () => {
    const b = createBoard(2);
    expect(install(b, 'gpu2', 'pcie2').ok).toBe(false); // x4
    expect(install(b, 'nic1', 'pcie0').ok).toBe(true); // x1 card in the x16 slot
  });

  it('upgradeBoard moves the wide card first and refuses a board without a wide enough slot', () => {
    const b = createBoard(3);
    ok(install(b, 'nic1', 'pcie0'));
    ok(install(b, 'gpu2', 'pcie1'));
    ok(upgradeBoard(b, 2));
    expect(must(b.devices.find((d) => d.spec === 'gpu2')).slot).toBe('pcie0');
    const c = createBoard(3);
    ok(install(c, 'gpu3'));
    const r = upgradeBoard(c, 2);
    expect(r.ok).toBe(false);
  });
});
