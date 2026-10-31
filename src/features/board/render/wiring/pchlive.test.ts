import { describe, expect, it } from 'vitest';
import { BR, setLayoutTier } from '../layout/layout';
import { legsOf } from '../layout/pins';
import { buildBuses, mkLane } from './routes';
import { chipLegOf, legGlow, ledOf, pchLedAt } from './pchlive';

describe('chipLegOf', () => {
  it('finds the leg a lane ends on, and which way a packet arrives', () => {
    setLayoutTier(2);
    const chip = BR.chip, [x, y] = legsOf(chip, 'n')[2]!;
    const into = chipLegOf(chip, mkLane([[x, y - 300], [x, y]]));
    expect(into).toMatchObject({ side: 'n', x, y, arrives: 1 });
    const out = chipLegOf(chip, mkLane([[x, y], [x, y - 300]]));
    expect(out).toMatchObject({ side: 'n', arrives: -1 });
  });

  it('ignores a lane that does not land on the chip', () => {
    setLayoutTier(2);
    expect(chipLegOf(BR.chip, mkLane([[-1000, -1000], [-900, -1000]]))).toBeNull();
  });

  it.each([0, 1, 2, 3])('tier %i: the chipset buses land on its legs, the CPU buses do not', (tier) => {
    setLayoutTier(tier);
    const buses = new Map(buildBuses().map((b) => [b.id, b]));
    // DMI, SATA, SPI and LPC all end on the chipset
    for (const id of ['dmi', 'sata', 'spi', 'lpc'] as const) {
      const lanes = buses.get(id)?.lanes ?? [];
      expect(lanes.length, id).toBeGreaterThan(0);
      for (const l of lanes) expect(chipLegOf(BR.chip, l), id).not.toBeNull();
    }
    // memory runs CPU to DIMMs
    for (const l of buses.get('mem')?.lanes ?? []) expect(chipLegOf(BR.chip, l)).toBeNull();
  });
});

describe('legGlow', () => {
  it('rises before the packet gets there and dies away after', () => {
    expect(legGlow({ at: 1000 }, 800)).toBe(0);
    expect(legGlow({ at: 1000 }, 970)).toBeGreaterThan(0.3);
    expect(legGlow({ at: 1000 }, 1000)).toBeCloseTo(1);
    expect(legGlow({ at: 1000 }, 1160)).toBeLessThan(legGlow({ at: 1000 }, 1050));
    expect(legGlow({ at: 1000 }, 1900)).toBeLessThan(0.01);
  });
});

describe('ledOf', () => {
  it('is dark without power', () => expect(ledOf(false, 'posting', 'none', 0)).toBeNull());
  it('shows POST amber, idle green, an error red', () => {
    expect(ledOf(true, 'posting', 'none', 0)).toMatchObject({ tone: 'ld', on: true });
    expect(ledOf(true, 'idle-os', 'none', 0)).toMatchObject({ tone: 'st', on: true });
    expect(ledOf(true, 'error', 'none', 0)).toMatchObject({ tone: 'bad' });
  });
  it('blinks while the key moves', () => {
    expect(ledOf(true, 'idle-os', 'ingesting', 0)!.on).not.toBe(ledOf(true, 'idle-os', 'ingesting', 130)!.on);
    expect(ledOf(true, 'loading', 'none', 0)).toMatchObject({ tone: 'st' });
  });
});

it('the LED sits on the face of the package, well in from the east edge and clear of the label', () => {
  for (const tier of [0, 1, 2, 3]) {
    setLayoutTier(tier);
    const c = BR.chip, p = pchLedAt(c);
    expect(p.x).toBeLessThanOrEqual(c.x + c.w - 60);
    expect(p.x).toBeGreaterThan(c.x + c.w * 0.7);
  }
});
