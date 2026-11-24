import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import { dev, snap } from '@/core/ui/testdata';
import { builtinTheme } from '@/core/render/theme';
import { quietCanvas } from '../../../board/render/three/testutil';
import { NicView } from './nicview';

quietCanvas();

const ROUTER = { id: 'router2', name: 'Gigabit router', mbps: 1000, clients: 4, visual: 'router-gbe' };
const ISP = { id: 'isp2', name: 'Cable', downMbps: 200, upMbps: 50, clients: 4 };

/** A running machine with a 10 GbE card in slot pcie1, the cable in it (or not), at tick `tick` with this many frames counted so far. */
function game(tick: number, rx: number, tx: number, plugged = true): Snapshot {
  const base = snap();
  return snap({
    baseTick: tick,
    powered: true,
    devices: [
      dev({ id: 'n1', spec: 'nic2', kind: 'nic', slot: 'pcie1', tempC: 41, powerW: 6.5, throttle: 1, burnt: false }),
    ],
    net: {
      ...base.net!,
      state: 'link-up',
      reason: null,
      port: plugged ? { kind: 'nic', deviceId: 'n1', mbps: 10000 } : { kind: null, deviceId: null, mbps: 0 },
      router: ROUTER,
      isp: ISP,
      bandwidth: { downMbps: 200, upMbps: 50, clients: 4, binding: 'isp' },
      transfers: [],
      uploadsWaiting: 0,
      frames: { rx, tx },
      counters: { delivered: 3, downloaded: 7, uploaded: 5, lost: 0 },
    },
  });
}

interface Launch {
  slot: string;
  dir: string;
  at: number;
  total: number;
}
/** A view of the card in pcie1 that has read two snapshots (a tick apart: `rx` and `tx` frames came in that tick), and records what it launches; `lead` is what the copper answers. */
function view(
  rx: number,
  tx: number,
  o: { plugged?: boolean; lead?: number } = {},
): { v: NicView; launches: Launch[]; packets: () => { t0: number }[] } {
  const v = new NicView(),
    launches: Launch[] = [];
  v.setScene(builtinTheme(), [{ slot: 'pcie1', visual: 'nic-10g', index: 1 }]);
  v.onLaunch = (slot, dir, at, total) => {
    launches.push({ slot, dir, at, total });
    return o.lead ?? 0;
  };
  v.update(game(1, 0, 0, o.plugged ?? true));
  v.update(game(2, rx, tx, o.plugged ?? true));
  return { v, launches, packets: () => (v as unknown as { cards: { packets: { t0: number }[] }[] }).cards[0]!.packets };
}

describe("the NIC die's view launches the card's frames", () => {
  it("launches a frame for each way that carries frames, on the view's clock, whether the die is seen or not", () => {
    const { v, launches } = view(1000, 100);
    expect(v.clock).toBe(0);
    v.frame(0.016, true);
    expect(v.clock).toBeCloseTo(16, 6);
    expect(launches.map((l) => l.dir).sort()).toEqual(['rx', 'tx']);
    for (const l of launches) {
      expect(l.slot).toBe('pcie1');
      expect(l.at).toBeCloseTo(16, 6);
      // (a frame takes 0.8 s through the die when the lane is full, 1.5 s when it is nearly quiet)
      expect(l.total).toBeGreaterThanOrEqual(800);
      expect(l.total).toBeLessThanOrEqual(1500);
    }
    // the busier way goes through quicker
    const rx = launches.find((l) => l.dir === 'rx')!,
      tx = launches.find((l) => l.dir === 'tx')!;
    expect(rx.total).toBeLessThan(tx.total);
  });

  it('launches again only once the gap has passed, closer together the busier the way', () => {
    const { v, launches } = view(1000, 0);
    v.frame(0.016, true);
    expect(launches).toHaveLength(1);
    v.frame(0.016, true);
    expect(launches).toHaveLength(1);
    v.frame(0.4, true);
    expect(launches).toHaveLength(1);
    // (the way's gap is 1800 ms less 1500 of its activity: not yet over by 0.4 s, long over by 2 s)
    v.frame(2, true);
    expect(launches).toHaveLength(2);
    expect(launches[1]!.at).toBeGreaterThan(launches[0]!.at + 300);
    expect(launches.every((l) => l.dir === 'rx')).toBe(true);
  });

  it('launches nothing with no cable in this card, nothing for a quiet link and nothing with the clock held by a pause past its first launch', () => {
    const unplugged = view(1000, 100, { plugged: false });
    unplugged.v.frame(0.016, true);
    expect(unplugged.launches).toEqual([]);
    const quiet = view(0, 0);
    quiet.v.frame(0.016, true);
    expect(quiet.launches).toEqual([]);
    // (paused, the clock holds: the one launch already out is all there is)
    const held = view(1000, 0);
    held.v.frame(0.016, true, true);
    held.v.frame(0.016, true, true);
    held.v.frame(2, true, true);
    expect(held.launches).toHaveLength(1);
    expect(held.v.clock).toBe(0);
  });

  it("makes the die's packets wait for the copper's answer, and makes none when the die is not seen", () => {
    const away = view(1000, 0, { lead: 250 });
    away.v.frame(0.016, true);
    expect(away.launches).toHaveLength(1);
    expect(away.packets()).toHaveLength(0);
    const seen = view(1000, 0, { lead: 250 });
    seen.v.setSight('pcie1', { zoom: 1, view: null, shown: true });
    seen.v.frame(0.016, true);
    const at = seen.launches[0]!.at,
      packets = seen.packets();
    expect(packets.length).toBeGreaterThan(1);
    // the first hop leaves the die's edge when the frame gets there; each next one follows it
    expect(packets[0]!.t0).toBeCloseTo(at + 250, 6);
    for (let i = 1; i < packets.length; i++) expect(packets[i]!.t0).toBeGreaterThan(packets[i - 1]!.t0);
    // with no copper to answer, the die's own frame starts at once
    const bare = view(1000, 0);
    bare.v.setSight('pcie1', { zoom: 1, view: null, shown: true });
    bare.v.frame(0.016, true);
    expect(bare.packets()[0]!.t0).toBeCloseTo(bare.launches[0]!.at, 6);
  });
});
