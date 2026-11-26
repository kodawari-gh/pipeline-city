import { assert, describe, expect, it } from 'vitest';
import { BLOCK_BYTES } from '@/core/sim/memmap';
import { CONTRACT_KINDS, datasetBytes } from '../../economy/sim/contracts';
import type * as contractsTypes from '../../economy/sim/contracts';
import { ECONOMY } from '../../economy/sim/economy';
import { Game } from '@/worker/game/game';
import type * as gameTypes from '@/worker/game/game';
import { parseSave } from '@/worker/game/save';
import { rig } from '@/worker/game/testkit';

// Hardware tests, not level tests.
ECONOMY.levelGating = false;
ECONOMY.caseGating = false;

/** A save written out as JSON text and read back the way a loaded file is: through the parser. */
const json = (save: ReturnType<Game['toSave']>) => {
  const text = JSON.stringify(save);
  return parseSave(JSON.parse(text));
};

/** A save as the plain JSON data a file holds, before any parsing. */
const jsonData = (save: unknown): unknown => {
  const text = JSON.stringify(save);
  return JSON.parse(text);
};

/** The field `key` of JSON object or array `node`, checked to be one. */
function childOf(node: unknown, key: string | number): unknown {
  if (typeof node !== 'object' || node === null) {
    throw new TypeError(`nothing to read ${key} from`);
  }
  return Object.entries(node).find(([k]) => k === String(key))?.[1];
}

/** `save` as JSON data with the value at `path` replaced: what a hand-edited or damaged file would hold. */
function corrupt(save: unknown, path: readonly (string | number)[], value: unknown): unknown {
  const root = jsonData(save);
  let node = root;
  for (const key of path.slice(0, -1)) {
    node = childOf(node, key);
  }
  if (typeof node !== 'object' || node === null) {
    throw new TypeError(`nothing at ${path.join('.')}`);
  }
  Object.assign(node, { [String(path.at(-1))]: value });
  return root;
}

const sysRecords = (d: { fs: { records: () => { kind: string }[] } }) =>
  d.fs.records().filter((r) => r.kind === 'os' || r.kind === 'spool');
const isSeed5Dataset = (f: { kind: string; seed?: number }): boolean => f.kind === 'dataset' && f.seed === 5;
const ticks = (g: Game, n: number): void => {
  for (let i = 0; i < n; i++) {
    g.advanceBaseTick();
  }
};
function runUntil(g: Game, phase: gameTypes.Phase, max = 4000): void {
  let t = 0;
  while (g.currentPhase() !== phase && t++ < max) {
    g.advanceBaseTick();
  }
  expect(g.currentPhase()).toBe(phase);
}

/** An OS rig (HDD) at level 4 plus a formatted data drive `spec`, booted. */
function setup(spec: 'ssd1' | 'raid2' = 'ssd1', fsTier = 2): { g: Game; id: string } {
  const g = rig('hdd0', { startLevel: 4 });
  if (g.powered) {
    g.powerButton();
  }
  assert.exists(g.os);
  g.os.spec = { ...g.os.spec, fsTier };
  const b = g.purchase(spec);
  if (!b.ok) {
    throw new Error(b.reason);
  }
  expect(g.install(b.invId).ok).toBe(true);
  const foundDevice = g.board.devices.find((d) => d.spec === spec);
  assert.exists(foundDevice);
  const { id } = foundDevice;
  expect(g.formatDrive(id)).toMatchObject({ ok: true });
  g.powerButton();
  runUntil(g, 'idle-os');
  return { g, id };
}

const offerOf = (g: Game, over: Partial<contractsTypes.ContractOffer> = {}): contractsTypes.ContractOffer => {
  assert.exists(CONTRACT_KINDS[0]);
  const o: contractsTypes.ContractOffer = {
    id: g.nextContractId++,
    offeredAt: g.baseTick,
    expiresAt: g.baseTick + 100_000,
    kind: 'cloud.archive',
    client: 'Acme Archives',
    seed: 5,
    blocks: 16,
    duration: 5000,
    readEvery: 100_000,
    readDeadline: 40,
    readTicks: 4,
    minDriveTier: CONTRACT_KINDS[0].minDriveTier,
    levelPay: 1,
    maxMisses: 3,
    ...over,
  };
  g.contractOffers.push(o);
  return o;
};

/** Reload through JSON and `parseSave`, as the main thread does. */
const reload = (g: Game): Game => Game.fromSave(json(g.toSave()));

