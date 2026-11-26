import { describe, expect, it, vi } from 'vitest';
import { Game } from '@/worker/game/game';
import { SnapCache } from './buildmode3d';
import { machineKey } from './machine3d';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

const rig = () => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });

const key = (g: Game) => machineKey(new SnapCache().of(g));
function assert_keeps_the_machine_key_when_a_part_comes_out_and_(): void {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }),
    before = key(g);
  const ram = must(g.snapshot().devices.find((d) => d.kind === 'ram'));
  const out = g.uninstall(ram.id);
  expect(out.ok).toBe(true);
  expect(key(g)).not.toBe(before); // a part really gone is a build
  expect(g.install(out.ok ? must(out.invId) : '', ram.slot).ok).toBe(true);
  expect(key(g)).toBe(before); // put back: the machine on the stage is still right
}

function assert_builds_the_snapshot_once_while_the_game_stays_th(): void {
  const g = rig(),
    c = new SnapCache(),
    spy = vi.spyOn(g, 'snapshot');
  const a = c.of(g);
  for (let i = 0; i < 10; i++) {
    expect(c.of(g)).toBe(a);
  }
  expect(spy).toHaveBeenCalledOnce();
}

function assert_shows_an_uninstall_and_an_install_after_a_drop(): void {
  const g = rig(),
    c = new SnapCache();
  const ram = must(c.of(g).devices.find((d) => d.kind === 'ram'));
  expect(ram).toBeDefined();
  const out = g.uninstall(ram.id);
  expect(out.ok).toBe(true);
  expect(c.of(g).devices.some((d) => d.id === ram.id)).toBe(true); // kept until the drop
  c.drop();
  expect(c.of(g).devices.some((d) => d.id === ram.id)).toBe(false);
  const back = g.install(out.ok ? must(out.invId) : '', ram.slot);
  expect(back.ok).toBe(true);
  c.drop();
  expect(c.of(g).devices.find((d) => d.slot === ram.slot)?.kind).toBe('ram');
}

function assert_shows_a_cable_change_after_a_drop(): void {
  const g = rig(),
    c = new SnapCache();
  const cable = must(c.of(g).cables.find((x) => x.connected && x.id !== 'pcmains'));
  g.disconnectCable(cable.id);
  c.drop();
  expect(c.of(g).cables.find((x) => x.id === cable.id)?.connected).toBe(false);
}

describe('SnapCache (PERF19: one snapshot per change, not per frame)', () => {
  it('builds the snapshot once while the game stays the same', () => {
    expect.hasAssertions();
    assert_builds_the_snapshot_once_while_the_game_stays_th();
  });

  it('shows an uninstall and an install after a drop', () => {
    expect.hasAssertions();
    assert_shows_an_uninstall_and_an_install_after_a_drop();
  });

  it('shows a cable change after a drop', () => {
    expect.hasAssertions();
    assert_shows_a_cable_change_after_a_drop();
  });

  it('starts over for another game without a drop', () => {
    const a = rig(),
      b = new Game({ seed: 1, sandbox: true, preassembled: false }),
      c = new SnapCache();
    const sa = c.of(a),
      sb = c.of(b);
    expect(sb).not.toBe(sa);
    expect(sb.boardTier).toBe(b.board.tier);
  });
});

describe('the stage skips a build that would change nothing (ANIM-02, ANIM-06)', () => {
  it('keeps the machine key when a part comes out and goes back in its socket', () => {
    expect.hasAssertions();
    assert_keeps_the_machine_key_when_a_part_comes_out_and_();
  });

  it('keeps the machine key when a cable is plugged in or out (the cable builds itself)', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }),
      before = key(g);
    g.disconnectCable('atx');
    expect(key(g)).toBe(before);
    g.connectCable('atx');
    expect(key(g)).toBe(before);
  });

  it('keys a bare case by its case alone: the board the game holds aside does not change it', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }),
      s = new SnapCache().of(g);
    expect(machineKey(s, 'case')).toBe(`bare|${s.caseTier}`);
    expect(machineKey(s, 'case')).not.toBe(machineKey(s));
    expect(machineKey(null, 'case')).toBe('none');
  });

  it('keys an empty stage as one thing, whatever case and board the game holds aside', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true }),
      s = new SnapCache().of(g);
    expect(machineKey(s, 'nothing')).toBe('nothing');
    expect(machineKey(s, 'nothing')).not.toBe(machineKey(s, 'case'));
    expect(machineKey(s, 'nothing')).not.toBe(machineKey(s));
  });
});
