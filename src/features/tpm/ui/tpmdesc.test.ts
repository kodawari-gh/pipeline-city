import { describe, expect, it } from 'vitest';
import type { TpmView } from '../sim/tpm';
import { headerRect, tpmHeader } from '@/core/render/accelart';
import { setLayoutTier } from '../../board/render/layout/layout';
import { tpmIds } from '../render/tpmlayout';
import { describeId } from '@/core/ui/logic';
import { dev, snap } from '@/core/ui/testdata';
import { isTpmId } from './tpmdesc';

const view = (o: Partial<TpmView> = {}): TpmView => ({
  phase: 'idle', cmd: 0, arg0: 0, arg1: 0, result: 0, fault: 0, busy: false, error: false, done: false, wait: 0, span: 0, range: null, hashed: 0, partial: 0,
  sealed: [], log: [], commands: 0, measuredWords: 0, guardedAccesses: 0, lastViolation: -1, measureTicks: 4, attestTicks: 60, surcharge: 2, ramBytes: 16384, ...o,
});

describe('the words for the secure module', () => {
  it('describes every part the board writes, with the module on and off', () => {
    setLayoutTier(3, 3);
    const hdr = headerRect(tpmHeader(3)!);
    for (const [spec, visual] of [['tpm1', 'tpm-1'], ['tpm2', 'tpm-2']] as const) {
      const s = snap({ devices: [dev({ id: 't1', spec, kind: 'tpm', slot: 'tpm0', tempC: 33 })], tpm: view({ range: { lo: 0x1000, hi: 0x2000 }, fault: 4, lastViolation: 0x3000, sealed: [{ handle: 9, value: 7 }] }) });
      const ids = tpmIds(visual, 'tpm0', hdr);
      expect(ids.length, visual).toBeGreaterThanOrEqual(9);
      for (const id of ids) {
        expect(isTpmId(id), id).toBe(true);
        for (const d of [describeId(id, s), describeId(id)]) {
          expect(d, `${visual} ${id}`).not.toBeNull();
          expect(d!.title.length, `${id} title`).toBeGreaterThan(2);
          expect(d!.plain.length, `${id} plain`).toBeGreaterThan(10);
          expect(d!.nerd.length, `${id} nerd`).toBeGreaterThan(10);
        }
      }
    }
  });

  it('says what the module is doing now, and ignores ids that are not its parts', () => {
    const s = snap({ devices: [dev({ id: 't1', spec: 'tpm1', kind: 'tpm', slot: 'tpm0' })], tpm: view({ range: { lo: 0x1000, hi: 0x2000 }, surcharge: 2, guardedAccesses: 5 }) });
    expect(describeId('tpm0.guard', s)!.nerd).toMatch(/protected 0x1000 to 0x2000.*\+2 cycles.*5 guarded/);
    expect(describeId('tpm0.guard')!.nerd).toMatch(/^off/);
    expect(describeId('tpm0.hash')!.nerd).toMatch(/h = h \* 33/);
    expect(describeId('tpm0.nonsense', s)).toBeNull();
    expect(isTpmId('tpm0.regs')).toBe(true);
    expect(isTpmId('tpm0')).toBe(false);
    expect(isTpmId('pcie0.lane3')).toBe(false);
  });
});
