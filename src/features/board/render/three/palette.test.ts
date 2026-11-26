// The count of distinct base colours in the machine and the room (docs/3D_STYLE.md "Asset standard" §1, ASR9). Colours that the eye
// cannot tell apart must be one colour: uniformity first. The ceiling is today's count; a new colour needs a reason.
/* oxlint-disable import/max-dependencies -- the test names every module that owns a base colour */
import { describe, expect, it, vi } from 'vitest';
import type { Mesh, Material, Object3D } from 'three';

import { builtinTheme } from '@/core/render/theme';
import { CERAMIC, FAMILY, LAMINATE, NYLON } from '@/core/render/three/materials';
import { SKINS, hexNum } from '@/features/board/render/skins';
import { JACK, USB_TONGUE } from '@/features/board/render/three/casedetail3d';
import { strapTone } from '@/features/board/render/three/casetray3d';
import { LAN_LEAD } from '@/features/board/render/three/machine3d';
import {
  BARK,
  CEILING as ROOM_CEILING,
  DUVET,
  KEY_ACCENT,
  LANTERN,
  MANILA,
  NEON,
  NEON_WASH,
  OAK,
  OAK_GRAIN,
  OPAL,
  PAPER,
  RUG_LINE,
  RUG_WOOL,
  RUNNER,
  SHEET,
  SOIL,
  STEEL,
  STEM,
  STONE,
  STONEWARE,
  TEA,
  TRIM,
  VENEER,
  VENEER_GRAIN,
  WALL,
} from '@/features/room/render/three/palette';
import { LEAF_TINTS } from '@/features/room/render/three/plants3d';
import { Room3D } from '@/features/room/render/three/room3d';
import { buildMachine, maxedSnapshot, quietCanvas } from './testutil';

interface DirEntry {
  name: string;
  isDirectory: () => boolean;
}

interface NodeFs {
  readdirSync: (path: string | URL, options: { withFileTypes: true }) => DirEntry[];
  readFileSync: (path: string | URL, encoding: 'utf8') => string;
}

/** The parts of `node:process` this test uses: the dump switch and the place the dump goes. */
interface NodeProcess {
  env: Record<string, string | undefined>;
  stdout: { write: (text: string) => boolean };
}

const fs = await vi.importActual<NodeFs>('node:fs');
const { env, stdout } = await vi.importActual<NodeProcess>('node:process');

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

const isMesh = (o: unknown): o is Mesh => typeof o === 'object' && o !== null && 'isMesh' in o && o.isMesh === true;

quietCanvas();

function hexOf(color: unknown): number | undefined {
  if (typeof color !== 'object' || color === null || !('getHex' in color)) {
    return undefined;
  }
  const { getHex } = color;
  if (typeof getHex !== 'function') {
    return undefined;
  }
  const n: unknown = getHex.call(color);
  return typeof n === 'number' ? n : undefined;
}

/** Plain base colours under `root` (no map, no glow, not see-through), each with its count of materials. */
export function baseColours(root: Object3D): Map<number, number> {
  const seen = new Set<Material>(),
    out = new Map<number, number>();
  root.traverse((o) => {
    if (!isMesh(o)) {
      return;
    }
    const mesh = o;
    for (const m of [mesh.material].flat()) {
      if (seen.has(m)) {
        continue;
      }
      const color = 'color' in m ? m.color : undefined;
      const map = 'map' in m ? m.map : undefined;
      const hex = hexOf(color);
      if (hex === undefined || (map !== undefined && map !== null) || m.transparent) {
        continue;
      }
      seen.add(m);
      const emissiveHex = 'emissive' in m ? hexOf(m.emissive) : undefined;
      const emissiveIntensity =
        'emissiveIntensity' in m && typeof m.emissiveIntensity === 'number' ? m.emissiveIntensity : 0;
      if (emissiveHex !== undefined && emissiveHex !== 0 && emissiveIntensity > 0) {
        continue;
      }
      out.set(hex, or(out.get(hex), 0) + 1);
    }
  });
  return out;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** The ceilings of distinct base colours: the machine, the room. */
const CEILING = { machine: 23, room: 20 };

/** OPEN: literals that no decision names yet (not decided yet). Do not add to this list without a decision. */
const OPEN: number[] = [];

/** The distance of two colours: the sum of the channel differences (0-765). */
const colourDistance = (a: number, b: number) =>
  Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));

/** Pairs of colours nearer than `near` (sum of the channel differences, 0-765). */
export function nearPairs(colours: number[], near: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (let i = 0; i < colours.length; i++) {
    for (let j = i + 1; j < colours.length; j++) {
      const k = colourDistance(must(colours[i]), must(colours[j]));
      if (k <= near) {
        out.push([must(colours[i]), must(colours[j]), k]);
      }
    }
  }
  return out.toSorted((a, b) => a[2] - b[2]);
}

