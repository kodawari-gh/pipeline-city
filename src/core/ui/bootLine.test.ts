// The loading screen's boot progress (ticket #36; SPEC §5.3): the build line "<stage> · <pct> %" and the four strip cells.
// The coder creates src/core/ui/bootLine.ts (pure, no DOM):
//   bootLine(stage, share): "<stage> · <pct> %", share 0 to 1 (clamped), pct rounded.
//   stripInk(share): four booleans for strip cells 2 to 5. Cell n is ink when share >= (n - 1) * 0.2. Cell 1 is always violet and not listed.
// Written before that module exists: these fail until it lands.
import { describe, expect, it } from 'vitest';
import { bootLine, stripInk } from './bootLine';

describe('the build line shows the real boot stage and percentage', () => {
  it('reads "<stage> · <pct> %"', () => {
    expect(bootLine('Lighting the room', 0.62)).toBe('Lighting the room · 62 %');
  });

  it('shows 0 % at the start and 100 % at the end', () => {
    expect(bootLine('Starting', 0)).toBe('Starting · 0 %');
    expect(bootLine('Ready', 1)).toBe('Ready · 100 %');
  });

  it('clamps a share outside 0 to 1', () => {
    expect(bootLine('Starting', -1)).toBe('Starting · 0 %');
    expect(bootLine('Ready', 2)).toBe('Ready · 100 %');
  });
});

describe('the strip cells turn ink as the boot share passes each fifth', () => {
  it('no cell is ink before 20 %', () => {
    expect(stripInk(0)).toStrictEqual([false, false, false, false]);
    expect(stripInk(0.19)).toStrictEqual([false, false, false, false]);
  });

  it('at 62 % cells 2, 3 and 4 are ink and cell 5 is not', () => {
    expect(stripInk(0.62)).toStrictEqual([true, true, true, false]);
  });

  it('a cell turns ink exactly at its threshold', () => {
    expect(stripInk(0.2)).toStrictEqual([true, false, false, false]);
    expect(stripInk(0.4)).toStrictEqual([true, true, false, false]);
    expect(stripInk(0.6)).toStrictEqual([true, true, true, false]);
    expect(stripInk(0.8)).toStrictEqual([true, true, true, true]);
  });

  it('all cells are ink when the boot is done', () => {
    expect(stripInk(1)).toStrictEqual([true, true, true, true]);
  });
});
