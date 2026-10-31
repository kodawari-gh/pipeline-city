import { describe, expect, it } from 'vitest';
import type { ContractOfferSnap, ContractSnap } from '../../sim/game/types';
import type { JobLogEntry } from '../../sim/game/joblog';
import { activeView, finishedView, fmtRate, fmtSize, offerView, splitLog } from './contractui';

const offer = (o: Partial<ContractOfferSnap> = {}): ContractOfferSnap => ({
  id: 1, kind: 'cloud.archive', name: 'Cold archive', client: 'Acme Archives', hot: false, bytes: 4096, duration: 600, readEvery: 100, minDriveTier: 0,
  rate: 0.77, mirrorRate: 1.15, fee: 6, penalty: 192, expiresIn: 300, canAccept: true, why: null, deviceId: 'd1',
  drives: [{ deviceId: 'd1', name: 'HDD 96K', why: null }, { deviceId: 'd2', name: 'SATA SSD 64K', why: null }, { deviceId: 'd3', name: 'NVMe SSD 128K', why: 'is not mounted' }], ...o,
});
const active = (c: Partial<ContractSnap> = {}): ContractSnap => ({
  id: 2, kind: 'cloud.archive', name: 'Cold archive', client: 'Acme Archives', hot: false, deviceId: 'd1', drive: 'HDD 96K', bytes: 4096, mirrored: false, duration: 600, left: 150,
  health: 'ok', nextRead: 40, pending: 0, served: 3, missed: 0, maxMisses: 3, rate: 0.77, earned: 120, fees: 6, ...c,
});

describe('contract cards', () => {
  it('sizes and rates read plainly', () => {
    expect(fmtSize(4096)).toBe('4K');
    expect(fmtSize(6144)).toBe('6K');
    expect(fmtSize(1536)).toBe('1.5K');
    expect(fmtRate(0.77)).toBe('$0.77/s');
    expect(fmtRate(0.5)).toBe('$0.5/s');
    expect(fmtRate(25)).toBe('$25/s');
  });

  it('an offer shows size, time, pay and fee, and the button works only when a drive can hold it', () => {
    const v = offerView(offer());
    expect(v.facts.map((f) => f.text)).toEqual(['4K', '10m 00s', '$0.77/s', '$6 per missed read']);
    expect(v.accept).toEqual({ enabled: true, why: null });
    expect(v.choices.map((c) => c.name)).toEqual(['HDD 96K', 'SATA SSD 64K']);
    const blocked = offerView(offer({ canAccept: false, why: 'the OS must be up: power the machine on', deviceId: null }));
    expect(blocked.accept.enabled).toBe(false);
    expect(blocked.accept.why).toMatch(/OS must be up/);
    expect(blocked.tone).toBe('lost');
  });

  it('a hot offer says it needs an SSD', () => {
    expect(offerView(offer({ hot: true, minDriveTier: 1 })).facts.some((f) => /SSD/.test(f.text))).toBe(true);
    expect(offerView(offer()).facts.some((f) => /SSD/.test(f.text))).toBe(false);
  });

  it('the pay for mirrored storage is in the pay tooltip', () => {
    expect(offerView(offer()).facts[2]!.title).toMatch(/\$1\.15\/s/);
  });

  it('a running contract shows health, progress, the next read and the misses', () => {
    const v = activeView(active());
    expect(v.health).toMatchObject({ tone: 'compute', label: 'Serving' });
    expect(v.progress).toBeCloseTo(0.75);
    expect(v.nextRead).toBe('next read in 40s');
    expect(v.misses).toBe('0/3 missed');
    expect(v.atRisk).toBe(false);
    expect(activeView(active({ missed: 2 })).atRisk).toBe(true);
    expect(activeView(active({ pending: 2 })).nextRead).toBe('2 reads waiting');
    expect(activeView(active({ health: 'unservable' })).health.tone).toBe('queue');
    expect(activeView(active({ health: 'lost' })).health).toMatchObject({ tone: 'lost', label: 'Data lost' });
    expect(activeView(active({ mirrored: true })).mirrored).toBe(true);
  });

  const entry = (o: Partial<JobLogEntry>): JobLogEntry => ({
    id: 1_000_002, type: 'cloud.archive', scale: 1, outcome: 'completed', arrival: 0, start: 0, finish: 600, end: 600, deadline: 600, payout: 140, late: false, attempts: 1, os: 2,
    contract: { client: 'Acme Archives', drive: 'HDD 96K', blocks: 16, mirrored: false, served: 5, missed: 1, earned: 150, fees: 10 }, ...o,
  });

  it('the log is split into jobs and finished contracts, newest contract first', () => {
    const job: JobLogEntry = { id: 4, type: 'log', scale: 1, outcome: 'done', arrival: 0, start: 0, finish: 5, end: 6, deadline: 100, payout: 30, late: false, attempts: 1, os: 1 };
    const { jobs, contracts } = splitLog([job, entry({ end: 100, id: 1_000_001 }), entry({ end: 900 })]);
    expect(jobs).toEqual([job]);
    expect(contracts.map((e) => e.end)).toEqual([900, 100]);
  });

  it('a finished contract reads as held, lost or breached with its net money', () => {
    expect(finishedView(entry({}))).toMatchObject({ label: 'Held', tone: 'compute', net: '$140' });
    expect(finishedView(entry({}) ).detail).toMatch(/5 reads served, 1 missed, on HDD 96K/);
    expect(finishedView(entry({ outcome: 'lost', payout: -90 }))).toMatchObject({ label: 'Data lost', tone: 'lost', net: '-$90' });
    expect(finishedView(entry({ outcome: 'breached', type: 'cloud.hot' })).title).toMatch(/hot/);
  });
});
