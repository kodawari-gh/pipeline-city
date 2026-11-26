import { assert, describe, expect, it } from 'vitest';
import type { OsSnap, StorageSnap } from '@/worker/game/game';
import { dev, snap } from '@/core/ui/testdata';
import { bottleneck, resourceRows, spoolModel } from './osui';

const drive = (o: Partial<StorageSnap> = {}): StorageSnap => ({
  deviceId: 'd1',
  slot: 'sata0',
  spec: 'ssd1',
  name: 'SATA SSD',
  hasOs: true,
  burnt: false,
  capacityBytes: 100_000,
  usedBytes: 10_000,
  busy: false,
  bytesPerSecond: 50_000,
  queued: 0,
  queueDepth: 4,
  wearPct: 0,
  bytesRead: 0,
  bytesWritten: 0,
  latencyTicks: 0,
  blockTicks: 0,
  fs: { runs: [], fragmentation: 0, byKind: { os: 0, spool: 0, program: 0, dataset: 0, meta: 0 }, files: [] },
  wear: [],
  headLba: 0,
  cmds: [],
  badGroups: 0,
  lostBlocks: 0,
  mirror: false,
  mount: { state: 'clean', phase: 'mounted', progress: 1 },
  format: { why: null, datasets: 0 },
  ...o,
});

const os = (o: Partial<OsSnap> = {}): OsSnap => ({
  spec: 'os2',
  tier: 2,
  name: 'Paged OS 2.0',
  deviceId: 'd1',
  slot: 'sata0',
  programSlots: 1,
  queueSlots: 4,
  up: true,
  queue: [],
  runningKeyId: null,
  spool: { slotBytes: 4096, slots: 4, used: 1, freeBytes: 0, full: false },
  config: {
    spoolWanted: null,
    spoolMax: 8,
    drives: [
      {
        deviceId: 'd1',
        slot: 'sata0',
        name: 'SATA SSD',
        tier: 2,
        home: true,
        on: true,
        why: null,
        slots: 4,
        freeBytes: 90_000,
        alloc: null,
        maxSlots: 8,
        needsFormat: false,
        formatWhy: null,
        reserveBytes: null,
        dataBytes: 0,
        capacityBytes: 100_000,
        usedBytes: 10_000,
        osBytes: 10_000,
      },
    ],
  },
  ...o,
});

describe('OS panel: resource monitor', () => {
  it('lists the CPU, the regulator, each drive and the queue, and finds no bottleneck on a calm machine', () => {
    const s = snap({
      devices: [dev({ kind: 'cpu', name: 'Tiny CPU', effectiveClock: 1 })],
      storage: [drive()],
      os: os(),
    });
    const rows = resourceRows(s);
    expect(rows.map((r) => r.id)).toStrictEqual(expect.arrayContaining(['cpu', 'vrm', 'disk:d1', 'queue']));
    expect(bottleneck(rows)).toBeNull();
  });

  it('names a throttled CPU as the bottleneck', () => {
    const s = snap({ devices: [dev({ kind: 'cpu', name: 'Tiny CPU', throttle: 0.7 })], storage: [drive()], os: os() });
    const b = bottleneck(resourceRows(s));
    expect(b).toMatchObject({ id: 'cpu', level: 'warn' });
    assert.exists(b);
    expect(b.text).toMatch(/cooler/u);
  });

  it('a full spool is the bottleneck and says how to add slots', () => {
    const s = snap({
      storage: [drive()],
      os: os({ spool: { slotBytes: 4096, slots: 4, used: 4, freeBytes: 0, full: true } }),
    });
    const b = bottleneck(resourceRows(s));
    expect(b).toMatchObject({ id: 'queue' });
    assert.exists(b);
    expect(b.text).toMatch(/slots/u);
  });

  it('bad beats warn, and a nearly full drive is flagged', () => {
    const s = snap({
      devices: [dev({ kind: 'cpu', name: 'Tiny CPU', throttle: 0.7 })],
      storage: [drive({ usedBytes: 99_000 }), drive({ deviceId: 'd2', slot: 'sata1', hasOs: false, burnt: true })],
      os: os(),
    });
    const rows = resourceRows(s);
    const diskD1Row = rows.find((r) => r.id === 'disk:d1');
    assert.exists(diskD1Row);
    expect(diskD1Row.level).toBe('warn');
    expect(bottleneck(rows)).toMatchObject({ id: 'disk:d2', level: 'bad' });
  });
});

describe('OS panel: spool settings', () => {
  it('is absent without an OS', () => {
    expect(spoolModel(snap())).toBeNull();
  });
  it('shows automatic as the most the OS allows, and a set number otherwise', () => {
    const auto = spoolModel(snap({ os: os() }));
    assert.exists(auto);
    expect(auto).toMatchObject({ auto: true, wanted: 8, max: 8, slots: 4 });
    const config2 = os().config;
    assert.exists(config2);
    const set = spoolModel(snap({ os: os({ config: { ...config2, spoolWanted: 3 } }) }));
    assert.exists(set);
    expect(set).toMatchObject({ auto: false, wanted: 3 });
  });
  it('a change waits for the next power-on while the machine runs', () => {
    const spoolModelResult = spoolModel(snap({ os: os(), powered: true }));
    assert.exists(spoolModelResult);
    expect(spoolModelResult.pending).toBe(true);
    const spoolModelResult2 = spoolModel(snap({ os: os(), powered: false }));
    assert.exists(spoolModelResult2);
    expect(spoolModelResult2.pending).toBe(false);
  });
  it('a drive with a reason cannot be switched on, but one that is on can always be switched off', () => {
    const cfg = os().config;
    assert.exists(cfg);
    assert.exists(cfg.drives[0]);
    const m = spoolModel(
      snap({
        os: os({
          config: {
            ...cfg,
            drives: [
              { ...cfg.drives[0], why: 'not formatted clean', on: true },
              { ...cfg.drives[0], deviceId: 'd2', why: 'not formatted clean', on: false },
            ],
          },
        }),
      }),
    );
    assert.exists(m);
    assert.exists(m.drives[0]);
    expect(m.drives[0].canToggle).toBe(true);
    assert.exists(m.drives[1]);
    expect(m.drives[1].canToggle).toBe(false);
  });
});
