import { describe, expect, it } from 'vitest';
import {
  DISPLAY_BASE, GPU_BASE, GPU_PORTS, GPU_STRIDE, INTC_BASE, MMU_BASE, MPU_BASE, NPU_BASE, TIMER_BASE, NPU_PORTS, NPU_STRIDE, PCH_BASE, PCH_KEY_WINDOW, PCH_RESULT_WINDOW, STORAGE_BASE, STORAGE_BUF, STORAGE_PORTS, STORAGE_STRIDE, TPM_BASE,
} from '../../sim/isa/memmap';
import { TIER_GEO } from './boardlayout';
import { headerPin } from './pins';
import { GEO, PKG, setLayoutTier, type Rect } from './layout';
import { buildBuses, type Bus, type BusKind, type Lane } from './routes';
import {
  BIOS_CHAIN, BUS_ROLE, COOLER_CHAIN, KEY_PORT, chipsetChain, deviceAt, npuAccess, tpmChain, POST_CODE_CHAIN, POWER_ON_CHAIN, VIDEO_CHAIN, VOLTAGE_CHAIN, boardNetChain, driveChain, isMessageBus, keyChain, lanesOf, resolve, slotChain,
  type Hop,
} from './busmap';

const near = (p: [number, number], r: Rect, d = 80) => p[0] >= r.x - d && p[0] <= r.x + r.w + d && p[1] >= r.y - d && p[1] <= r.y + r.h + d;
const first = (l: Lane) => l.pts[0]!, last = (l: Lane) => l.pts[l.pts.length - 1]!;
const ALL_CHAINS: Record<string, Hop[]> = {
  bios: BIOS_CHAIN, cooler: COOLER_CHAIN, power: POWER_ON_CHAIN, volt: VOLTAGE_CHAIN, code: POST_CODE_CHAIN, video: VIDEO_CHAIN,
  keyRead: keyChain(false), keyWrite: keyChain(true), netDown: boardNetChain(true), netUp: boardNetChain(false),
  sata: driveChain('sata0', false), m2: driveChain('m20', true), cpuCard: slotChain('pcie0', true), chipCard: slotChain('pcie1', false),
};

describe('npuAccess', () => {
  it('names the slot and the offset of an access to a card window, and nothing else', () => {
    expect(npuAccess(NPU_BASE + 3 * NPU_STRIDE + 0x1008)).toEqual({ slot: 'pcie3', off: 0x1008 });
    expect(npuAccess(NPU_BASE + 0x10)).toEqual({ slot: 'pcie0', off: 0x10 });
    expect(npuAccess(GPU_BASE)).toBeNull();
    expect(npuAccess(NPU_BASE + NPU_PORTS.length * NPU_STRIDE)).toBeNull();
  });
});

describe('deviceAt', () => {
  it('finds the drive, card or key a bus address belongs to, and nothing for RAM', () => {
    expect(deviceAt(STORAGE_BASE)).toEqual({ kind: 'drive', slot: 'sata0' });
    expect(deviceAt(STORAGE_BASE + STORAGE_STRIDE * 2 + STORAGE_BUF + 8)).toEqual({ kind: 'drive', slot: 'm20' }); // a word of port 2's block buffer
    STORAGE_PORTS.forEach((slot, k) => expect(deviceAt(STORAGE_BASE + k * STORAGE_STRIDE + 4)).toEqual({ kind: 'drive', slot }));
    expect(deviceAt(STORAGE_BASE + STORAGE_PORTS.length * STORAGE_STRIDE)).toBeNull();
    GPU_PORTS.forEach((slot, k) => expect(deviceAt(GPU_BASE + k * GPU_STRIDE + 0x1_0000)).toEqual({ kind: 'card', slot })); // card memory, behind the registers
    expect(deviceAt(PCH_BASE + PCH_KEY_WINDOW + 4)).toEqual({ kind: 'key' });
    expect(deviceAt(PCH_BASE + PCH_RESULT_WINDOW)).toEqual({ kind: 'key' });
    NPU_PORTS.forEach((_, k) => expect(deviceAt(NPU_BASE + k * NPU_STRIDE + 8)).toEqual({ kind: 'card', slot: 'pcie' + k }));
    expect(deviceAt(PCH_BASE + 0x28)).toEqual({ kind: 'chipset' }); // the chipset's registers
    expect(deviceAt(TPM_BASE + 4)).toEqual({ kind: 'tpm' });
    expect(deviceAt(DISPLAY_BASE + 70)).toEqual({ kind: 'display' });
    expect(deviceAt(INTC_BASE + 8)).toEqual({ kind: 'intc' }); // on the CPU's die: no trace on the board, the die view lights them
    expect(deviceAt(TIMER_BASE)).toEqual({ kind: 'timer' });
    expect(deviceAt(MPU_BASE)).toEqual({ kind: 'mpu' });
    expect(deviceAt(MMU_BASE)).toEqual({ kind: 'mmu' });
    expect(deviceAt(0x1000)).toBeNull();
    expect(deviceAt(0xc100)).toBeNull();
  });
});