describe('saving the drives', () => {
  it('a fresh OS game writes no contracts block', () => {
    const g = rig('hdd0');
    const s = g.toSave();
    expect(
      s.disks?.every((d) => {
        assert.exists(g.os);
        return d.deviceId === g.os.deviceId;
      }),
    ).toBe(true);
    expect(s.contracts).toBeUndefined();
  });

  it('round-trips datasets: ledger, used blocks, mount flag, and bytes regenerated from the seed', () => {
    const { g, id } = setup();
    const disk = g.disks.get(id);
    assert.exists(disk);
    const o = offerOf(g);
    expect(g.acceptContract(o.id, id).ok).toBe(true);
    const [c] = g.contracts;
    assert.exists(c);
    const before = disk.fs.records();
    const used = disk.usedBlocks;
    const bytes = disk.fs.read(c.fileId);
    assert.exists(bytes);
    expect(bytes).toStrictEqual(datasetBytes(5, 16));
    const disks2 = g.toSave().disks;
    assert.exists(disks2);
    const foundDisks2 = disks2.find((d) => d.deviceId === id);
    assert.exists(foundDisks2);
    expect(foundDisks2.files.some(isSeed5Dataset)).toBe(true);
    const text = JSON.stringify(g.toSave());
    expect(text.length).toBeLessThan(40_000); // records, never the bytes of a 96K drive
    const l = reload(g);
    const ld = l.disks.get(id);
    assert.exists(ld);
    expect(ld.fs.records()).toStrictEqual(before);
    expect(ld.usedBlocks).toBe(used);
    expect(ld.mount).toBe('clean');
    expect(ld.fs.read(c.fileId)).toStrictEqual(bytes);
    expect(ld.fs.fragmentation()).toBe(disk.fs.fragmentation());
    expect(ld.fs.runs()).toStrictEqual(disk.fs.runs());
  });

  it('round-trips wear, bad groups, a lost file and a dirty mount', () => {
    const { g, id } = setup();
    const disk = g.disks.get(id);
    assert.exists(disk);
    const a = disk.fs.create('c1', 'dataset', 8, { seed: 11 });
    assert.exists(a);
    const b = disk.fs.create('c2', 'dataset', 8, { seed: 12 });
    assert.exists(b);
    for (let i = 0; i < 50; i++) {
      disk.noteWrite(0);
    }
    assert.exists(b.extents[0]);
    disk.failGroup(Math.floor(b.extents[0].first / 8));
    expect(b.lost).toBe(true);
    disk.mount = 'dirty';
    const { wearPct } = disk;
    const l = reload(g);
    const ld = l.disks.get(id);
    assert.exists(ld);
    expect(ld.badGroups).toBe(1);
    expect(ld.wear[0]).toBe(disk.wear[0]);
    expect(ld.wearPct).toBeCloseTo(wearPct);
    const fileResult = ld.fs.file(b.id);
    assert.exists(fileResult);
    expect(fileResult.lost).toBe(true);
    const fileResult2 = ld.fs.file(a.id);
    assert.exists(fileResult2);
    expect(fileResult2.lost).toBe(false);
    expect(ld.fs.lostBlocks()).toBe(8);
    expect(ld.mount).toBe('dirty');
    expect(ld.fs.runs().some((r) => r.kind === 'lost')).toBe(true);
    expect(ld.fs.read(b.id)).toBeNull();
    // the media's mechanical stream and per-group limits are the same after a load
    expect(ld.mediaState()).toStrictEqual(disk.mediaState());
    expect(ld.limitOf(3)).toBe(disk.limitOf(3));
  });

  it("round-trips a mirrored module: both members' wear and bad groups", () => {
    const { g, id } = setup('raid2', 4);
    const disk = g.disks.get(id);
    assert.exists(disk);
    const f = disk.fs.create('c1', 'dataset', 8, { seed: 3 });
    assert.exists(f);
    disk.noteWrite(0);
    assert.exists(f.extents[0]);
    disk.failGroup(Math.floor(f.extents[0].first / 8));
    const l = reload(g);
    const ld = l.disks.get(id);
    assert.exists(ld);
    expect(ld.twin).not.toBeNull();
    expect(ld.badGroups).toBe(1);
    assert.exists(ld.twin);
    expect(ld.twin.badGroups).toBe(0);
    expect(ld.twin.wear[0]).toBe(1);
    const fileResult3 = ld.fs.file(f.id);
    assert.exists(fileResult3);
    expect(fileResult3.lost).toBe(false); // survives one member
    ld.twin.failGroup(Math.floor(f.extents[0].first / 8));
    const fileResult4 = ld.fs.file(f.id);
    assert.exists(fileResult4);
    expect(fileResult4.lost).toBe(true);
  });

  it('the OS drive keeps its datasets and recreates its boot image and spool', () => {
    const { g } = setup();
    assert.exists(g.os);
    const id = g.os.deviceId;
    const disk = g.disks.get(id);
    assert.exists(disk);
    const f = disk.fs.create('c9', 'dataset', 8, { seed: 9 });
    assert.exists(f);
    const l = reload(g);
    const ld = l.disks.get(id);
    assert.exists(ld);
    expect(ld.fs.list('os')).toHaveLength(1);
    expect(ld.fs.list('spool')).toHaveLength(1);
    expect(ld.fs.file(f.id)).toMatchObject({ kind: 'dataset', owner: 'c9', seed: 9 });
    expect(sysRecords(ld)).toStrictEqual(sysRecords(disk));
    // it still boots
    l.powerButton();
    runUntil(l, 'idle-os');
  });
});

