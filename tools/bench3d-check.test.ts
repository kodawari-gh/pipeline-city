import { describe, expect, it } from 'vitest';
import { assertRecording } from './bench3d-check.mjs';

const ok = { frames: 200, calls: 1322, gpu: { Scene: 8.8 }, outline: true };

describe('assertRecording', () => {
  it('accepts a complete recording', () => {
    expect(() => assertRecording(ok, { needTimers: true, needOutline: true })).not.toThrow();
  });

  it('throws when no frames or no draw calls were recorded', () => {
    expect(() => assertRecording({ ...ok, frames: 0 })).toThrow(/no frames were recorded/);
    expect(() => assertRecording({ ...ok, calls: 0 })).toThrow(/no draw calls were recorded/);
  });

  it('throws when --need-timers is set and the GPU pass times are missing', () => {
    expect(() => assertRecording({ ...ok, gpu: {} }, { needTimers: true })).toThrow(/no GPU pass times were recorded/);
    expect(() => assertRecording({ ...ok, gpu: { Scene: 0 } }, { needTimers: true })).toThrow(/no GPU pass times were recorded/);
    expect(() => assertRecording({ ...ok, gpu: {} })).not.toThrow();
  });

  it('throws when the case hover outline is required and is off', () => {
    expect(() => assertRecording({ ...ok, outline: false }, { needOutline: true })).toThrow(/hover outline is off/);
    expect(() => assertRecording({ ...ok, outline: false })).not.toThrow();
  });
});
