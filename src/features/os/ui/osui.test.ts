import { describe, expect, it } from 'vitest';
import type { OsSnap, StorageSnap } from '@/worker/game/game';
import { dev, snap } from '@/core/ui/testdata';
import { bottleneck, resourceRows, spoolModel } from './osui';

const drive = (o: Partial<StorageSnap> = {}): StorageSnap => ({
  deviceId: 'd1', slot: 'sata0', spec: 'ssd1', name: 'SATA SSD', hasOs: true, burnt: false, capacityBytes: 100_000, usedBytes: 10_000,
  busy: false, bytesPerSecond: 50_000, queued: 0, queueDepth: 4, wearPct: 0, ...o,
} as StorageSnap);

const os = (o: Partial<OsSnap> = {}): OsSnap => ({
  spec: 'os2', tier: 2, name: 'Paged OS 2.0', deviceId: 'd1', slot: 'sata0', programSlots: 1, queueSlots: 4, up: true, queue: [], runningKeyId: null,
  spool: { slotBytes: 4096, slots: 4, used: 1, freeBytes: 0, full: false },
  config: { spoolWanted: null, spoolMax: 8, drives: [{ deviceId: 'd1', slot: 'sata0', name: 'SATA SSD', tier: 2, home: true, on: true, why: null, slots: 4, freeBytes: 90_000 }] },
  ...o,
} as OsSnap);

describe('OS panel: resource monitor', () => {
  it('lists the CPU, the regulator, each drive and the queue, and finds no bottleneck on a calm machine', () => {
    const s = snap({ devices: [dev({ kind: 'cpu', name: 'Tiny CPU', effectiveClock: 1 })], storage: [drive()], os: os() });
    const rows = resourceRows(s);
    expect(rows.map((r) => r.id)).toEqual(expect.arrayContaining(['cpu', 'vrm', 'disk:d1', 'queue']));
    expect(bottleneck(rows)).toBeNull();
  });

  it('names a throttled CPU as the bottleneck', () => {
    const s = snap({ devices: [dev({ kind: 'cpu', name: 'Tiny CPU', throttle: 0.7 })], storage: [drive()], os: os() });
    const b = bottleneck(resourceRows(s));
    expect(b).toMatchObject({ id: 'cpu', level: 'warn' });
    expect(b!.text).toMatch(/cooler/);
  });

  it('a full spool is the bottleneck and says how to add slots', () => {
    const s = snap({ storage: [drive()], os: os({ spool: { slotBytes: 4096, slots: 4, used: 4, freeBytes: 0, full: true } }) });
    const b = bottleneck(resourceRows(s));
    expect(b).toMatchObject({ id: 'queue' });
    expect(b!.text).toMatch(/slots/);
  });

  it('bad beats warn, and a nearly full drive is flagged', () => {
    const s = snap({
      devices: [dev({ kind: 'cpu', name: 'Tiny CPU', throttle: 0.7 })],
      storage: [drive({ usedBytes: 99_000 }), drive({ deviceId: 'd2', slot: 'sata1', hasOs: false, burnt: true })],
      os: os(),
    });
    const rows = resourceRows(s);
    expect(rows.find((r) => r.id === 'disk:d1')!.level).toBe('warn');
    expect(bottleneck(rows)).toMatchObject({ id: 'disk:d2', level: 'bad' });
  });
});

describe('OS panel: spool settings', () => {
  it('is absent without an OS', () => {
    expect(spoolModel(snap())).toBeNull();
  });
  it('shows automatic as the most the OS allows, and a set number otherwise', () => {
    const auto = spoolModel(snap({ os: os() }))!;
    expect(auto).toMatchObject({ auto: true, wanted: 8, max: 8, slots: 4 });
    const set = spoolModel(snap({ os: os({ config: { ...os().config!, spoolWanted: 3 } }) }))!;
    expect(set).toMatchObject({ auto: false, wanted: 3 });
  });
  it('a change waits for the next power-on while the machine runs', () => {
    expect(spoolModel(snap({ os: os(), powered: true }))!.pending).toBe(true);
    expect(spoolModel(snap({ os: os(), powered: false }))!.pending).toBe(false);
  });
  it('a drive with a reason cannot be switched on, but one that is on can always be switched off', () => {
    const cfg = os().config!;
    const m = spoolModel(snap({ os: os({ config: { ...cfg, drives: [
      { ...cfg.drives[0]!, why: 'not formatted clean', on: true },
      { ...cfg.drives[0]!, deviceId: 'd2', why: 'not formatted clean', on: false },
    ] } }) }))!;
    expect(m.drives[0]!.canToggle).toBe(true);
    expect(m.drives[1]!.canToggle).toBe(false);
  });
});