describe('saving contracts', () => {
  it("keeps offers, running contracts, ids and the offers' stream; the hold carries on after a load", () => {
    const { g, id } = setup();
    offerOf(g);
    const o2 = offerOf(g, { kind: 'cloud.hot', minDriveTier: 1, blocks: 12, seed: 77, duration: 3000 });
    g.acceptContract(o2.id, id);
    ticks(g, 50);
    const [c] = g.contracts;
    assert.exists(c);
    const s = json(g.toSave());
    assert.exists(s.contracts);
    expect(s.contracts.offers).toHaveLength(1);
    expect(s.contracts.active).toHaveLength(1);
    const l = Game.fromSave(s);
    expect(l.contractOffers).toStrictEqual(g.contractOffers);
    expect(l.contracts[0]).toMatchObject({
      id: c.id,
      deviceId: c.deviceId,
      fileId: c.fileId,
      rng: c.rng,
      nextRead: c.nextRead,
      served: c.served,
      earned: c.earned,
    });
    expect(l.nextContractId).toBe(g.nextContractId);
    expect(l.contractRng.getState()).toBe(g.contractRng.getState());
    // the OS tier override of this test is not saved: set it again, then run on
    assert.exists(l.os);
    l.os.spec = { ...l.os.spec, fsTier: 2 };
    l.powerButton();
    runUntil(l, 'idle-os');
    assert.exists(l.contracts[0]);
    const [{ rate }] = l.contracts;
    const { money } = l;
    ticks(l, 100);
    expect(l.contracts).toHaveLength(1);
    expect(l.money).toBeGreaterThanOrEqual(money + Math.floor(100 * rate) - 2);
    expect(l.canServe(c.deviceId, c.fileId)).toBe(true);
  });

  it('log outcomes of contracts survive a save', () => {
    const { g, id } = setup();
    const o = offerOf(g, { duration: 20 });
    g.acceptContract(o.id, id);
    ticks(g, 30);
    const foundJobLog = g.jobLog.find((e) => e.contract);
    assert.exists(foundJobLog);
    expect(foundJobLog.outcome).toBe('completed');
    const l = reload(g);
    const e = l.jobLog.find((x) => x.contract);
    assert.exists(e);
    expect(e).toMatchObject({ outcome: 'completed', type: 'cloud.archive' });
    expect(e.contract).toMatchObject({ client: 'Acme Archives', blocks: 16 });
  });
});

describe('old saves', () => {
  it('a save without disks and contracts loads: the OS drive is recreated, data drives are blank, no contracts', () => {
    const { g, id } = setup();
    const o = offerOf(g);
    g.acceptContract(o.id, id);
    const s = json(g.toSave());
    delete s.disks;
    delete s.contracts;
    const l = Game.fromSave(s);
    expect(l.contracts).toHaveLength(0);
    expect(l.contractOffers).toHaveLength(0);
    expect(l.nextContractId).toBe(1);
    assert.exists(l.os);
    const os = l.disks.get(l.os.deviceId);
    assert.exists(os);
    expect(os.mount).toBe('clean');
    expect(os.fs.list('os')).toHaveLength(1);
    expect(os.fs.list('spool')).toHaveLength(1);
    const foundDevice2 = l.board.devices.find((d) => d.id === id);
    assert.exists(foundDevice2);
    const data = l.diskFor(foundDevice2);
    expect(data.mount).toBe('unformatted');
    expect(data.fs.list()).toHaveLength(0);
    expect(data.badGroups).toBe(0);
    expect(l.toSave().version).toBe(5);
  });

  it('an old fixture with no contract, disk or wear fields passes parseSave unchanged', () => {
    const g = new Game({ seed: 4 });
    const s = jsonData(g.toSave());
    expect(s).not.toHaveProperty('disks');
    expect(s).not.toHaveProperty('contracts');
    expect(parseSave(s)).toStrictEqual(s);
  });
});

