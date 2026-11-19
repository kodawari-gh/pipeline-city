import { describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import { SnapCache } from './buildmode3d';
import { machineKey } from './machine3d';

describe('SnapCache (PERF19: one snapshot per change, not per frame)', () => {
  const rig = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });

  it('builds the snapshot once while the game stays the same', () => {
    const g = rig(), c = new SnapCache(), spy = vi.spyOn(g, 'snapshot');
    const a = c.of(g);
    for (let i = 0; i < 10; i++) expect(c.of(g)).toBe(a);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('shows an uninstall and an install after a drop', () => {
    const g = rig(), c = new SnapCache();
    const ram = c.of(g).devices.find((d) => d.kind === 'ram')!;
    expect(ram).toBeDefined();
    const out = g.uninstall(ram.id);
    expect(out.ok).toBe(true);
    expect(c.of(g).devices.some((d) => d.id === ram.id)).toBe(true); // kept until the drop
    c.drop();
    expect(c.of(g).devices.some((d) => d.id === ram.id)).toBe(false);
    const back = g.install(out.ok ? out.invId! : '', ram.slot);
    expect(back.ok).toBe(true);
    c.drop();
    expect(c.of(g).devices.find((d) => d.slot === ram.slot)?.kind).toBe('ram');
  });

  it('shows a cable change after a drop', () => {
    const g = rig(), c = new SnapCache();
    const cable = c.of(g).cables.find((x) => x.connected && x.id !== 'pcmains')!;
    g.disconnectCable(cable.id);
    c.drop();
    expect(c.of(g).cables.find((x) => x.id === cable.id)?.connected).toBe(false);
  });

  it('starts over for another game without a drop', () => {
    const a = rig(), b = new Game({ seed: 1, sandbox: true, preassembled: false }), c = new SnapCache();
    const sa = c.of(a), sb = c.of(b);
    expect(sb).not.toBe(sa);
    expect(sb.boardTier).toBe(b.board.tier);
  });
});

describe('the stage skips a build that would change nothing (ANIM-02, ANIM-06)', () => {
  const key = (g: Game) => machineKey(new SnapCache().of(g));

  it('keeps the machine key when a part comes out and goes back in its socket', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }), before = key(g);
    const ram = g.snapshot().devices.find((d) => d.kind === 'ram')!;
    const out = g.uninstall(ram.id);
    expect(out.ok).toBe(true);
    expect(key(g)).not.toBe(before); // a part really gone is a build
    expect(g.install(out.ok ? out.invId! : '', ram.slot).ok).toBe(true);
    expect(key(g)).toBe(before); // put back: the machine on the stage is still right
  });

  it('keeps the machine key when a cable is plugged in or out (the cable builds itself)', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }), before = key(g);
    g.disconnectCable('atx');
    expect(key(g)).toBe(before);
    g.connectCable('atx');
    expect(key(g)).toBe(before);
  });

  it('keys a bare case by its case alone: the board the game holds aside does not change it', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }), s = new SnapCache().of(g);
    expect(machineKey(s, 'case')).toBe(`bare|${s.caseTier}`);
    expect(machineKey(s, 'case')).not.toBe(machineKey(s));
    expect(machineKey(null, 'case')).toBe('none');
  });

  it('keys an empty stage as one thing, whatever case and board the game holds aside', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }), s = new SnapCache().of(g);
    expect(machineKey(s, 'nothing')).toBe('nothing');
    expect(machineKey(s, 'nothing')).not.toBe(machineKey(s, 'case'));
    expect(machineKey(s, 'nothing')).not.toBe(machineKey(s));
  });
});
