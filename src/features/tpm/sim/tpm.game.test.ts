import { assert, describe, expect, it } from 'vitest';
import { BLOCK_BYTES, JOB_ROW, JobState, KSLOT, KSLOT_BYTES, TPM_BASE, TPM_REG, TpmStatus } from '@/core/sim/memmap';
import { JT_BASE } from '@/features/os/sim';
import { getOsSpec, SPOOL_BLOCKS_PER_JOB } from '../../os/sim';
import { Game } from '@/worker/game/game';
import { Operator } from '../../economy/sim/operator';
import { generate } from '../../jobs/sim/gen';
import { advance, newHost, takeCrash } from '@/worker/host';
import { econ } from '@/worker/game/testkit';

const maxed = () => new Game({ seed: 3, sandbox: true, preassembled: true, maxed: true, economy: econ() });
const buy = (g: Game, id: string): string => {
  const r = g.purchase(id);
  if (!r.ok) {
    throw new Error(`${id}: ${r.reason}`);
  }
  return r.invId;
};

/** Steps the game and the bot until `done` or `max` ticks; returns the ticks taken. */
function runBot(g: Game, done: () => boolean, max: number): number {
  const op = new Operator(g, 1);
  let ticks = 0;
  while (!done() && ticks < max) {
    g.advanceBaseTick();
    op.step();
    ticks++;
  }
  return ticks;
}

/** What the TPM does when protected mode refuses an access: it flags a violation for the game to act on (the flag is its own). */
function flagViolation(g: Game): void {
  const holder: object = g.tpm;
  if (!('violated' in holder)) {
    throw new TypeError('the TPM has no violation flag');
  }
  Object.assign(holder, { violated: true });
}

/** Whether the TPM guards a paged range whose first virtual page sits in a frame other than the identical one (read checked: its own fields). */
function rangeShifted(g: Game): boolean {
  const holder: object = g.tpm;
  if (!('range' in holder) || !('frames' in holder)) {
    throw new TypeError('the TPM has no range or frames');
  }
  const { range, frames } = holder;
  if (!(frames instanceof Set) || typeof range !== 'object' || range === null || !('lo' in range)) {
    return false;
  }
  return typeof range.lo === 'number' && !frames.has(range.lo >>> 8);
}

const keysAround = (g: Game): number => g.snapshot().tray.length + (g.pluggedKey() === null ? 0 : 1);

describe('a TPM in the machine', () => {
  it('is on the bus once installed in the header, and gone when taken out', () => {
    const g = maxed();
    const status = () => g.machine.bus.load32(TPM_BASE + TPM_REG.STATUS);
    expect(status()).toBe(0);
    expect(g.install(buy(g, 'tpm1')).ok).toBe(true);
    g.advanceBaseTick();
    expect(status()).toBe(TpmStatus.Present);
    const tpm1Device = g.board.devices.find((d) => d.spec === 'tpm1');
    assert.exists(tpm1Device);
    expect(g.uninstall(tpm1Device.id).ok).toBe(true);
    g.advanceBaseTick();
    expect(status()).toBe(0);
  });

  it('a secure job waits for a TPM, then runs with one', () => {
    const g = maxed();
    g.clearQueue();
    expect(g.spawnKey('secure').ok).toBe(true);
    expect(g.snapshot().tray.find((k) => k.cls === 'secure')).toMatchObject({ runnable: false, missing: ['a TPM'] });
    g.install(buy(g, 'tpm1'));
    g.advanceBaseTick();
    expect(g.snapshot().tray.find((k) => k.cls === 'secure')).toMatchObject({ runnable: true });
    runBot(g, () => g.completed >= 1, 60_000);
    expect(g.completed).toBe(1);
    expect(g.errors).toBe(0);
  });

  it('a job that strays in protected mode crashes the machine and restarts the job, like a thermal error', () => {
    const g = maxed();
    g.install(buy(g, 'tpm1'));
    g.clearQueue();
    g.spawnKey('secure');
    runBot(g, () => g.currentPhase().includes('running'), 5000);
    expect(g.currentPhase()).toMatch(/running/u);
    const { errors } = g;
    // what the TPM does when protected mode refuses an access (tpm.test.ts covers the refusal itself)
    flagViolation(g);
    g.advanceBaseTick();
    expect(g.errors).toBe(errors + 1);
    expect(g.snapshot().log.some((e) => e.text.includes('protected-mode violation'))).toBe(true);
    expect(keysAround(g)).toBeGreaterThan(0); // the job is not lost, it restarts
  });

  it('a TPM needs ECC RAM: without it the module is off the bus and a secure job is not runnable', () => {
    const g = maxed();
    g.install(buy(g, 'tpm1'));
    g.advanceBaseTick();
    expect(g.eccInstalled()).toBe(true);
    expect(g.machine.bus.load32(TPM_BASE + TPM_REG.STATUS)).toBe(TpmStatus.Present);
    // swap every stick for plain RAM
    for (const d of g.board.devices.filter((x) => x.spec.startsWith('ram'))) {
      g.uninstall(d.id);
    }
    g.install(buy(g, 'ram2'));
    g.clearQueue();
    g.spawnKey('secure');
    g.advanceBaseTick();
    expect(g.eccInstalled()).toBe(false);
    expect(g.machine.bus.load32(TPM_BASE + TPM_REG.STATUS)).toBe(0);
    expect(g.snapshot().tray.find((k) => k.cls === 'secure')).toMatchObject({
      runnable: false,
      missing: ['a TPM', 'ECC RAM'].filter((x) => x !== 'a TPM'),
    });
  });
});