function assert_stay_under_the_ceiling(): void {
  const machine = baseColours(buildMachine(maxedSnapshot(), false).root),
    room = baseColours(new Room3D().root);
  for (const [name, set] of [
    ['machine', machine],
    ['room', room],
  ] as const) {
    const list = [...set.keys()].toSorted((a, b) => a - b),
      pairs = nearPairs(list, 12);
    stdout.write(`${name}: ${list.length} base colours, ${pairs.length} pairs nearer than 12\n`);
    if (env['PALETTE_DUMP'] === '1') {
      stdout.write(`${list.map((c) => `${hex(c)} x${or(set.get(c), 0)}`).join('\n')}\n`);
      stdout.write(`${pairs.map(([a, b, k]) => `${hex(a)} ${hex(b)} ${k}`).join('\n')}\n`);
    }
    expect(list.length).toBeLessThanOrEqual(CEILING[name]);
  }
}

function assert_every_mat_literal_is_a_family_colour(): void {
  const allowed = new Set<number>([...FAMILY, 0xff_ff_ff, 0x00_00_00, 0x0d_16_36, 0x3b_e3_ff, 0xa6_8b_ff, ...OPEN]);
  const bad: string[] = [];
  let files = 0;
  const scanFile = (at: URL) => {
    files++;
    for (const [i, line] of fs.readFileSync(at, 'utf8').split('\n').entries()) {
      for (const m of line.matchAll(/\b(?:mat|cloth)\(0x(?<hex>[0-9a-fA-F]{6})\b/gu)) {
        const v = Number.parseInt(must(m.groups?.['hex']), 16);
        if (!allowed.has(v)) {
          bad.push(`${at.pathname}:${i + 1} ${hex(v)}`);
        }
      }
    }
  };
  const walk = (dir: URL) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const at = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
      if (e.isDirectory()) {
        walk(at);
      } else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
        scanFile(at);
      }
    }
  };
  walk(new URL('../../../../features/', import.meta.url));
  walk(new URL('../../../../core/', import.meta.url));
  expect(files, 'files read').toBeGreaterThan(100);
  expect(bad).toStrictEqual([]);
}

/** A colour as a number, from a number or a hex string. */
const h = (c: string | number): number => (typeof c === 'number' ? c : hexNum(c));

function assert_every_base_colour_at_run_time_has_a_name(): void {
  const theme = builtinTheme();
  const named = new Set<number>([
    ...FAMILY,
    0xff_ff_ff,
    0x00_00_00,
    0x0d_16_36,
    0x3b_e3_ff,
    0xa6_8b_ff,
    NYLON,
    CERAMIC,
    LAMINATE,
    ...Object.values(JACK),
    ...USB_TONGUE,
    h(LAN_LEAD),
    ...SKINS.map((sk) => hexNum(sk.accent)),
    // (a case's accent is the theme's alu or mul colour, case3d.ts; its strap tab is that accent muted, casetray3d.ts)
    h(theme.alu),
    h(theme.mul),
    strapTone(h(theme.alu)),
    strapTone(h(theme.mul)),
    ...[
      WALL,
      ROOM_CEILING,
      TRIM,
      VENEER,
      VENEER_GRAIN,
      OAK,
      OAK_GRAIN,
      STEEL,
      SHEET,
      DUVET,
      RUNNER,
      RUG_WOOL,
      RUG_LINE,
      STONE,
      STONEWARE,
      PAPER,
      MANILA,
      OPAL,
      BARK,
      STEM,
      SOIL,
      TEA,
      KEY_ACCENT,
      NEON,
      NEON_WASH,
      LANTERN,
    ].map((c) => h(c)),
    ...LEAF_TINTS,
  ]);
  const seen = [
    ...baseColours(buildMachine(maxedSnapshot(), false).root).keys(),
    ...baseColours(new Room3D().root).keys(),
  ];
  const unnamed = [...new Set(seen.filter((c) => !named.has(c)))].toSorted((a, b) => a - b);
  expect(unnamed.map((c) => hex(c))).toStrictEqual([]);
}

describe('the base colours', () => {
  it('stay under the ceiling', () => {
    expect.hasAssertions();
    assert_stay_under_the_ceiling();
  }, 120_000);

  it('every mat() literal is a family colour', () => {
    expect.hasAssertions();
    assert_every_mat_literal_is_a_family_colour();
  });

  it('every base colour at run time has a name', () => {
    expect.hasAssertions();
    assert_every_base_colour_at_run_time_has_a_name();
  }, 120_000);
});
