import { describe, expect, it } from 'vitest';
import { monitorView, type MonitorInput } from './monitor';

const base: MonitorInput = { hasDisplay: true, powered: true, monitorLive: true, phase: 'running', postFailed: false, display: 'HELLO' };

describe('monitorView', () => {
  it('shows the sim text when live and healthy', () => {
    expect(monitorView(base)).toEqual({ text: 'HELLO', noSignal: false });
  });
  it('shows NO SIGNAL, not a blank screen, after a PSU trip or a burnt part (phase error, no POST failure)', () => {
    expect(monitorView({ ...base, phase: 'error' })).toEqual({ text: '', noSignal: true });
  });
  it('shows NO SIGNAL when the monitor itself is burnt (not live) while powered', () => {
    expect(monitorView({ ...base, monitorLive: false, display: '' })).toEqual({ text: '', noSignal: true });
  });
  it('keeps a POST error text on screen', () => {
    expect(monitorView({ ...base, phase: 'error', postFailed: true, display: 'NO CPU' })).toEqual({ text: 'NO CPU', noSignal: false });
  });
  it('stays black when off, and has no NO SIGNAL without a monitor', () => {
    expect(monitorView({ ...base, powered: false, phase: 'off' }).noSignal).toBe(false);
    expect(monitorView({ ...base, hasDisplay: false, phase: 'error' }).noSignal).toBe(false);
  });
});
