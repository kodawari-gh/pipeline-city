import { describe, expect, it } from 'vitest';
import type { RamMap } from '../sim/game/pipesnap';
import { vmNote } from './ramview';

const map = (vm: RamMap['vm']): RamMap => ({ bytes: 65536, filled: [], code: [], regions: [], image: new Uint8Array(0), vm });

describe('the page-table note of the RAM magnifier', () => {
  it('names the virtual address and rights of the page, per program', () => {
    const m = map({ spaces: [{ label: '#07 scan', table: 0xb000, tables: [0xb0], pages: [0x10, 0x20, 7, 0x42, 0x30, 3] }, { label: '#08 calc', table: 0xb800, tables: [], pages: [0x10, 0x20, 5] }] });
    expect(vmNote(m, 0x2010)).toBe('#07 scan: virtual 0x1000 RWX | #08 calc: virtual 0x1000 R-X');
    expect(vmNote(m, 0x3000)).toBe('#07 scan: virtual 0x4200 RW-');
    expect(vmNote(m, 0x9000)).toBe('');
    expect(vmNote(map(undefined), 0x2010)).toBe('');
  });
});