describe('validation', () => {
  it('rejects a malformed disk or contract block with a clear message', () => {
    const s = setup().g.toSave();
    expect(() => parseSave(corrupt(s, ['disks'], 'no'))).toThrow(/disks/u);
    expect(() =>
      parseSave(
        corrupt(s, ['disks'], [{ deviceId: 'nope', mount: 'clean', files: [], media: { wear: [], bad: [], rng: 1 } }]),
      ),
    ).toThrow(/deviceId/u);
    expect(() => parseSave(corrupt(s, ['disks', 0, 'mount'], 'weird'))).toThrow(/mount/u);
    expect(() =>
      parseSave(corrupt(s, ['disks', 0, 'files'], [{ id: 0, owner: 'c', kind: 'dataset', extents: [[0, 1]] }])),
    ).toThrow(/files\[0\]/u);
    expect(() =>
      parseSave(corrupt(s, ['disks', 0, 'files'], [{ id: 1, owner: 'c', kind: 'movie', extents: [[0, 1]] }])),
    ).toThrow(/files\[0\]/u);
    expect(() => parseSave(corrupt(s, ['disks', 0, 'media'], { wear: [[1]], bad: [], rng: 1 }))).toThrow(/media/u);
    expect(() => parseSave(corrupt(s, ['contracts'], { nextId: 0, rng: 1, offers: [], active: [] }))).toThrow(
      /contracts/u,
    );
    expect(() =>
      parseSave(
        corrupt(s, ['contracts'], {
          nextId: 2,
          rng: 1,
          offers: [{ id: 1, offeredAt: 0, expiresAt: 5, kind: 'cloud.nope' }],
          active: [],
        }),
      ),
    ).toThrow(/kind/u);
  });

  it('accepts a good save with datasets and a contract', () => {
    const { g, id } = setup();
    g.acceptContract(offerOf(g).id, id);
    expect(() => parseSave(json(g.toSave()))).not.toThrow();
  });

  it('a record that no longer fits the drive is dropped, not fatal', () => {
    const { g, id } = setup();
    const diskValue = g.disks.get(id);
    assert.exists(diskValue);
    diskValue.fs.create('c1', 'dataset', 8, { seed: 1 });
    const s = json(g.toSave());
    assert.exists(s.disks);
    const sd = s.disks.find((d) => d.deviceId === id);
    assert.exists(sd);
    assert.exists(sd.files[0]);
    sd.files.push(
      { id: 50, owner: 'x', kind: 'dataset', extents: [[100_000, 8]] },
      { id: sd.files[0].id, owner: 'dup', kind: 'dataset', extents: [[0, 1]] },
    );
    const l = Game.fromSave(s);
    const diskValue2 = l.disks.get(id);
    assert.exists(diskValue2);
    expect(diskValue2.fs.list('dataset')).toHaveLength(1);
  });
});

describe('ledger records', () => {
  it('write and read move bytes through the extents without bus traffic', () => {
    const { g, id } = setup();
    const disk = g.disks.get(id);
    assert.exists(disk);
    disk.fs.create('a', 'dataset', 3);
    const f = disk.fs.create('b', 'dataset', 3);
    assert.exists(f);
    const data = new Uint8Array(3 * BLOCK_BYTES).map((_, i) => i % 251);
    const before = disk.bytesWritten;
    expect(disk.fs.write(f.id, data)).toBe(data.length);
    expect(disk.fs.read(f.id)).toStrictEqual(data);
    expect(disk.bytesWritten).toBe(before);
    disk.fs.lose(f.id);
    expect(disk.fs.read(f.id)).toBeNull();
    expect(disk.fs.write(f.id, data)).toBe(0);
  });
});
