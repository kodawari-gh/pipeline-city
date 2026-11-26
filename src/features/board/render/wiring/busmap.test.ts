import { describe, expect, it } from 'vitest';
import {
  DISPLAY_BASE,
  GPU_BASE,
  GPU_PORTS,
  GPU_STRIDE,
  INTC_BASE,
  MMU_BASE,
  MPU_BASE,
  NPU_BASE,
  TIMER_BASE,
  NPU_PORTS,
  NPU_STRIDE,
  PCH_BASE,
  PCH_KEY_WINDOW,
  PCH_RESULT_WINDOW,
  STORAGE_BASE,
  STORAGE_BUF,
  STORAGE_PORTS,
  STORAGE_STRIDE,
  TPM_BASE,
} from '@/core/sim/memmap';
import { TIER_GEO } from '../layout/boardlayout';
import { headerPin } from '../layout/pins';
import * as layout from '../layout/layout';
import * as routes from './routes';
import * as busmap from './busmap';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const near = (p: [number, number], r: layout.Rect, d = 80) =>
  p[0] >= r.x - d && p[0] <= r.x + r.w + d && p[1] >= r.y - d && p[1] <= r.y + r.h + d;
const first = (l: routes.Lane) => must(l.pts[0]),
  last = (l: routes.Lane) => must(l.pts.at(-1));
const ALL_CHAINS: Record<string, busmap.Hop[]> = {
  bios: busmap.BIOS_CHAIN,
  cooler: busmap.COOLER_CHAIN,
  power: busmap.POWER_ON_CHAIN,
  volt: busmap.VOLTAGE_CHAIN,
  code: busmap.POST_CODE_CHAIN,
  video: busmap.VIDEO_CHAIN,
  keyRead: busmap.keyChain(false),
  keyWrite: busmap.keyChain(true),
  netDown: busmap.boardNetChain(true),
  netUp: busmap.boardNetChain(false),
  sata: busmap.driveChain('sata0', false),
  m2: busmap.driveChain('m20', true),
  cpuCard: busmap.slotChain('pcie0', true),
  chipCard: busmap.slotChain('pcie1', false),
};

function assert_finds_the_drive_card_or_key_a_bus_address_belong(): void {
  expect(busmap.deviceAt(STORAGE_BASE)).toStrictEqual({ kind: 'drive', slot: 'sata0' });
  expect(busmap.deviceAt(STORAGE_BASE + STORAGE_STRIDE * 2 + STORAGE_BUF + 8)).toStrictEqual({
    kind: 'drive',
    slot: 'm20',
  }); // a word of port 2's block buffer
  for (const [k, slot] of STORAGE_PORTS.entries()) {
    expect(busmap.deviceAt(STORAGE_BASE + k * STORAGE_STRIDE + 4)).toStrictEqual({ kind: 'drive', slot });
  }
  expect(busmap.deviceAt(STORAGE_BASE + STORAGE_PORTS.length * STORAGE_STRIDE)).toBeNull();
  for (const [k, slot] of GPU_PORTS.entries()) {
    expect(busmap.deviceAt(GPU_BASE + k * GPU_STRIDE + 0x1_00_00)).toStrictEqual({ kind: 'card', slot });
  } // card memory, behind the registers
  expect(busmap.deviceAt(PCH_BASE + PCH_KEY_WINDOW + 4)).toStrictEqual({ kind: 'key' });
  expect(busmap.deviceAt(PCH_BASE + PCH_RESULT_WINDOW)).toStrictEqual({ kind: 'key' });
  for (const [k, _] of NPU_PORTS.entries()) {
    expect(busmap.deviceAt(NPU_BASE + k * NPU_STRIDE + 8)).toStrictEqual({ kind: 'card', slot: `pcie${k}` });
  }
  expect(busmap.deviceAt(PCH_BASE + 0x28)).toStrictEqual({ kind: 'chipset' }); // the chipset's registers
  expect(busmap.deviceAt(TPM_BASE + 4)).toStrictEqual({ kind: 'tpm' });
  expect(busmap.deviceAt(DISPLAY_BASE + 70)).toStrictEqual({ kind: 'display' });
  expect(busmap.deviceAt(INTC_BASE + 8)).toStrictEqual({ kind: 'intc' }); // on the CPU's die: no trace on the board, the die view lights them
  expect(busmap.deviceAt(TIMER_BASE)).toStrictEqual({ kind: 'timer' });
  expect(busmap.deviceAt(MPU_BASE)).toStrictEqual({ kind: 'mpu' });
  expect(busmap.deviceAt(MMU_BASE)).toStrictEqual({ kind: 'mmu' });
  expect(busmap.deviceAt(0x10_00)).toBeNull();
  expect(busmap.deviceAt(0xc1_00)).toBeNull();
}

