import { describe, expect, it } from 'vitest';
import { PRESET_NAMES, type TierRecord } from '@/app/graphics';
import { fpsTone, nextIndex, PRESET_INFO, tierNote } from './graphicsui';

describe('preset cards', () => {
  it('each preset has a card, one pip more than the one before, in a line that says what it is for', () => {
    PRESET_NAMES.forEach(([id], i) => {
      expect(PRESET_INFO[id].pips).toBe(i + 1);
      expect(PRESET_INFO[id].line.length).toBeGreaterThan(8);
    });
  });
});

describe('tierNote', () => {
  const rec = (o: Partial<TierRecord>): TierRecord => ({ mode: 'auto', tier: 'high', reason: 'discrete GPU', ...o });

  it('says what Auto picked and why', () => {
    expect(tierNote(rec({}))).toBe('Auto picked High: discrete GPU.');
    expect(tierNote(rec({ tier: 'medium', reason: 'slow frames, was High' }))).toBe('Auto picked Medium: slow frames, was High.');
  });

  it('leaves the reason out when there is none', () => expect(tierNote(rec({ reason: '' }))).toBe('Auto picked High.'));

  it('says the player chose, whatever tier it was', () => expect(tierNote(rec({ mode: 'manual', tier: 'low', reason: 'chosen' }))).toBe('Set by you. Auto picks from the GPU and the CPU.'));
});

describe('fpsTone', () => {
  it('is none until a frame rate is measured', () => expect(fpsTone(0, 60)).toBe('none'));
  it('is bad under 30, whatever the limit', () => {
    expect(fpsTone(29, 0)).toBe('bad');
    expect(fpsTone(29, 30)).toBe('bad');
  });
  it('warns under 90% of the limit', () => {
    expect(fpsTone(50, 60)).toBe('warn');
    expect(fpsTone(54, 60)).toBe('ok');
    expect(fpsTone(110, 120)).toBe('ok');
  });
  it('is fine at the limit, and with no limit above 30', () => {
    expect(fpsTone(60, 60)).toBe('ok');
    expect(fpsTone(30, 30)).toBe('ok');
    expect(fpsTone(45, 0)).toBe('ok');
  });
});

describe('nextIndex', () => {
  it('steps with the arrows and wraps at both ends', () => {
    expect(nextIndex(0, 4, 'ArrowRight')).toBe(1);
    expect(nextIndex(3, 4, 'ArrowRight')).toBe(0);
    expect(nextIndex(0, 4, 'ArrowLeft')).toBe(3);
    expect(nextIndex(2, 4, 'ArrowUp')).toBe(1);
    expect(nextIndex(2, 4, 'ArrowDown')).toBe(3);
  });
  it('jumps with Home and End', () => {
    expect(nextIndex(2, 4, 'Home')).toBe(0);
    expect(nextIndex(1, 4, 'End')).toBe(3);
  });
  it('from no focus an arrow goes to the first or the last', () => {
    expect(nextIndex(-1, 3, 'ArrowRight')).toBe(0);
    expect(nextIndex(-1, 3, 'ArrowLeft')).toBe(2);
  });
  it('ignores other keys and an empty row', () => {
    expect(nextIndex(0, 4, 'a')).toBeNull();
    expect(nextIndex(0, 4, 'Enter')).toBeNull();
    expect(nextIndex(0, 0, 'ArrowRight')).toBeNull();
  });
});
