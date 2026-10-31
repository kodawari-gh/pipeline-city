import { describe, expect, it } from 'vitest';
import { FanMotor, fanBank, machineLive } from './fanmotor';
import { snap } from '@/core/ui/testdata';

const run = (m: FanMotor, target: number, seconds: number, dt = 1 / 60) => { const out: number[] = []; for (let t = 0; t < seconds; t += dt) out.push(m.step(dt, target)); return out; };

describe('the fan motor', () => {
  it('spins up from still without a jump: each frame adds a little, and it settles on the target', () => {
    const m = new FanMotor(), s = run(m, 8, 6);
    expect(s[0]).toBeLessThan(0.1);
    for (let i = 1; i < s.length; i++) expect(s[i]! - s[i - 1]!).toBeLessThan(0.35);
    expect(s[s.length - 1]).toBeCloseTo(8, 1);
    expect(Math.max(...s)).toBeLessThanOrEqual(8);
  });

  it('coasts down slower than it spins up, and ends at exactly still', () => {
    const m = new FanMotor(); run(m, 8, 6);
    const down = run(m, 0, 10);
    expect(down[0]).toBeGreaterThan(7.5);
    for (let i = 1; i < down.length; i++) expect(down[i]!).toBeLessThanOrEqual(down[i - 1]!);
    expect(down[down.length - 1]).toBe(0);
    const up = run(new FanMotor(), 8, 6), reach = (a: number[], f: (v: number) => boolean) => a.findIndex(f);
    expect(reach(down, (v) => v < 4)).toBeGreaterThan(reach(up, (v) => v > 4));
  });

  it('holds while the game is paused (dt 0) and ignores one huge frame', () => {
    const m = new FanMotor(); run(m, 8, 3);
    const v = m.speed;
    expect(m.step(0, 0)).toBe(v);
    expect(m.step(30, 0)).toBeGreaterThan(v * 0.5);
  });

  it('a fan that is still stays still with no target', () => {
    const m = new FanMotor();
    expect(run(m, 0, 1).every((v) => v === 0)).toBe(true);
  });
});

describe('the fan bank and the machine rule', () => {
  it('publishes speeds by id, 0 for an unknown fan, level capped at 1', () => {
    fanBank.clear();
    expect(fanBank.get('gpu:pcie0')).toBe(0);
    fanBank.set('gpu:pcie0', 6);
    expect(fanBank.get('gpu:pcie0')).toBe(6);
    expect(fanBank.level('gpu:pcie0')).toBeGreaterThan(0);
    fanBank.set('x', 99);
    expect(fanBank.level('x')).toBe(1);
  });

  it('the machine is live only when powered, on, not tripped and the board is not burnt', () => {
    const ok = { powered: true, power: { off: false, tripped: false, totalW: 10, budgetW: 100, vrmLossW: 0, psuFactor: 1 } };
    expect(machineLive(snap(ok))).toBe(true);
    expect(machineLive(snap({ ...ok, powered: false }))).toBe(false);
    expect(machineLive(snap({ ...ok, power: { ...ok.power, off: true } }))).toBe(false);
    expect(machineLive(snap({ ...ok, power: { ...ok.power, tripped: true } }))).toBe(false);
    expect(machineLive(null)).toBe(false);
  });
});
