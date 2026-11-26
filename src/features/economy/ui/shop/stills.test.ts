import { assert, describe, expect, it, vi } from 'vitest';
import { stillIds } from './shopdata';

/** The parts of `node:fs` this test reads with. */
interface NodeFs {
  readFileSync: (path: string, encoding: 'utf8') => string;
  existsSync: (path: string) => boolean;
}

/** The part of `node:url` this test uses. */
interface NodeUrl {
  fileURLToPath: (url: URL) => string;
}

interface Manifest {
  w: number;
  h: number;
  stills: Record<string, string>;
}

const fs = await vi.importActual<NodeFs>('node:fs');
const { fileURLToPath } = await vi.importActual<NodeUrl>('node:url');
const STILLS: string = fileURLToPath(new URL('../../../../../public/stills/', import.meta.url));

const isManifest = (v: unknown): v is Manifest =>
  typeof v === 'object' && v !== null && 'w' in v && 'h' in v && 'stills' in v;

/** The baked stills' manifest. */
function manifest(): Manifest {
  const text = fs.readFileSync(`${STILLS}manifest.json`, 'utf8');
  const parsed: unknown = JSON.parse(text);
  assert(isManifest(parsed), 'manifest.json has the tile size and the stills');
  return parsed;
}

describe('the shop stills', () => {
  // (a part added to the gallery, a router or a plan needs its still: `npm run stills -- --only <id>`)
  it('has a baked still for every part the shop sells (the gallery, the routers, the plans), and none for a part it no longer has', () => {
    const m = manifest();
    const ids = stillIds();
    expect(Object.keys(m.stills).toSorted()).toStrictEqual([...ids].toSorted());
    for (const id of ids) {
      expect(fs.existsSync(`${STILLS}${id}.webp`), `still ${id}`).toBe(true);
    }
    // the tiles' 120 x 84 shape
    expect(m.w / m.h).toBeCloseTo(120 / 84);
  });
});
