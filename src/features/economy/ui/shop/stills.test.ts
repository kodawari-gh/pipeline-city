// @ts-ignore
import * as fsMod from 'node:fs';
// @ts-ignore
import * as urlMod from 'node:url';
import { describe, expect, it } from 'vitest';
import { galleryGroups } from './shopdata';

const fs = fsMod as any;
const STILLS: string = urlMod.fileURLToPath(new URL('../../../../../public/stills/', import.meta.url));

describe('the shop stills', () => {
  // (a part added to the gallery needs its still: `npm run stills -- --only <id>`)
  it('has a baked still for every part the gallery shows, and none for a part it no longer has', () => {
    const m = JSON.parse(fs.readFileSync(STILLS + 'manifest.json', 'utf8')) as { w: number; h: number; stills: Record<string, string> };
    const ids = galleryGroups().flatMap((g) => g.items.map((i) => i.id));
    expect(Object.keys(m.stills).sort()).toEqual([...ids].sort());
    for (const id of ids) expect(fs.existsSync(`${STILLS}${id}.webp`), id).toBe(true);
    // the tiles' 120 x 84 shape
    expect(m.w / m.h).toBeCloseTo(120 / 84);
  });
});