describe('npuAccess', () => {
  it('names the slot and the offset of an access to a card window, and nothing else', () => {
    expect(busmap.npuAccess(NPU_BASE + 3 * NPU_STRIDE + 0x10_08)).toStrictEqual({ slot: 'pcie3', off: 0x10_08 });
    expect(busmap.npuAccess(NPU_BASE + 0x10)).toStrictEqual({ slot: 'pcie0', off: 0x10 });
    expect(busmap.npuAccess(GPU_BASE)).toBeNull();
    expect(busmap.npuAccess(NPU_BASE + NPU_PORTS.length * NPU_STRIDE)).toBeNull();
  });
});

describe('hasTpm', () => {
  it('finds the secure module by its kind: its slot is numbered (tpm0), never the bare name', () => {
    expect(busmap.hasTpm([{ kind: 'cpu' }, { kind: 'tpm' }])).toBe(true);
    expect(busmap.hasTpm([{ kind: 'cpu' }, { kind: 'gpu' }])).toBe(false);
    expect(busmap.hasTpm([])).toBe(false);
  });
});

describe('deviceAt', () => {
  it('finds the drive, card or key a bus address belongs to, and nothing for RAM', () => {
    expect.hasAssertions();
    assert_finds_the_drive_card_or_key_a_bus_address_belong();
  });
});

