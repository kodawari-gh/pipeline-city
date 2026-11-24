import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import { deviceSpec } from '../../board/sim';
import { plugCables } from '../../board/sim/buildpreset';
import { runBenchTasks } from './pcbench';

// A machine that cannot run well says why, in the machine's own terms (not "it did not finish"): a supply too small, a part that runs hot, a start-up check that
// fails. Build my PC fits any part that fits its socket (`GameOptions.looseFit`), so these are the machines it lets a player build.

/** A Build my PC game: a case, a board and `parts` (`spec` or `spec@socket`), bought free and fitted, every cable plugged. */
function rig(parts: string[], caseId = 'case1', boardId = 'board1'): Game {
  const g = new Game({ seed: 1, sandbox: true, preassembled: false, looseFit: true });
  for (const part of [caseId, boardId, ...parts]) {
    const [id, slot] = part.split('@') as [string, string | undefined];
    const b = g.purchase(id);
    if (!b.ok || !g.install(b.invId, slot).ok) throw new Error(`${part} did not go in`);
  }
  plugCables(g);
  return g;
}
const run = async (g: Game, id = 'crc') => (await runBenchTasks(g, [id]))[0]!;

describe('a machine that does not run', () => {
  it('a supply far too small trips when the job loads the processor, and the note says what it draws and what it gives', async () => {
    // (a light job on a small machine stays under what a supply gives: the supply trips on the load the machine really draws)
    const r = await run(rig(['psu0', 'cpu4w', 'cooler2', 'rad3@rad-top', 'ram5', 'display0'], 'case3', 'board3'));
    expect(r.score).toBeNull();
    expect(r.note).toMatch(/power supply tripped: the parts draw \d+ W at full load and it gives 40 W/);
  }, 60_000);

  it('a missing part stops the start-up check, and the note names it', async () => {
    const g = rig(['psu1', 'cpu1', 'cooler0', 'ram0', 'display0']);
    g.uninstall(g.board.devices.find((d) => deviceSpec(d).kind === 'cooler')!.id);
    plugCables(g);
    const r = await run(g);
    expect(r.score).toBeNull();
    expect(r.note).toMatch(/does not start: no CPU cooler/i);
  }, 60_000);

  it('no power supply: the power button does nothing, and the note says so', async () => {
    const r = await run(rig(['cpu1', 'cooler0', 'ram0', 'display0']));
    expect(r.score).toBeNull();
    expect(r.note).toMatch(/does not switch on: no PSU/i);
  }, 60_000);
});

describe('a machine that runs slower than its parts', () => {
  it('a supply a little too small slows every clock, and the result says so', async () => {
    const small = await run(rig(['psu0', 'cpu2', 'cooler0', 'ram2', 'display0']));
    const right = await run(rig(['psu1', 'cpu2', 'cooler0', 'ram2', 'display0']));
    expect(small.score).not.toBeNull();
    expect(small.slowed).toMatch(
      /The power supply is too small \(40 W for \d+ W at full load\): it ran at \d+% of its speed/,
    );
    expect(right.slowed).toBeUndefined();
    expect(small.score!).toBeLessThan(right.score!);
  }, 60_000);

  it('a hot CPU throttles, and the result names it', async () => {
    // a big processor on a plain heatsink: the chip passes its throttle point within the job
    const r = await run(rig(['psu4', 'cpu4w', 'cooler0', 'ram5', 'display0'], 'case3', 'board3'));
    expect(r.score).not.toBeNull();
    expect(r.slowed).toMatch(/The CPU ran hot \(\d+ C\): it ran at \d+% of its speed/);
  }, 60_000);

  it('a part that burns out ends the job, and the note says which', async () => {
    const r = await run(rig(['psu3', 'cpu4', 'cooler0', 'ram2', 'display0'], 'case2', 'board2'));
    expect(r.score).toBeNull();
    expect(r.note).toBe('The CPU burnt out: it ran too hot');
  }, 60_000);

  it('a machine that keeps cool and has the power says nothing', async () => {
    const r = await run(rig(['psu1', 'cpu1', 'cooler1', 'ram1', 'display0']));
    expect(r.score).not.toBeNull();
    expect(r.slowed).toBeUndefined();
    expect(r.crashed).toBeUndefined();
  }, 60_000);
});
