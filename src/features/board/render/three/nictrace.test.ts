import { describe, expect, it } from 'vitest';
import { builtinTheme } from '@/core/render/theme';
import { BD, NIC_LEN, nicY, setLayoutTier } from '../layout/layout';
import { FADE_MS, MAX_MS, MIN_MS, tripMs } from '../wiring/busflow';
import { STAND } from './card3d';
import type { CardFrame } from './gpu3d';
import { nicLanes } from './nicflow';
import { NIC_LANES, nicCopper } from './niccopper';
import { NicTraceView } from './nictrace';
import { tabOf } from './pcie';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const frame = (visual: string): CardFrame => {
  const y0 = nicY(0),
    x1 = BD.x + must(NIC_LEN[visual]);
  return { x0: BD.x, x1, xe: x1, y0, end: y0 + STAND.nic };
};
const lanesOf = (visual: string, slot = 0) => {
  const f = frame(visual);
  const tab = must(NIC_LANES[visual]);
  return nicLanes(nicCopper(visual, f, tabOf(0, f.x1, tab)), slot);
};
const view = (visual = 'nic-gbe', slot = 'pcie0'): { v: NicTraceView; lanes: ReturnType<typeof lanesOf> } => {
  setLayoutTier(3, 3);
  const v = new NicTraceView(),
    lanes = lanesOf(visual);
  v.setScene(builtinTheme());
  v.add(slot, lanes);
  return { v, lanes };
};

describe("the network card's copper, alive", () => {
  it('has nothing lit until a frame leaves, and nothing for a card it was not given', () => {
    const { v } = view();
    v.setSight('pcie0', { zoom: 1, shown: true });
    v.frame(0);
    expect(v.busy('pcie0')).toBe(false);
    expect(v.launch('pcie9', 'rx', 0, 1000)).toBe(0);
    expect(v.busy('pcie9')).toBe(false);
    expect(v.lead('pcie9', 'tx')).toBe(0);
  });

  it("times the copper before the die by the lanes' own length: the jack's pairs for a frame from the cable, the slot's for one from the host", () => {
    for (const visual of ['nic-gbe', 'nic-10g', 'nic-40g']) {
      const { v, lanes } = view(visual);
      expect(v.lead('pcie0', 'rx')).toBe(tripMs(lanes.media));
      expect(v.lead('pcie0', 'tx')).toBe(tripMs(lanes.host));
      for (const dir of ['rx', 'tx'] as const) {
        expect(v.lead('pcie0', dir), `${visual} ${dir}`).toBeGreaterThanOrEqual(MIN_MS);
        expect(v.lead('pcie0', dir), `${visual} ${dir}`).toBeLessThanOrEqual(MAX_MS);
      }
    }
  });

  it("lights the jack's pairs for a frame from the cable, answers with their time, and lets them fade once it has arrived", () => {
    const { v } = view();
    const lead = v.launch('pcie0', 'rx', 1000, 1200);
    expect(lead).toBe(v.lead('pcie0', 'rx'));
    v.frame(1000);
    expect(v.busy('pcie0')).toBe(true);
    // (the trace stays lit a moment after the packet is there, then it is dark: the frame goes on in the die, not on the copper)
    v.frame(1000 + lead + FADE_MS - 1);
    expect(v.busy('pcie0')).toBe(true);
    v.frame(1000 + lead + FADE_MS + 1);
    expect(v.busy('pcie0')).toBe(false);
  });

  it("runs a frame the host sends over the slot's pairs, then, once the die has passed it, out over the jack's", () => {
    const { v } = view();
    const lead = v.launch('pcie0', 'tx', 0, 1200),
      tail = tripMs(lanesOf('nic-gbe').media);
    expect(lead).toBe(v.lead('pcie0', 'tx'));
    v.frame(0);
    expect(v.busy('pcie0')).toBe(true);
    // (the slot's pairs have faded, the jack's are not on yet: the run is waiting for the die)
    v.frame(lead + FADE_MS + 1);
    expect(v.busy('pcie0')).toBe(true);
    v.frame(lead + 1200 + tail + FADE_MS - 1);
    expect(v.busy('pcie0')).toBe(true);
    v.frame(lead + 1200 + tail + FADE_MS + 1);
    expect(v.busy('pcie0')).toBe(false);
  });

  it("keeps each card's packets on its own copper", () => {
    setLayoutTier(3, 3);
    const v = new NicTraceView();
    v.setScene(builtinTheme());
    v.add('pcie0', lanesOf('nic-gbe', 0));
    v.add('pcie1', lanesOf('nic-10g', 1));
    v.launch('pcie1', 'rx', 0, 1000);
    v.frame(0);
    expect(v.busy('pcie1')).toBe(true);
    expect(v.busy('pcie0')).toBe(false);
  });

  it('ages its packets whether the face is seen or not, and a new scene takes them all away', () => {
    const { v } = view();
    v.setSight('pcie0', { zoom: 1, shown: false });
    const lead = v.launch('pcie0', 'rx', 0, 1000);
    v.frame(10);
    expect(v.busy('pcie0')).toBe(true);
    v.frame(lead + FADE_MS + 20);
    expect(v.busy('pcie0')).toBe(false);
    v.launch('pcie0', 'rx', 5000, 1000);
    v.setScene(builtinTheme());
    expect(v.busy('pcie0')).toBe(false);
    expect(v.root.children).toHaveLength(0);
    expect(v.launch('pcie0', 'rx', 5000, 1000)).toBe(0);
  });
});

describe("a graphics card's or an AI card's copper, alive", () => {
  it("lights a bus when the die's view tells of a word on it, at most once in a while, and only while the copper is seen", () => {
    const { v } = view('nic-10g');
    v.pulse('pcie0', 'host', 1); // (not seen yet: nothing is lit)
    expect(v.busy('pcie0')).toBe(false);
    v.setSight('pcie0', { zoom: 1, shown: true });
    v.frame(1000);
    v.pulse('pcie0', 'mem', 1);
    expect(v.busy('pcie0')).toBe(true);
    v.frame(1000 + FADE_MS + MAX_MS + 100);
    expect(v.busy('pcie0')).toBe(false);
    v.pulse('pcie9', 'host', 1); // (no such card)
    expect(v.busy('pcie9')).toBe(false);
  });
});
