// A part patched away leaves nothing behind: Machine3D's public lists and the scene's tagged ids match a fresh build without the part, and
// a fresh build with it once the part is patched back in. Each patchable kind has its own case, so a new side table that patch forgets fails.
import { describe, expect, it } from 'vitest';
import type { Object3D } from 'three';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { idOf } from '@/core/render/three/pick';
import { roomGeo } from '@/features/room/render/shell/room';
import { Machine3D } from './machine3d';
import { quietCanvas } from './testutil';

/** Returns `value` when it is present, otherwise `fallback`. */
function or<T>(value: T, fallback: NonNullable<T>): NonNullable<T> {
  if (value === undefined || value === null) {
    return fallback;
  }
  return value;
}

quietCanvas();

type Device = Snapshot['devices'][number];

/** The Build my PC stage: the machine that patches. */
const stage = (s: Snapshot): Machine3D =>
  new Machine3D(s, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false });

/** An object in a list, by the part it belongs to and its own name (the cables hang again on each patch: one key for them all). */
const key = (o: Object3D): string => {
  const id = or(idOf(o), '-');
  return id.startsWith('cable') ? 'cable' : `${id}|${o.name}|${o.type}`;
};
const keys = (l: readonly Object3D[]): string[] => l.map((o) => key(o)).toSorted();
const r3 = (n: number): string => n.toFixed(3);

/** What a caller sees of the machine: its public lists, and the tagged ids shown in the scene. */
function view(m: Machine3D): Record<string, string[]> {
  m.root.updateMatrixWorld(true);
  const tagged = new Set<string>();
  m.root.traverseVisible((o) => {
    const id: unknown = o.userData['id'];
    if (typeof id === 'string' && !id.startsWith('cable')) {
      tagged.add(id);
    }
  });
  return {
    tagged: [...tagged].toSorted(),
    fades: keys(m.fades),
    apart: keys(m.apart),
    still: keys(m.still),
    caseRoots: keys(m.caseRoots),
    rails: m.rails
      .map((r) => `${r.id}|${r3(r.rect.x)},${r3(r.rect.y)},${r3(r.rect.w)},${r3(r.rect.h)}|${r3(r.z)}|${r3(r.zoom)}`)
      .toSorted(),
    rest: [...m.rest.keys()].toSorted(),
  };
}

const devs = (g: Game): Device[] => g.snapshot().devices;

function ok(r: { ok: boolean }, what: string): void {
  if (!r.ok) {
    throw new Error(`${what}: ${JSON.stringify(r)}`);
  }
}

function buy(g: Game, spec: string, slot: string): void {
  const b = g.purchase(spec);
  if (!b.ok) {
    throw new Error(`buy ${spec}: ${b.reason}`);
  }
  ok(g.install(b.invId, slot), `fit ${spec} in ${slot}`);
}

/** The liquid loop out (radiator and pump): the CPU seat is free for an air tower, or bare. */
function noLoop(g: Game): void {
  for (const d of devs(g).filter((x) => x.kind === 'radiator' || x.kind === 'cooler')) {
    ok(g.uninstall(d.id), `${d.kind} out`);
  }
}

/** A heatsink's fan off, so the heatsink can go alone. */
function fanOff(g: Game, host: string): void {
  for (const f of devs(g).filter((x) => x.kind === 'fan' && x.slot.startsWith(host))) {
    ok(g.uninstall(f.id), `${host} fan out`);
  }
}

/** Takes the first part `pick` names that the game lets go: the part, and where it waits in the inventory. */
function takeOut(g: Game, pick: (d: Device) => boolean, name: string): { part: Device; inv: string } {
  for (const d of devs(g).filter((x) => pick(x))) {
    const r = g.uninstall(d.id);
    if (r.ok && r.invId !== null) {
      return { part: d, inv: r.invId };
    }
  }
  throw new Error(`the game lets no part go for ${name}`);
}

interface Case {
  name: string;
  /** Changes to the game before the first build, so the part can go alone. */
  setup: (g: Game) => void;
  /** The parts the test may take: the first one the game lets go is taken. */
  pick: (d: Device) => boolean;
}

const none = (): void => undefined;

const cases: Case[] = [
  { name: 'a RAM stick', setup: none, pick: (d) => d.kind === 'ram' },
  {
    name: 'a GPU',
    setup: (g) => {
      buy(g, 'gpu1', 'pcie0');
    },
    pick: (d) => d.kind === 'gpu',
  },
  {
    name: 'an NPU',
    setup: (g) => {
      buy(g, 'npu1', 'pcie0');
    },
    pick: (d) => d.kind === 'npu',
  },
  { name: 'a NIC', setup: none, pick: (d) => d.kind === 'nic' },
  { name: 'an NVMe drive', setup: none, pick: (d) => d.kind === 'storage' && d.slot.startsWith('m2') },
  {
    name: 'a SATA SSD',
    setup: (g) => {
      buy(g, 'ssd1', 'sata0');
    },
    pick: (d) => d.kind === 'storage' && d.slot.startsWith('sata'),
  },
  {
    name: 'a hard drive',
    setup: (g) => {
      buy(g, 'hdd0', 'sata0');
    },
    pick: (d) => d.kind === 'storage' && d.slot.startsWith('sata'),
  },
  { name: 'the CPU', setup: noLoop, pick: (d) => d.kind === 'cpu' },
  {
    name: 'a VRM sink',
    setup: (g) => {
      fanOff(g, 'vrm-sink');
    },
    pick: (d) => d.kind === 'vrm-sink',
  },
  {
    name: 'a RAM sink',
    setup: (g) => {
      fanOff(g, 'ram-sink');
    },
    pick: (d) => d.kind === 'ram-sink',
  },
  {
    name: 'an air cooler',
    setup: (g) => {
      noLoop(g);
      buy(g, 'cooler1', 'cooler0');
    },
    pick: (d) => d.kind === 'cooler',
  },
  { name: 'a heatsink fan', setup: none, pick: (d) => d.kind === 'fan' && /-sink\d+\.fan/u.test(d.slot) },
];

/** The power lens on every part: the power skins and roots a part adds show in the lists and the tagged ids. */
const lens = (m: Machine3D, s: Snapshot): void => {
  m.powerGlow(new Map(s.devices.map((d) => [d.id, 0.5])));
};

describe.each([
  ['the build', false],
  ['the power lens', true],
])('a part patched away leaves nothing behind in %s', (_label, lit) => {
  const seen = (m: Machine3D, g: Game): Record<string, string[]> => {
    if (lit) {
      lens(m, g.snapshot());
    }
    return view(m);
  };
  it.each(cases)(
    'patches $name away and back as a fresh build',
    ({ name, setup, pick }) => {
      const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
      setup(g);
      const m = stage(g.snapshot());
      const fresh = (): Record<string, string[]> => seen(stage(g.snapshot()), g);
      const { part, inv } = takeOut(g, pick, name);
      expect(devs(g).map((d) => d.id)).not.toContain(part.id);
      expect(m.patch(g.snapshot(), roomGeo()), `${name}: a patch for the removal`).toBe(true);
      expect(seen(m, g), `${name} out`).toStrictEqual(fresh());
      ok(g.install(inv, part.slot), `${name} back`);
      expect(m.patch(g.snapshot(), roomGeo()), `${name}: a patch for the fit`).toBe(true);
      expect(seen(m, g), `${name} back`).toStrictEqual(fresh());
    },
    60_000,
  );
});
