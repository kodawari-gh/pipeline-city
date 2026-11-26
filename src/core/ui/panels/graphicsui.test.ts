import { describe, expect, it } from 'vitest';
import * as graphicsApi from '@/app/graphics';
import { nextIndex, PRESET_INFO, tierNote } from './graphicsui';

describe('preset cards', () => {
  it('each preset has a card, one pip more than the one before, in a line that says what it is for', () => {
    graphicsApi.PRESET_NAMES.forEach(([id], i) => {
      expect(PRESET_INFO[id].pips).toBe(i + 1);
      expect(PRESET_INFO[id].line.length).toBeGreaterThan(8);
    });
  });
});

describe('tierNote', () => {
  const rec = (o: Partial<graphicsApi.TierRecord>): graphicsApi.TierRecord => ({
    mode: 'auto',
    tier: 'high',
    reason: 'discrete GPU',
    ...o,
  });

  it('says what Auto picked and why', () => {
    expect(tierNote(rec({}))).toBe('Auto picked High: discrete GPU.');
    expect(tierNote(rec({ tier: 'medium', reason: 'slow frames, was High' }))).toBe(
      'Auto picked Medium: slow frames, was High.',
    );
  });

  it('leaves the reason out when there is none', () => {
    expect(tierNote(rec({ reason: '' }))).toBe('Auto picked High.');
  });

  it('says the player chose, whatever tier it was', () => {
    expect(tierNote(rec({ mode: 'manual', tier: 'low', reason: 'chosen' }))).toBe(
      'Set by you. Auto picks from the GPU and the CPU.',
    );
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
