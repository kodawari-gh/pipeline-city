import { describe, expect, it } from 'vitest';
import { advance, handleMessage, newHost, takeCrash } from './host';
import { rig } from './game/testkit';
import { REG_COUNT } from '../features/cpu/sim/isa/isa';
import { parseSave } from './game/save';
import { crashReport, describePc, pcOf, wordsHex } from './crash';

const FAULT = new RangeError('illegal instruction 0x0 at pc=0xd310');

describe('crash report pieces', () => {
  it('reads the address out of an engine error', () => {
    expect(pcOf('illegal instruction 0x0 at pc=0xd2c4')).toBe(0xd2c4);
    expect(pcOf('something else')).toBeNull();
  });

  it('says where an address lives: inside a region, past the end of one, outside RAM, or unaligned', () => {
    const regions = [{ name: 'kernel', lo: 0xc100, hi: 0xc200 }];
    expect(describePc(0xc120, regions, 0x10000, 0x1234)).toMatch(/inside "kernel".*0x00001234/);
    expect(describePc(0xd310, regions, 0x10000, 0)).toMatch(/4368 bytes past the end of "kernel".*0xc200.*ran off the end/);
    expect(describePc(0x20000, regions, 0x10000, null)).toMatch(/outside RAM/);
    expect(describePc(0xc121, regions, 0x10000, null)).toMatch(/not word aligned/);
  });

  it('dumps RAM words eight to a line and stops at the end of RAM', () => {
    const ram = new Uint8Array(64);
    new DataView(ram.buffer).setUint32(4, 0xdeadbeef, true);
    expect(wordsHex(ram, 0, 10).split('\n')).toEqual(['0000: 00000000 deadbeef 00000000 00000000 00000000 00000000 00000000 00000000', '0020: 00000000 00000000']);
    expect(wordsHex(ram, 56, 8)).toBe('0038: 00000000 00000000');
  });
});

describe('a crash report from a running game', () => {
  it('names the address, what is there, the cores and the OS, and carries a save that loads', () => {
    const g = rig('ssd1', { keys: [{ template: 'cli.log' }] });
    g.powerButton();
    for (let t = 0; t < 400 && g.currentPhase() !== 'idle-os'; t++) g.advanceBaseTick();
    const r = crashReport(g, FAULT);
    expect(r.fault.pc).toBe(0xd310);
    expect(r.fault.where).toMatch(/past the end of/);
    expect(r.headline).toContain('illegal instruction 0x0 at pc=0xd310');
    expect(r.os).not.toBeNull();
    expect(r.cores.length).toBeGreaterThan(0);
    expect(r.cores[0]!.regs).toHaveLength(REG_COUNT);
    expect(r.windows.map((w) => w.base)).toContain(0xe000);
    expect(r.text).toContain('core 0:');
    expect(r.faultCore).toBe(g.machine.bus.core);
    expect(r.text).toContain('faulting core');
    expect(r.text).toContain(r.os!.name);
    expect(r.machine).toMatchObject({ cores: g.machine.cores.length, busCore: g.machine.bus.core });
    expect(r.text).toContain('machine: ');
    expect(r.text).not.toContain('OUT OF RANGE');
    expect(r.text).toContain('regression test');
    g.machine.bus.core = 7; // a stale index, as after a CPU swap
    expect(crashReport(g, FAULT).text).toContain('OUT OF RANGE');
    expect(JSON.parse(JSON.stringify(r))).toEqual(r); // plain data: it crosses the worker boundary and downloads as JSON
    expect(() => parseSave(JSON.parse(JSON.stringify(r.save)))).not.toThrow();
  });

  it('without a game it still says what failed', () => {
    const r = crashReport(null, new Error('boom'));
    expect(r.headline).toContain('boom');
    expect(r.save).toBeUndefined();
  });
});

describe('the host on a crash', () => {
  const started = () => {
    const h = newHost();
    handleMessage(h, { type: 'init', seed: 1 });
    return h;
  };

  it('pauses the sim, keeps the report and posts it once instead of throwing again every tick', () => {
    const h = started();
    h.game!.advanceBaseTick = () => { throw FAULT; };
    expect(() => advance(h, 1000)).not.toThrow();
    expect(h.speed).toBe(0);
    const posted = takeCrash(h);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ type: 'crash', report: { fault: { pc: 0xd310 } } });
    expect(takeCrash(h)).toEqual([]);
    expect(advance(h, 5000)).toBe(0); // paused: nothing runs, nothing throws
    expect(takeCrash(h)).toEqual([]);
  });

  it('a throw while handling an action also reports, next to the error', () => {
    const h = started();
    h.game!.powerButton = () => { throw FAULT; };
    const r = handleMessage(h, { type: 'powerButton' });
    expect(r.map((m) => m.type)).toEqual(['error', 'crash']);
    expect(h.speed).toBe(0);
  });
});
