import { describe, expect, it } from 'vitest';
import type { StorageCmd } from '../sim/storage';
import { channelOf, DiskPlayer, dieOf, scriptFor, stepAt, trackAt, turnLeft } from './diskplayer';
import { diskPlan } from './diskfloor';

const cmd = (o: Partial<StorageCmd> = {}): StorageCmd => ({ seq: 1, op: 'r', lba: 100, seek: 0, xfer: 4, queued: 0, ...o });
const SATA = diskPlan('ssd-sata', 520, 344, 64), NVME = diskPlan('ssd-nvme', 700, 300, 64), HDD = diskPlan('hdd', 640, 444, 48);

describe('the script of a command', () => {
  it('a flash read goes host, controller, map, channel, die, back up the channel, out to the host', () => {
    const s = scriptFor('ssd-sata', SATA, cmd(), 0, 512);
    expect(s.steps.map((x) => x.kind)).toEqual(['cmd', 'lookup', 'send', 'array', 'return', 'status']);
    expect(s.steps[0]!.links).toEqual([{ id: 'iface-ctrl', rev: false }]);
    const { die } = dieOf(SATA, Math.floor(100 / 8));
    expect(s.steps[2]!.links).toEqual([{ id: `ch${die}`, rev: false }]);
    expect(s.steps[3]!.blocks).toEqual([`nand${die}`]);
    expect(s.steps[4]!.links[0]!.rev).toBe(true);
    expect(s.steps[5]!.links).toEqual([{ id: 'iface-ctrl', rev: true }]);
  });

  it('a write carries its data on the way in and only a status on the way back', () => {
    const r = scriptFor('ssd-sata', SATA, cmd({ op: 'w' }), 0, 512), steps = r.steps;
    expect(steps.filter((x) => x.data).map((x) => x.kind)).toEqual(['cmd', 'lookup', 'send']);
    expect(steps.find((x) => x.kind === 'lookup')!.links[0]!.rev).toBe(false); // into the cache
    const rd = scriptFor('ssd-sata', SATA, cmd(), 0, 512);
    expect(rd.steps.filter((x) => x.data).map((x) => x.kind)).toEqual(['return', 'status']);
  });

  it('the NVMe takes the queue first and reaches a lower die over its channel and the stub', () => {
    const lba = 8 * 60; // a late cell: the lower row
    const s = scriptFor('ssd-nvme', NVME, cmd({ lba }), 0, 512);
    expect(s.steps[0]!.links.map((l) => l.id)).toEqual(['queue-ctrl', 'iface-ctrl']);
    expect(s.steps[0]!.blocks).toContain('queue');
    expect(channelOf('ssd-nvme', 6)).toEqual(['ch2', 'ch2b']);
    expect(channelOf('ssd-nvme', 2)).toEqual(['ch2']);
    expect(s.steps[2]!.links.map((l) => l.id)).toEqual(channelOf('ssd-nvme', s.die));
  });

  it('a hard disk seeks as long as the sim says, and a sequential block skips the seek', () => {
    const far = scriptFor('hdd', HDD, cmd({ lba: 400, seek: 300, xfer: 70 }), 0, 512);
    const seq = scriptFor('hdd', HDD, cmd({ lba: 5, seek: 0, xfer: 70 }), 0, 512);
    const sk = far.steps.find((x) => x.kind === 'seek')!;
    expect(far.steps.map((x) => x.kind)).toEqual(['cmd', 'lookup', 'seek', 'rotate', 'media', 'return']);
    expect(seq.steps.some((x) => x.kind === 'seek')).toBe(false);
    expect(sk.dur).toBeGreaterThan(far.total * 0.3);
    expect(far.toTrack).toBeGreaterThan(0);
    expect(far.steps.find((x) => x.kind === 'media')!.links[0]).toEqual({ id: 'ctrl-pre', rev: true }); // a read: preamp to controller
    expect(scriptFor('hdd', HDD, cmd({ op: 'w' }), 0, 512).steps.find((x) => x.kind === 'media')!.links[0]!.rev).toBe(false);
  });

  it('steps are in order, fill the total exactly, and the arm glides from the old track to the new', () => {
    const s = scriptFor('hdd', HDD, cmd({ lba: 480, seek: 200, xfer: 70 }), 0, 512);
    let at = 0;
    for (const x of s.steps) { expect(x.at).toBeCloseTo(at, 6); at += x.dur; }
    expect(at).toBeCloseTo(s.total, 6);
    const seek = s.steps.find((x) => x.kind === 'seek')!;
    expect(trackAt(s, 0)).toBe(0);
    expect(trackAt(s, seek.at + seek.dur / 2)).toBeCloseTo(s.toTrack / 2, 1);
    expect(trackAt(s, s.total)).toBe(s.toTrack);
    expect(stepAt(s, seek.at + 1).step.kind).toBe('seek');
    expect(turnLeft(s, 0)).toBe(1);
    expect(turnLeft(s, s.total)).toBe(0);
  });
});

describe('the player', () => {
  it('shows nothing moving until a command arrives, and ignores what ran before the first look', () => {
    const p = new DiskPlayer();
    p.ingest('ssd-sata', SATA, [cmd({ seq: 7 })], 512, 0);
    expect(p.playing).toBe(false);
    expect(p.step(100)).toEqual([]);
    p.ingest('ssd-sata', SATA, [cmd({ seq: 7 }), cmd({ seq: 8, op: 'w' })], 512, 0);
    const sent = p.step(16);
    expect(p.playing).toBe(true);
    expect(sent.map((x) => x.id)).toEqual(['iface-ctrl']);
    expect(sent[0]!.write).toBe(true);
  });

  it('plays the steps in order, sends the packets as each begins, and goes idle at the end', () => {
    const p = new DiskPlayer();
    p.ingest('ssd-sata', SATA, [], 512, 0);
    p.ingest('ssd-sata', SATA, [cmd({ seq: 1 })], 512, 0);
    const ids: string[] = [];
    for (let i = 0; i < 400; i++) ids.push(...p.step(10).map((x) => x.id));
    expect(ids[0]).toBe('iface-ctrl');
    expect(ids.filter((x) => x === 'iface-ctrl')).toHaveLength(2); // in, and out
    expect(ids.some((x) => x.startsWith('ch'))).toBe(true);
    expect(p.playing).toBe(false);
  });

  it('plays the commands one after another, and skips the oldest when too many wait', () => {
    const p = new DiskPlayer();
    p.ingest('ssd-sata', SATA, [], 512, 0);
    p.ingest('ssd-sata', SATA, Array.from({ length: 12 }, (_, i) => cmd({ seq: i + 1, lba: i * 8 })), 512, 0);
    p.step(1);
    expect(p.now!.script.cmd.seq).toBe(8); // seqs 1-7 were skipped
  });

  it('the arm stays where the last command left it', () => {
    const p = new DiskPlayer();
    p.ingest('hdd', HDD, [], 512, 0);
    p.ingest('hdd', HDD, [cmd({ seq: 1, lba: 500, seek: 150, xfer: 70 })], 512, 0);
    expect(p.track).toBe(0);
    for (let i = 0; i < 400; i++) p.step(10);
    expect(p.track).toBeGreaterThan(0);
    expect(p.playing).toBe(false);
  });
});
