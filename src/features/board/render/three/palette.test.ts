// The count of distinct base colours in the machine and the room (docs/3D_STYLE.md "Asset standard" §1, ASR9). Colours that the eye
// cannot tell apart must be one colour: uniformity first. The ceiling is today's count; a new colour needs a reason.
import { describe, expect, it } from 'vitest';
// No @types/node in this project: the file system is reached through untyped imports (tests only).
// @ts-ignore
import * as fsMod from 'node:fs';
import { type Material, type Mesh, type MeshStandardMaterial, type Object3D } from 'three';
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

quietCanvas();

/** Plain base colours under `root` (no map, no glow, not see-through), each with its count of materials. */
export function baseColours(root: Object3D): Map<number, number> {
  const seen = new Set<Material>(),
    out = new Map<number, number>();
  root.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh) return;
    for (const m of [mesh.material].flat()) {
      const s = m as MeshStandardMaterial;
      if (seen.has(m) || !s.color || s.map || m.transparent) continue;
      seen.add(m);
      if (s.emissive && s.emissive.getHex() !== 0 && s.emissiveIntensity > 0) continue;
      out.set(s.color.getHex(), (out.get(s.color.getHex()) ?? 0) + 1);
    }
  });
  return out;
}

/** Pairs of colours nearer than `near` (sum of the channel differences, 0-765). */
export function nearPairs(colours: number[], near: number): [number, number, number][] {
  const d = (a: number, b: number) =>
    Math.abs((a >> 16) - (b >> 16)) + Math.abs(((a >> 8) & 255) - ((b >> 8) & 255)) + Math.abs((a & 255) - (b & 255));
  const out: [number, number, number][] = [];
  for (let i = 0; i < colours.length; i++)
    for (let j = i + 1; j < colours.length; j++) {
      const k = d(colours[i]!, colours[j]!);
      if (k <= near) out.push([colours[i]!, colours[j]!, k]);
    }
  return out.sort((a, b) => a[2] - b[2]);
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};

/** The ceilings of distinct base colours: the machine, the room. */
const CEILING = { machine: 23, room: 20 };

/** OPEN: literals that no decision names yet (not decided yet). Do not add to this list without a decision. */
const OPEN: number[] = [];

describe('the base colours', () => {
  it('stay under the ceiling', () => {
    const machine = baseColours(buildMachine(maxedSnapshot(), false).root),
      room = baseColours(new Room3D().root);
    for (const [name, set] of [
      ['machine', machine],
      ['room', room],
    ] as const) {
      const list = [...set.keys()].sort((a, b) => a - b),
        pairs = nearPairs(list, 12);
      console.log(`${name}: ${list.length} base colours, ${pairs.length} pairs nearer than 12`);
      if (env.PALETTE_DUMP === '1') {
        console.log(list.map((c) => `${hex(c)} x${set.get(c)}`).join('\n'));
        console.log(pairs.map(([a, b, k]) => `${hex(a)} ${hex(b)} ${k}`).join('\n'));
      }
      expect(list.length, name).toBeLessThanOrEqual(CEILING[name]);
    }
  }, 120_000);

  it('every mat() literal is a family colour', () => {
    const allowed = new Set<number>([...FAMILY, 0xffffff, 0x000000, 0x0d1636, 0x3be3ff, 0xa68bff, ...OPEN]);
    const fs = fsMod as any,
      bad: string[] = [];
    let files = 0;
    const walk = (dir: URL) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true }) as { name: string; isDirectory(): boolean }[]) {
        const at = new URL(e.name + (e.isDirectory() ? '/' : ''), dir);
        if (e.isDirectory()) walk(at);
        else if (e.name.endsWith('.ts') && !e.name.endsWith('.test.ts')) {
          files++;
          (fs.readFileSync(at, 'utf8') as string).split('\n').forEach((line, i) => {
            for (const m of line.matchAll(/\b(?:mat|cloth)\(0x([0-9a-fA-F]{6})\b/g)) {
              const v = Number.parseInt(m[1]!, 16);
              if (!allowed.has(v)) bad.push(`${at.pathname}:${i + 1} ${hex(v)}`);
            }
          });
        }
      }
    };
    walk(new URL('../../../../features/', import.meta.url));
    walk(new URL('../../../../core/', import.meta.url));
    expect(files, 'files read').toBeGreaterThan(100);
    expect(bad).toEqual([]);
  });

  it('every base colour at run time has a name', () => {
    const h = (c: string | number): number => (typeof c === 'number' ? c : hexNum(c));
    const theme = builtinTheme();
    const named = new Set<number>([
      ...FAMILY,
      0xffffff,
      0x000000,
      0x0d1636,
      0x3be3ff,
      0xa68bff,
      NYLON,
      CERAMIC,
      LAMINATE,
      ...Object.values(JACK),
      ...USB_TONGUE,
      h(LAN_LEAD),
      ...SKINS.map((s) => hexNum(s.accent)),
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
      ].map(h),
      ...LEAF_TINTS,
    ]);
    const seen = [
      ...baseColours(buildMachine(maxedSnapshot(), false).root).keys(),
      ...baseColours(new Room3D().root).keys(),
    ];
    const unnamed = [...new Set(seen.filter((c) => !named.has(c)))].sort((a, b) => a - b);
    expect(unnamed.map(hex), 'unnamed base colours').toEqual([]);
  }, 120_000);
});