describe.each(TIER_GEO.map((g) => g.tier))('traffic on the tier %i board', (tier) => {
  const setup = () => {
    setLayoutTier(tier);
    const buses = buildBuses(), map = new Map<BusKind, Bus>();
    for (const b of buses) if (!map.has(b.id)) map.set(b.id, b);
    return { g: GEO, buses, map };
  };

  it('classifies every bus the board has, and only message buses appear in a chain', () => {
    const { buses } = setup();
    for (const b of buses) expect(BUS_ROLE[b.id], b.id).toBeDefined();
    for (const [name, hops] of Object.entries(ALL_CHAINS)) for (const h of hops) expect(isMessageBus(h.bus), `${name}: ${h.bus}`).toBe(true);
  });

  it('sends a key over the hub uplink and its own port only', () => {
    const { g, map } = setup();
    const usb = map.get('usb')!;
    expect(usb.groups!.length).toBe(1 + g.usb);
    const read = resolve(map, keyChain(false));
    expect(read.map((l) => l.lanes)).toEqual([lanesOf(usb, { usbPort: KEY_PORT }), lanesOf(usb, 'uplink')]);
    expect(lanesOf(usb, 'uplink').length).toBe(4);
    expect(lanesOf(usb, { usbPort: KEY_PORT }).length).toBe(2);
    expect(resolve(map, keyChain(false)).some((l) => l.bus === 'dmi')).toBe(false);
    // the lanes run CPU -> hub, then hub -> port: a read goes the other way along both
    expect(near(first(usb.groups![0]![0]!), PKG)).toBe(true);
    expect(near(last(usb.groups![0]![0]!), g.hub)).toBe(true);
    expect(near(first(usb.groups![1]![0]!), g.hub)).toBe(true);
    expect(lanesOf(usb, { usbPort: g.usb })).toEqual([]); // no such port
  });

  it('puts a SATA drive on its port and DMI, an M.2 straight on the CPU', () => {
    const { g, map } = setup();
    g.sata.forEach((_, i) => {
      const legs = resolve(map, driveChain('sata' + i, false));
      expect(legs.map((l) => l.bus)).toEqual(['sata', 'dmi']);
      expect(legs.map((l) => l.dir)).toEqual([-1, -1]);
      expect(legs[0]!.lanes.length).toBe(3);
      expect(near(first(legs[0]!.lanes[0]!), g.chip)).toBe(true); // the port's lanes start at the chipset
      expect(resolve(map, driveChain('sata' + i, true)).map((l) => l.bus)).toEqual(['dmi', 'sata']);
    });
    g.m2.forEach((_, i) => {
      const legs = resolve(map, driveChain('m2' + i, true));
      expect(legs.map((l) => l.bus)).toEqual(['nvme']);
      expect(legs[0]!.lanes.length).toBeGreaterThan(0);
      expect(near(first(legs[0]!.lanes[0]!), PKG, 120)).toBe(true);
    });
    expect(resolve(map, driveChain('sata' + g.sata.length, false)).map((l) => l.bus)).not.toContain('sata'); // a port the board lacks has no lanes to light
    expect(driveChain('cpu', false)).toEqual([]);
  });

  it('puts a card in the first slot on the CPU, in the others on the chipset and DMI', () => {
    const { g, map } = setup();
    g.pcie.forEach((_, k) => {
      const legs = resolve(map, slotChain('pcie' + k, false));
      expect(legs.map((l) => l.bus)).toEqual(k === 0 ? ['pcie'] : ['pcie', 'dmi']);
      expect(legs[0]!.lanes.length).toBe(k === 0 ? 12 : 4);
      expect(near(first(legs[0]!.lanes[0]!), k === 0 ? PKG : g.chip, 120)).toBe(true);
    });
  });

  it('routes the control chains from the part that speaks to the part that listens', () => {
    const { g, map } = setup();
    const lane = (id: BusKind, n = 0) => map.get(id)!.lanes[n]!;
    expect(resolve(map, BIOS_CHAIN).map((l) => l.bus)).toEqual(['spi', 'dmi']);
    expect(near(first(lane('spi')), g.bios)).toBe(true);
    expect(near(last(lane('spi')), g.chip)).toBe(true);
    expect(resolve(map, POWER_ON_CHAIN).map((l) => l.bus)).toEqual(['hdr', 'lpc', 'dmi']);
    expect(near(first(lane('lpc')), g.sio)).toBe(true);
    expect(near(first(lane('hdr')), g.sio, 140)).toBe(true);
    expect(resolve(map, VOLTAGE_CHAIN).map((l) => l.bus)).toEqual(['svid', 'pwmc']);
    expect(near(first(lane('svid')), g.pwm)).toBe(true);
    expect(near(last(lane('svid')), PKG, 120)).toBe(true);
    expect(near(first(lane('pwmc')), g.pwm)).toBe(true); // the first pwmc is the CPU's regulator
    expect(resolve(map, tpmChain(true)).map((l) => l.bus)).toEqual(g.hdrs.some((h) => h.name === 'TPM') ? ['dmi', 'lpc', 'hdr'] : ['dmi', 'lpc']);
    expect(resolve(map, chipsetChain(false)).map((l) => l.bus)).toEqual(['dmi']);
    expect(BUS_ROLE.pwrpcie).toBe('power');
    expect(resolve(map, COOLER_CHAIN).map((l) => l.bus)).toEqual(['fanc']);
    expect(near(first(lane('fanc')), g.hub)).toBe(true); // the first fan lead is the CPU_FAN header's, from the I/O hub
    expect(resolve(map, POST_CODE_CHAIN).map((l) => l.bus)).toEqual(g.dbg ? ['dmi', 'dbg'] : ['dmi']);
    if (g.dbg) expect(near(first(lane('dbg')), g.chip, 140)).toBe(true);
  });

  it('lights the header trunk and one header\'s own tap, not every header', () => {
    const { g, map } = setup();
    const hdr = map.get('hdr')!;
    expect(hdr.heads!.map((h) => h.name)).toEqual(g.hdrs.filter((h) => !['CLR_CMOS', 'CPU_FAN', 'VRM_FAN', 'RAM_FAN'].includes(h.name)).map((h) => h.name));
    for (const h of hdr.heads!) {
      expect(h.lanes.length, h.name).toBe(2);
      expect(h.lanes[0], `${h.name} runs the trunk`).toBe(hdr.lanes[0]);
      const hd = g.hdrs.find((q) => q.name === h.name)!, pin = headerPin(hd.x, hd.y, 0, hd.rows - 1), e = last(h.lanes[1]!);
      expect(Math.hypot(e[0] - pin[0], e[1] - pin[1]), `${h.name}'s tap ends on its pin`).toBeLessThan(1);
    }
    // the power switch is read on the front-panel header, the module on its own: neither lights the other headers' taps
    const power = resolve(map, POWER_ON_CHAIN)[0]!, tpm = resolve(map, tpmChain(false))[0];
    expect(power.bus).toBe('hdr');
    expect(power.lanes).toEqual(hdr.heads!.find((h) => h.name === 'F_PANEL')!.lanes);
    expect(power.lanes.length).toBeLessThan(hdr.lanes.length > 2 ? hdr.lanes.length : 3);
    if (g.hdrs.some((h) => h.name === 'TPM')) {
      expect(tpm!.bus).toBe('hdr');
      expect(tpm!.lanes).toEqual(hdr.heads!.find((h) => h.name === 'TPM')!.lanes);
      expect(tpm!.lanes).not.toContain(hdr.heads!.find((h) => h.name === 'F_PANEL')!.lanes[1]);
    } else expect(tpm?.bus).not.toBe('hdr'); // no header, nothing to light
    expect(lanesOf(hdr, { header: 'NOPE' })).toEqual([]);
  });

  it('routes the board ethernet through the PHY and the hub, where the board has a jack', () => {
    const { g, map } = setup();
    const down = resolve(map, boardNetChain(true));
    expect(down.map((l) => l.bus)).toEqual(g.phy ? ['lan', 'phyl', 'usb'] : ['usb']);
    if (g.phy) {
      expect(near(first(map.get('lan')!.lanes[0]!), g.phy)).toBe(true); // jack lanes run PHY -> jack, so a download runs them backwards
      expect(near(first(map.get('phyl')!.lanes[0]!), g.phy)).toBe(true);
      expect(near(last(map.get('phyl')!.lanes[0]!), g.hub)).toBe(true);
    }
  });
});
