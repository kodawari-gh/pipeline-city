// What the graphics modal (`Graphics.tsx`) says and how its keys move, as plain functions so a test can hold them.
import { TIER_NAMES, type Preset, type TierRecord } from '@/app/graphics';

/** A preset's card: its level (pips out of four) and what it is for, in a line. */
export const PRESET_INFO: Record<Preset, { pips: number; line: string }> = {
  low: { pips: 1, line: 'Fastest. No shadows or glow.' },
  medium: { pips: 2, line: 'Balanced. Soft light and glow.' },
  high: { pips: 3, line: 'The look the game is made for.' },
  ultra: { pips: 4, line: 'Sharpest. Needs a strong GPU.' },
};

/** The line under the tier buttons: what Auto picked and why, or that the player chose. */
export function tierNote(rec: TierRecord): string {
  if (rec.mode === 'manual') return 'Set by you. Auto picks from the GPU and the CPU.';
  const name = TIER_NAMES.find(([id]) => id === rec.tier)![1];
  return `Auto picked ${name}${rec.reason ? `: ${rec.reason}` : ''}.`;
}

/** How the frame rate reads: under 30 is bad; under 90% of the limit (when there is one) is a warning; else fine. 0 FPS is not measured yet. */
export function fpsTone(fps: number, limit: number): 'none' | 'ok' | 'warn' | 'bad' {
  if (!fps) return 'none';
  if (fps < 30) return 'bad';
  return limit > 0 && fps < limit * 0.9 ? 'warn' : 'ok';
}

/**
 * The button a key moves to in a row of `n` (tabs, radios): the arrows step and wrap, Home and End jump. `at` is the button that has the focus (-1: none).
 * Null: the key is not one of these.
 */
export function nextIndex(at: number, n: number, key: string): number | null {
  if (n < 1) return null;
  if (key === 'Home') return 0;
  if (key === 'End') return n - 1;
  if (key === 'ArrowRight' || key === 'ArrowDown') return at < 0 ? 0 : (at + 1) % n;
  if (key === 'ArrowLeft' || key === 'ArrowUp') return at < 0 ? n - 1 : (at - 1 + n) % n;
  return null;
}