/** Advances the host one base tick at a time until `done`, or `max` ticks; calls `each` after every tick. */
function runHost(tick: () => void, done: () => boolean, { max, each }: { max: number; each?: () => void }): void {
  for (let t = 0; t < max && !done(); t++) {
    tick();
    each?.();
  }
}

describe('protected mode under the paged OS', { timeout: 600_000 }, () => {
  it('secure jobs whose frames are not at their virtual addresses neither trip their own guard nor crash the host', () => {
    const g = maxed();
    g.install(buy(g, 'tpm1'));
    g.clearQueue();
    const h = newHost();
    h.game = g;
    h.speed = 64;
    const tick = (): void => {
      advance(h, 1000 / 64);
    }; // exactly one base tick
    g.powerButton();
    runHost(tick, () => g.currentPhase() === 'idle-os', { max: 20_000 });
    expect(g.currentPhase()).toBe('idle-os');
    // Straight into the kernel's job slots (as threads4.test.ts does): the fillers hold the low frames, so the secure jobs' image sits elsewhere.
    const { os } = g;
    assert.exists(os);
    const osDevice = g.board.devices.find((d) => d.id === os.deviceId);
    assert.exists(osDevice);
    const disk = g.diskFor(osDevice);
    const os4GetOsSpec = getOsSpec('os4');
    assert.exists(os4GetOsSpec);
    const spool = Math.ceil(os4GetOsSpec.diskBytes / BLOCK_BYTES);
    const dv = new DataView(g.machine.ram.buffer);
    const jobs = ['cli.log', 'cli.calc', 'secure.sign', 'secure.sign'].map((t, k) =>
      generate(t, 5 + k, { row: JOB_ROW, scale: 1, hosted: true }),
    );
    for (const [k, { program }] of jobs.entries()) {
      const lba = spool + k * SPOOL_BLOCKS_PER_JOB,
        at = JT_BASE + k * KSLOT_BYTES;
      disk.poke(lba, new Uint8Array(program.buffer, program.byteOffset, program.length * 4));
      dv.setUint32(at + KSLOT.KEY, 100 + k, true);
      dv.setUint32(at + KSLOT.LEN, program.length, true);
      dv.setUint32(at + KSLOT.LBA, lba, true);
      dv.setUint32(at + KSLOT.SEQ, k + 1, true);
      dv.setUint32(at + KSLOT.STATE, JobState.Queued, true);
    }
    const states = (): number[] => jobs.map((_, k) => dv.getUint32(JT_BASE + k * KSLOT_BYTES + KSLOT.STATE, true));
    let shifted = false;
    runHost(tick, () => states().every((s) => s === JobState.Result), {
      max: 60_000,
      // the job's first virtual page (its image) sits in a frame other than the identical one
      each: () => {
        shifted ||= rangeShifted(g);
      },
    });
    expect(takeCrash(h)).toStrictEqual([]);
    expect(states().every((s) => s === JobState.Result)).toBe(true);
    expect(g.errors).toBe(0);
    expect(g.snapshot().log.some((e) => e.text.includes('protected-mode violation'))).toBe(false);
    expect(shifted).toBe(true);
  });
});
