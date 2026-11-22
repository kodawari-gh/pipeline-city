import { describe, expect, it } from 'vitest';
import { CAGE, jackOf, NIC_LANES } from '../../../board/render/three/niccopper';
import { NIC_FIFO } from '../../sim/specs';
import { BOARD_DIE, BOARD_LINK, NIC_DIE, NIC_LINK, boardLook, nicInput, nicPlan, type NicBlockKind } from './nicplan';
import { nicRoute, BLOCKS } from './nicroute';
import type { Rect } from '../plan/netplan';

const VISUALS = ['nic-gbe', 'nic-10g', 'nic-40g'];
const inside = (r: Rect, o: Rect): boolean => r.x >= o.x - 0.01 && r.y >= o.y - 0.01 && r.x + r.w <= o.x + o.w + 0.01 && r.y + r.h <= o.y + o.h + 0.01;
const apart = (a: Rect, b: Rect): boolean => a.x >= b.x + b.w - 0.01 || b.x >= a.x + a.w - 0.01 || a.y >= b.y + b.h - 0.01 || b.y >= a.y + a.h - 0.01;
const LEAVES: NicBlockKind[] = ['phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie', 'temp'];

describe('the controller\'s die as a floorplan', () => {
  it('is drawn for the three cards, square as a die is', () => {
    expect(NIC_DIE.w).toBe(NIC_DIE.h);
    for (const v of VISUALS) {
      const p = nicPlan(v);
      expect(p.die, v).toEqual({ x: 0, y: 0, w: NIC_DIE.w, h: NIC_DIE.h });
    }
  });

  it('has every block of the die once, and the controller\'s frame round its own', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v), ids = p.blocks.map((b) => b.id);
      expect(new Set(ids).size, v).toBe(ids.length);
      for (const k of LEAVES) expect(ids, `${v} ${k}`).toContain(k);
      expect(p.blocks.find((b) => b.id === 'ctl')!.frame, v).toBe(true);
      for (const k of LEAVES) expect(p.blocks.find((b) => b.id === k)!.parent, `${v} ${k}`).toBe('ctl');
      // (the jack, the crystal, the flash and the regulator are bodies of the 3D card, not blocks of the die)
      for (const k of ['jack', 'mag', 'nvm', 'xtal', 'vreg']) expect(ids, `${v} ${k}`).not.toContain(k);
    }
  });

  it('keeps every block inside the plan, and the blocks apart so a hover lands on one', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v), leaves = p.blocks.filter((b) => b.kind !== 'ctl');
      for (const b of p.blocks) expect(inside(b.rect, p.die), `${v} ${b.id}`).toBe(true);
      for (const b of leaves) expect(inside(b.rect, p.blocks.find((x) => x.id === 'ctl')!.rect), `${v} ${b.id} in ctl`).toBe(true);
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) expect(apart(leaves[i]!.rect, leaves[j]!.rect), `${v} ${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(true);
    }
  });

  it('puts the line side first: the PHY before the MAC, the queues under them, the DMA engine and the host link under the queues', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v), r = (k: string) => p.blocks.find((b) => b.id === k)!.rect;
      expect(r('phy').x, v).toBeLessThan(r('mac').x);
      expect(r('mac').y, v).toBeLessThan(r('stats').y);
      expect(r('mac').y + r('mac').h, v).toBeLessThanOrEqual(r('rxq').y + 0.01);
      expect(r('rxq').y, v).toBeLessThan(r('dma').y);
      expect(r('rxq').x, v).toBeLessThan(r('txq').x);
      expect(r('rxq').y, v).toBe(r('txq').y);
      expect(r('dma').x, v).toBeLessThan(r('pcie').x);
      expect(r('pcie').x, v).toBeLessThan(r('temp').x);
    }
  });

  it('routes every wire with at least two points, between the blocks it names', () => {
    for (const v of VISUALS) {
      const p = nicPlan(v), ids = new Set(p.blocks.map((b) => b.id));
      expect(p.links.length, v).toBe(8);
      for (const l of p.links) {
        expect(l.pts.length, `${v} ${l.id}`).toBeGreaterThanOrEqual(2);
        expect(ids.has(l.from), `${v} ${l.id} from ${l.from}`).toBe(true);
        expect(ids.has(l.to), `${v} ${l.id} to ${l.to}`).toBe(true);
      }
      expect(new Set(p.links.map((l) => l.id)).size, v).toBe(p.links.length);
    }
  });

  it('is the same plan for the same card, and takes the lanes and the jacks of the 3D card', () => {
    expect(nicPlan('nic-10g')).toBe(nicPlan('nic-10g'));
    for (const v of VISUALS) expect(nicInput(v).lanes, v).toBe(NIC_LANES[v]);
    expect(NIC_LINK['nic-40g']!.ports).toBe(2);
    expect(NIC_LINK['nic-gbe']!.ports).toBe(1);
    expect(nicInput('nic-unknown')).toBe(NIC_LINK['nic-gbe']);
    // the three cards are three different dies: each has its own chip, standard and input FIFO, and the FIFO is the sim's (the board's jack has the smallest)
    expect(new Set(VISUALS.map((v) => NIC_LINK[v]!.chip)).size).toBe(3);
    expect(new Set(VISUALS.map((v) => NIC_LINK[v]!.std)).size).toBe(3);
    expect(VISUALS.map((v) => NIC_LINK[v]!.fifo)).toEqual([NIC_FIFO.nic1, NIC_FIFO.nic2, NIC_FIFO.nic3]);
    expect(NIC_LINK['nic-gbe']!.fifo).toBeLessThan(NIC_LINK['nic-40g']!.fifo);
    for (const v of Object.keys(BOARD_LINK)) expect(BOARD_LINK[v]!.fifo, v).toBe(NIC_FIFO.board);
    expect(NIC_FIFO.board).toBeLessThan(NIC_LINK['nic-gbe']!.fifo);
    expect(nicPlan('nic-gbe').blocks.find((b) => b.id === 'pcie')!.label).toBe('PCIe x1');
    expect(nicPlan('nic-40g').blocks.find((b) => b.id === 'pcie')!.label).toBe('PCIe x8');
  });
});

describe('the ports on the bracket', () => {
  it('are RJ45 jacks, but the 40G card has two QSFP+ cages and a 40GBASE-CR4 line (40G is not sold on copper pairs), as the 3D card builds them', () => {
    expect(VISUALS.map((v) => NIC_LINK[v]!.port)).toEqual(['rj45', 'rj45', 'qsfp']);
    for (const v of VISUALS) expect(jackOf(v) === CAGE, v).toBe(NIC_LINK[v]!.port === 'qsfp');
    expect(NIC_LINK['nic-40g']!.std).toBe('40GBASE-CR4');
    expect(nicPlan('nic-40g').blocks.find((b) => b.id === 'phy')!.sub).toBe('40GBASE-CR4 line side');
    for (const v of Object.keys(BOARD_LINK)) expect(BOARD_LINK[v]!.port, v).toBe('rj45');
  });
});

describe('the Ethernet chip on the motherboard', () => {
  const BOARD = Object.keys(BOARD_LINK);

  it('has two looks, by the port speed, apart from the cards\' three', () => {
    expect(BOARD).toEqual(['board-fe', 'board-ge']);
    expect(boardLook(100)).toBe('board-fe');
    expect(boardLook(1000)).toBe('board-ge');
    for (const v of BOARD) { expect(NIC_LINK[v], v).toBeUndefined(); expect(nicInput(v), v).toBe(BOARD_LINK[v]); }
    // a Fast Ethernet port uses two of the four pairs: one to send, one to receive
    expect(BOARD_LINK['board-fe']!.pairs).toBe(2);
    expect(BOARD_LINK['board-ge']!.pairs).toBe(4);
    expect(new Set(BOARD.map((v) => BOARD_LINK[v]!.chip)).size).toBe(2);
    expect(BOARD_LINK['board-fe']!.std).toBe('100BASE-TX');
    expect(BOARD_LINK['board-ge']!.std).toBe('1000BASE-T');
  });

  it('is the cards\' die without the heat sensor, its host link going to the I/O hub, in the chip\'s own shape (taller than a card\'s) and in order', () => {
    for (const v of BOARD) {
      const p = nicPlan(v), ids = p.blocks.map((b) => b.id), leaves = p.blocks.filter((b) => b.kind !== 'ctl');
      expect(p.die, v).toEqual({ x: 0, y: 0, ...BOARD_DIE });
      expect(ids, v).toEqual(expect.arrayContaining(['ctl', 'phy', 'mac', 'stats', 'rxq', 'txq', 'dma', 'pcie']));
      expect(ids, v).not.toContain('temp');
      expect(p.links.map((l) => l.id), v).not.toContain('temp-dma');
      expect(p.links.length, v).toBe(7);
      expect(p.blocks.find((b) => b.id === 'pcie')!.sub, v).toBe('to the I/O hub');
      expect(p.blocks.find((b) => b.id === 'pcie')!.label, v).toBe('PCIe x1');
      for (const b of p.blocks) expect(inside(b.rect, p.die), `${v} ${b.id}`).toBe(true);
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) expect(apart(leaves[i]!.rect, leaves[j]!.rect), `${v} ${leaves[i]!.id} / ${leaves[j]!.id}`).toBe(true);
      // the two blocks of the bottom row share it: the host link takes the room the heat sensor leaves
      const r = (k: string) => p.blocks.find((b) => b.id === k)!.rect;
      expect(r('dma').x, v).toBeLessThan(r('pcie').x);
      expect(r('pcie').x + r('pcie').w, v).toBeGreaterThan(r('rxq').x + r('rxq').w - 1);
    }
    // the cards keep theirs
    for (const v of VISUALS) { expect(NIC_LINK[v]!.heat, v).toBe(true); expect(nicPlan(v).blocks.map((b) => b.id), v).toContain('temp'); }
  });

  it('takes a frame the cards\' way through the die', () => {
    for (const v of BOARD) {
      expect(nicRoute(nicPlan(v), 'rx').map((h) => h.link.id), v).toEqual(['phy-mac', 'mac-rxq', 'rxq-dma', 'dma-pcie']);
      expect(nicRoute(nicPlan(v), 'tx').map((h) => `${h.reverse ? '<' : ''}${h.link.id}`), v).toEqual(['<dma-pcie', '<txq-dma', '<mac-txq', '<phy-mac']);
    }
  });
});

describe('the way a frame goes through the die', () => {
  const ids = (v: string, dir: 'rx' | 'tx') => nicRoute(nicPlan(v), dir).map((h) => `${h.reverse ? '<' : ''}${h.link.id}`);

  it('comes in from the PHY, through the MAC and the receive queue, over the DMA engine to the host', () => {
    for (const v of VISUALS) expect(ids(v, 'rx'), v).toEqual(['phy-mac', 'mac-rxq', 'rxq-dma', 'dma-pcie']);
  });

  it('goes out the same way back, each wire run against its direction', () => {
    for (const v of VISUALS) expect(ids(v, 'tx'), v).toEqual(['<dma-pcie', '<txq-dma', '<mac-txq', '<phy-mac']);
  });

  it('lights the blocks it goes through, in order, and the two ways meet the same ends', () => {
    expect(BLOCKS.rx).toEqual([...BLOCKS.tx].reverse().map((b) => (b === 'txq' ? 'rxq' : b)));
    expect(BLOCKS.rx[0]).toBe('phy');
    expect(BLOCKS.rx[BLOCKS.rx.length - 1]).toBe('pcie');
  });
});
