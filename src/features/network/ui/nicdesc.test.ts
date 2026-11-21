import { describe, expect, it } from 'vitest';
import type { Snapshot } from '@/worker/game/game';
import { describeId } from '@/core/ui/logic';
import { dev, snap } from '@/core/ui/testdata';
import { setLayoutTier } from '../../board/render/layout/layout';
import { nicIds } from '../render/nic/niclayout';
import { isNicId } from './nicdesc';

const CARDS = [['nic1', 'nic-gbe', 1000], ['nic2', 'nic-10g', 10000], ['nic3', 'nic-40g', 40000]] as const;
const ROUTER = { id: 'router4', name: 'Core router', mbps: 40000, clients: 16, visual: 'router-core' };

/** A running machine with the card `spec` in slot pcie1, the cable in it (or in no card), over a router. */
function game(spec: string, mbps: number, plugged = true): Snapshot {
  const base = snap();
  return snap({
    powered: true, power: { ...base.power, tripped: false },
    devices: [dev({ id: 'n1', spec, kind: 'nic', slot: 'pcie1', tempC: 52, powerW: 7.5 })],
    net: {
      ...base.net!, state: plugged ? 'link-up' : 'no-cable', reason: plugged ? null : 'no cable', port: plugged ? { kind: 'nic', deviceId: 'n1', mbps } : { kind: null, deviceId: null, mbps: 0 }, router: ROUTER,
      isp: { id: 'isp5', name: 'Backbone', downMbps: 20000, upMbps: 10000, clients: 32 }, bandwidth: { downMbps: 2000, upMbps: 2000, clients: 16, binding: 'disk' },
      transfers: [{ jobId: 4, label: '#4 db', dir: 'down', totalMB: 80, doneMB: 20, percent: 25, etaTicks: 6, persisted: false }], uploadsWaiting: 2, frames: { rx: 123456, tx: 61728 }, counters: { delivered: 9, downloaded: 11, uploaded: 7, lost: 0 },
    },
  });
}

describe('the words for the network card\'s parts', () => {
  setLayoutTier(3, 3);

  it('describes every part the board draws, with the card in the game and without a game', () => {
    for (const [spec, visual, mbps] of CARDS) {
      const ids = nicIds(visual, 'pcie1', 1);
      expect(ids.length, visual).toBeGreaterThanOrEqual(14);
      for (const id of ids) {
        expect(isNicId(id), id).toBe(true);
        for (const d of [describeId(id, game(spec, mbps)), describeId(id, game(spec, mbps, false)), describeId(id, snap()), describeId(id)]) {
          expect(d, `${visual} ${id}`).not.toBeNull();
          expect(d!.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d!.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d!.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('says what the card is doing now, from the snapshot', () => {
    const s = game('nic2', 10000);
    expect(describeId('pcie1.nic-jack', s)!.nerd).toMatch(/link up, 10 Gbit/);
    expect(describeId('pcie1.nic-phy', s)!.nerd).toMatch(/10GBASE-T.*link up, 10 Gbit.*rated 10 Gbit/);
    expect(describeId('pcie1.nic-stats', s)!.nerd).toMatch(/rx 123 k frames.*tx 62 k frames/);
    expect(describeId('pcie1.nic-rxq', s)!.nerd).toMatch(/1 downloads in flight.*11 downloaded/);
    expect(describeId('pcie1.nic-txq', s)!.nerd).toMatch(/0 uploads in flight.*2 results wait.*7 uploaded/);
    expect(describeId('pcie1.nic-temp', s)!.nerd).toMatch(/^52 C \| half speed from \d+ C/);
    expect(describeId('pcie1.nic-vreg', s)!.nerd).toMatch(/7\.5 W now \| 5 W idle, 11 W at full load/);
    expect(describeId('pcie1.nic-pcie', s)!.nerd).toMatch(/x4, 8 pairs/);
    expect(describeId('pcie1.nic-ctl', s)!.nerd).toMatch(/10GbE card \| RL-N510, 10GBASE-T/);
  });

  it('says so when the cable is not in this card, and gives the plan\'s own words with no game', () => {
    expect(describeId('pcie1.nic-jack', game('nic2', 10000, false))!.nerd).toMatch(/no cable in this card/);
    expect(describeId('pcie1.nic-stats', game('nic2', 10000, false))!.nerd).toMatch(/counters/);
    expect(describeId('pcie1.nic-jack')!.nerd).toMatch(/no game/);
    expect(describeId('pcie1.nic-nvm')!.nerd).toMatch(/MAC 00:1B:21:/);
    expect(describeId('pcie1.nic-pcie')!.nerd).toMatch(/lanes by tier/);
  });

  it('warns of a card that runs at half speed', () => {
    const s = game('nic2', 10000);
    s.devices[0] = { ...s.devices[0]!, tempC: 97, throttle: 0.5 };
    expect(describeId('pcie1.nic-temp', s)!.nerd).toMatch(/HALF SPEED NOW/);
  });

  it('ignores ids that are not its parts', () => {
    for (const id of ['pcie1.nic-nonsense', 'pcie1.nic-', 'nic-mac', 'cpu.nic-mac']) {
      expect(isNicId(id), id).toBe(false);
      expect(describeId(id, game('nic2', 10000)), id).toBeNull();
    }
    // the other cards' ids are theirs: a card in the same slot keeps its own words
    for (const id of ['pcie1.mac', 'pcie1.regs', 'pcie1.pcie']) expect(isNicId(id), id).toBe(false);
    expect(isNicId('pcie0.nic-mac')).toBe(true);
    expect(isNicId('pcie12.nic-dma')).toBe(true);
  });
});