describe.each(TIER_GEO.map((g) => g.tier))('traffic on the tier %i board', (tier) => {
  const setup = () => {
    layout.setLayoutTier(tier);
    const buses = routes.buildBuses(),
      map = new Map<routes.BusKind, routes.Bus>();
    for (const b of buses) {
      if (!map.has(b.id)) {
        map.set(b.id, b);
      }
    }
    return { g: layout.GEO, buses, map };
  };
  /** The tier's board, known before any test runs: it picks the tests of the parts only some boards have. */
  const geo = must(TIER_GEO.find((x) => x.tier === tier)),
    tpmHeader = geo.hdrs.some((h) => h.name === 'TPM');

  function assert_classifies_every_bus_the_board_has_and_only_mess(): void {
    const { buses } = setup();
    for (const b of buses) {
      expect(busmap.BUS_ROLE[b.id]).toBeDefined();
    }
    for (const [name, hops] of Object.entries(ALL_CHAINS)) {
      for (const h of hops) {
        expect(busmap.isMessageBus(h.bus), `${name}: ${h.bus}`).toBe(true);
      }
    }
  }

  it('classifies every bus the board has, and only message buses appear in a chain', () => {
    expect.hasAssertions();
    assert_classifies_every_bus_the_board_has_and_only_mess();
  });

  it('sends a key over the hub uplink and its own port only', () => {
    const { g, map } = setup();
    const usb = must(map.get('usb'));
    expect(must(usb.groups)).toHaveLength(1 + g.usb);
    const read = busmap.resolve(map, busmap.keyChain(false));
    expect(read.map((l) => l.lanes)).toStrictEqual([
      busmap.lanesOf(usb, { usbPort: busmap.KEY_PORT }),
      busmap.lanesOf(usb, 'uplink'),
    ]);
    expect(busmap.lanesOf(usb, 'uplink')).toHaveLength(4);
    expect(busmap.lanesOf(usb, { usbPort: busmap.KEY_PORT })).toHaveLength(2);
    expect(busmap.resolve(map, busmap.keyChain(false)).some((l) => l.bus === 'dmi')).toBe(false);
    // the lanes run CPU -> hub, then hub -> port: a read goes the other way along both
    const usbToHub = must(must(must(usb.groups)[0])[0]);
    const hubToPort = must(must(must(usb.groups)[1])[0]);
    expect(near(first(usbToHub), layout.PKG)).toBe(true);
    expect(near(last(usbToHub), g.hub)).toBe(true);
    expect(near(first(hubToPort), g.hub)).toBe(true);
    expect(busmap.lanesOf(usb, { usbPort: g.usb })).toStrictEqual([]); // no such port
  });

  function assert_puts_a_SATA_drive_on_its_port_and_DMI_an_M_2_str(): void {
    const { g, map } = setup();
    for (const [i, _] of g.sata.entries()) {
      const legs = busmap.resolve(map, busmap.driveChain(`sata${i}`, false));
      expect(legs.map((l) => l.bus)).toStrictEqual(['sata', 'dmi']);
      expect(legs.map((l) => l.dir)).toStrictEqual([-1, -1]);
      expect(must(legs[0]).lanes).toHaveLength(3);
      const sataLane = must(must(legs[0]).lanes[0]);
      expect(near(first(sataLane), g.chip)).toBe(true); // the port's lanes start at the chipset
      expect(busmap.resolve(map, busmap.driveChain(`sata${i}`, true)).map((l) => l.bus)).toStrictEqual(['dmi', 'sata']);
    }
    for (const [i, _] of g.m2.entries()) {
      const legs = busmap.resolve(map, busmap.driveChain(`m2${i}`, true));
      expect(legs.map((l) => l.bus)).toStrictEqual(['nvme']);
      expect(must(legs[0]).lanes.length).toBeGreaterThan(0);
      const nvmeLane = must(must(legs[0]).lanes[0]);
      expect(near(first(nvmeLane), layout.PKG, 120)).toBe(true);
    }
    expect(busmap.resolve(map, busmap.driveChain(`sata${g.sata.length}`, false)).map((l) => l.bus)).not.toContain(
      'sata',
    ); // a port the board lacks has no lanes to light
    expect(busmap.driveChain('cpu', false)).toStrictEqual([]);
  }

  it('puts a SATA drive on its port and DMI, an M.2 straight on the CPU', () => {
    expect.hasAssertions();
    assert_puts_a_SATA_drive_on_its_port_and_DMI_an_M_2_str();
  });
  function assert_puts_a_card_in_a_x8_or_wider_slot_on_the_CPU_in_(): void {
    const { g, map } = setup();
    for (const [k, _] of g.pcie.entries()) {
      const legs = busmap.resolve(map, busmap.slotChain(`pcie${k}`, false)),
        { pairs, cpu } = must(g.pcieLinks[k]);
      expect(legs.map((l) => l.bus)).toStrictEqual(cpu ? ['pcie'] : ['pcie', 'dmi']);
      expect(must(legs[0]).lanes).toHaveLength(pairs);
      const slotLane = must(must(legs[0]).lanes[0]);
      expect(near(first(slotLane), cpu ? layout.PKG : g.chip, 120)).toBe(true);
    }
  }

  it('puts a card in a x8 or wider slot on the CPU, in a x4 slot on the chipset and DMI, on all the pairs of its slot', () => {
    expect.hasAssertions();
    assert_puts_a_card_in_a_x8_or_wider_slot_on_the_CPU_in_();
  });
  function assert_routes_the_control_chains_from_the_part_that_spe(): void {
    const { g, map } = setup();
    const lane = (id: routes.BusKind) => must(must(map.get(id)).lanes[0]),
      start = (id: routes.BusKind) => first(lane(id)),
      end = (id: routes.BusKind) => last(lane(id));
    expect(busmap.resolve(map, busmap.BIOS_CHAIN).map((l) => l.bus)).toStrictEqual(['spi', 'dmi']);
    expect(near(start('spi'), g.bios)).toBe(true);
    expect(near(end('spi'), g.chip)).toBe(true);
    expect(busmap.resolve(map, busmap.POWER_ON_CHAIN).map((l) => l.bus)).toStrictEqual(['hdr', 'lpc', 'dmi']);
    expect(near(start('lpc'), g.sio)).toBe(true);
    expect(near(start('hdr'), g.sio, 140)).toBe(true);
    expect(busmap.resolve(map, busmap.VOLTAGE_CHAIN).map((l) => l.bus)).toStrictEqual(['svid', 'pwmc']);
    expect(near(start('svid'), g.pwm)).toBe(true);
    expect(near(end('svid'), layout.PKG, 120)).toBe(true);
    expect(near(start('pwmc'), g.pwm)).toBe(true); // the first pwmc is the CPU's regulator
    expect(busmap.resolve(map, busmap.tpmChain(true)).map((l) => l.bus)).toStrictEqual(
      g.hdrs.some((h) => h.name === 'TPM') ? ['dmi', 'lpc', 'hdr'] : ['dmi', 'lpc'],
    );
    expect(busmap.resolve(map, busmap.chipsetChain(false)).map((l) => l.bus)).toStrictEqual(['dmi']);
    expect(busmap.BUS_ROLE.pwrpcie).toBe('power');
    expect(busmap.resolve(map, busmap.COOLER_CHAIN).map((l) => l.bus)).toStrictEqual(['fanc']);
    expect(near(start('fanc'), g.hub)).toBe(true); // the first fan lead is the CPU_FAN header's, from the I/O hub
    expect(busmap.resolve(map, busmap.POST_CODE_CHAIN).map((l) => l.bus)).toStrictEqual(
      g.dbg ? ['dmi', 'dbg'] : ['dmi'],
    );
  }

  it('routes the control chains from the part that speaks to the part that listens', () => {
    expect.hasAssertions();
    assert_routes_the_control_chains_from_the_part_that_spe();
  });

  function assert_starts_the_POST_code_lane_at_the_chipset(): void {
    const { g, map } = setup();
    const dbgLane = must(must(map.get('dbg')).lanes[0]);
    expect(near(first(dbgLane), g.chip, 140)).toBe(true);
  }

  it.runIf(geo.dbg !== null)('starts the POST code lane at the chipset, where the board has the debug display', () => {
    expect.hasAssertions();
    assert_starts_the_POST_code_lane_at_the_chipset();
  });
  function assert_lights_the_header_trunk_and_one_header_s_own_tap(): void {
    const { g, map } = setup();
    const hdr = must(map.get('hdr'));
    expect(must(hdr.heads).map((h) => h.name)).toStrictEqual(
      g.hdrs.filter((h) => !['CLR_CMOS', 'CPU_FAN', 'VRM_FAN', 'RAM_FAN'].includes(h.name)).map((h) => h.name),
    );
    for (const h of must(hdr.heads)) {
      expect(h.lanes).toHaveLength(2);
      expect(h.lanes[0], `${h.name} runs the trunk`).toBe(hdr.lanes[0]);
      const hd = must(g.hdrs.find((q) => q.name === h.name)),
        pin = headerPin(hd.x, hd.y, 0, hd.rows - 1),
        e = last(must(h.lanes[1]));
      expect(Math.hypot(e[0] - pin[0], e[1] - pin[1]), `${h.name}'s tap ends on its pin`).toBeLessThan(1);
    }
    // the power switch is read on the front-panel header, the module on its own: neither lights the other headers' taps
    const power = must(busmap.resolve(map, busmap.POWER_ON_CHAIN)[0]);
    expect(power.bus).toBe('hdr');
    expect(power.lanes).toStrictEqual(must(must(hdr.heads).find((h) => h.name === 'F_PANEL')).lanes);
    expect(power.lanes.length).toBeLessThan(hdr.lanes.length > 2 ? hdr.lanes.length : 3);
    expect(busmap.lanesOf(hdr, { header: 'NOPE' })).toStrictEqual([]);
  }

  it("lights the header trunk and one header's own tap, not every header", () => {
    expect.hasAssertions();
    assert_lights_the_header_trunk_and_one_header_s_own_tap();
  });

  function assert_reads_the_module_on_its_own_header_tap(): void {
    const { map } = setup();
    const hdr = must(map.get('hdr')),
      heads = must(hdr.heads),
      tpm = must(busmap.resolve(map, busmap.tpmChain(false))[0]);
    expect(tpm.bus).toBe('hdr');
    expect(tpm.lanes).toStrictEqual(must(heads.find((h) => h.name === 'TPM')).lanes);
    expect(tpm.lanes).not.toContain(must(heads.find((h) => h.name === 'F_PANEL')).lanes[1]);
  }

  it.runIf(tpmHeader)('reads the module on its own header tap, not the front panel', () => {
    expect.hasAssertions();
    assert_reads_the_module_on_its_own_header_tap();
  });

  function assert_lights_no_header_for_the_module_where_the_board_has(): void {
    const { map } = setup();
    expect(busmap.resolve(map, busmap.tpmChain(false))[0]?.bus).not.toBe('hdr');
  }

  it.skipIf(tpmHeader)('lights no header for the module where the board has no TPM header', () => {
    expect.hasAssertions();
    assert_lights_no_header_for_the_module_where_the_board_has();
  });
  function assert_routes_the_board_ethernet_through_the_PHY_and_th(): void {
    const { g, map } = setup();
    const down = busmap.resolve(map, busmap.boardNetChain(true));
    expect(down.map((l) => l.bus)).toStrictEqual(g.phy ? ['lan', 'phyl', 'usb'] : ['usb']);
  }

  it('routes the board ethernet through the PHY and the hub, where the board has a jack', () => {
    expect.hasAssertions();
    assert_routes_the_board_ethernet_through_the_PHY_and_th();
  });

  function assert_runs_the_jack_lanes_from_the_PHY(): void {
    const { g, map } = setup();
    const phy = must(g.phy),
      lanLane = must(must(map.get('lan')).lanes[0]),
      phylLane = must(must(map.get('phyl')).lanes[0]);
    expect(near(first(lanLane), phy)).toBe(true); // jack lanes run PHY -> jack, so a download runs them backwards
    expect(near(first(phylLane), phy)).toBe(true);
    expect(near(last(phylLane), g.hub)).toBe(true);
  }

  it.runIf(geo.phy !== null)('runs the jack lanes from the PHY, and the PHY lane to the hub', () => {
    expect.hasAssertions();
    assert_runs_the_jack_lanes_from_the_PHY();
  });
});
