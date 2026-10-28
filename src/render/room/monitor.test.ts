import { describe, expect, it } from 'vitest';
import { monitorView, standbyLook, type MonitorInput } from './monitor';

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

describe('standbyLook', () => {
  const look = (m: Partial<MonitorInput>, osOn = false) => { const i = { ...base, ...m }; return standbyLook(i, monitorView(i), osOn); };
  it('is the standby screen while the machine is off', () => {
    expect(look({ powered: false, phase: 'off', display: '' })).toBe('off');
  });
  it('is the mark alone while the machine is on and has no picture yet (the cold-boot wait)', () => {
    expect(look({ phase: 'posting', display: '' })).toBe('wait');
  });
  it('is nothing while the screen has its own content, and without a display', () => {
    expect(look({})).toBeNull(); // text
    expect(look({ phase: 'error' })).toBeNull(); // NO SIGNAL
    expect(look({ display: '' }, true)).toBeNull(); // the OS screen
    expect(look({ hasDisplay: false, powered: false, display: '' })).toBeNull();
  });
});
