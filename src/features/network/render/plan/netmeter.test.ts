import { describe, expect, it } from 'vitest';
import { busy, fmtFrames, fmtPct, fmtSpeed, FrameMeter, lineFrames, loadOf } from './netmeter';

/** A snapshot's share: the tick and the frames counted so far. */
const at = (baseTick: number, rx: number, tx: number) => ({ baseTick, net: { frames: { rx, tx } } });

describe('the frame meter', () => {
  it('reads nothing from a game with no network, and starts again when it comes', () => {
    const m = new FrameMeter();
    m.feed(null);
    expect([m.rx, m.tx]).toStrictEqual([0, 0]);
    m.feed({ baseTick: 5, net: null });
    expect([m.rx, m.tx]).toStrictEqual([0, 0]);
  });

  it('starts from what it finds: the first snapshot gives no rate', () => {
    const m = new FrameMeter();
    m.feed(at(10, 5000, 2000));
    expect([m.rx, m.tx]).toStrictEqual([0, 0]);
  });

  it('gives the growth of each counter over the ticks that passed', () => {
    const m = new FrameMeter();
    m.feed(at(10, 0, 0));
    m.feed(at(11, 1000, 400));
    expect([m.rx, m.tx]).toStrictEqual([1000, 400]);
    m.feed(at(13, 1000 + 600, 400 + 200));
    expect([m.rx, m.tx]).toStrictEqual([300, 100]);
  });

  it('holds the rate while a tick has not come', () => {
    const m = new FrameMeter();
    m.feed(at(1, 0, 0));
    m.feed(at(2, 800, 0));
    m.feed(at(2, 800, 0));
    expect(m.rx).toBe(800);
  });

  it('goes back to zero when the game starts again (the tick or a counter goes back)', () => {
    const m = new FrameMeter();
    m.feed(at(5, 0, 0));
    m.feed(at(6, 900, 900));
    m.feed(at(2, 10, 10));
    expect([m.rx, m.tx]).toStrictEqual([0, 0]);
    m.feed(at(3, 60, 10));
    expect([m.rx, m.tx]).toStrictEqual([50, 0]);
    m.feed(at(4, 5, 5));
    expect([m.rx, m.tx]).toStrictEqual([0, 0]);
  });
});

describe('the load of a link', () => {
  it('finds the frames a tick at line rate from the speed and the frame size', () => {
    // 1 Gbit a second is 125 MB; a frame is 1500 bytes
    expect(lineFrames(1000)).toBeCloseTo(125e6 / 1500, 3);
    expect(lineFrames(0)).toBe(0);
  });

  it('shows no light for no frames, a faint one for a few, and the full light at line rate', () => {
    const line = lineFrames(1000);
    expect(busy(0, line)).toBe(0);
    expect(busy(5, 0)).toBe(0);
    expect(busy(1, line)).toBeGreaterThan(0.12);
    expect(busy(1, line)).toBeLessThan(0.2);
    expect(busy(line, line)).toBe(1);
    expect(busy(line * 3, line)).toBe(1);
    // more frames, more light
    expect(busy(1000, line)).toBeGreaterThan(busy(10, line));
  });

  it('gives the share of the line rate, held between 0 and 1', () => {
    expect(loadOf(50, 100)).toBe(0.5);
    expect(loadOf(500, 100)).toBe(1);
    expect(loadOf(-3, 100)).toBe(0);
    expect(loadOf(10, 0)).toBe(0);
  });
});

describe('the words for the numbers', () => {
  it('names a speed in Mb or Gb', () => {
    expect(fmtSpeed(100)).toBe('100 Mb');
    expect(fmtSpeed(1000)).toBe('1 Gb');
    expect(fmtSpeed(2500)).toBe('2.5 Gb');
    expect(fmtSpeed(40_000)).toBe('40 Gb');
  });

  it('shortens a share and a count', () => {
    expect(fmtPct(0)).toBe('0 %');
    expect(fmtPct(0.004)).toBe('0.40 %');
    expect(fmtPct(0.05)).toBe('5.0 %');
    expect(fmtPct(0.5)).toBe('50 %');
    expect(fmtFrames(950)).toBe('950');
    expect(fmtFrames(4200)).toBe('4.2 k');
    expect(fmtFrames(83_000)).toBe('83 k');
    expect(fmtFrames(1.2e6)).toBe('1.2 M');
    expect(fmtFrames(Number.NaN)).toBe('0');
  });
});
