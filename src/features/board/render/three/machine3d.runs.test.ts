// What the power lens follows of the machine (docs/render/power.md): `Machine3D.cableRuns` (each cable's strands as the sleeves are made from them, in the order the
// power goes), `cablesRev`, `heldCables` and `partBox`.
import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, type Object3D } from 'three';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { Machine3D } from './machine3d';
import { SWISS, swissEngage } from './plugs3d';
import type { CableRun } from './power/runs';
import { ROOM_SOCKET } from './swisssocket3d';
import { quietCanvas } from './testutil';

quietCanvas();

const maxed = (): Game => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
/** The biggest machine with a graphics card in the first slot (a card that needs a lead of its own: the lead comes from the supply too). */
const withGpu = (): Game => {
  const g = maxed(),
    bought = g.purchase('gpu2');
  if (bought.ok) g.install(bought.invId, 'pcie0');
  return g;
};
const machine = (g: Game): Machine3D =>
  new Machine3D(g.snapshot(), roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false });
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!);
/** The cables that carry data, not power: the lens leaves them out. */
const DATA = new Set(['video', 'lan']);

describe('Machine3D.cableRuns', () => {
  // (built when the file's canvases are quiet: `quietCanvas` sets them in a `beforeAll`)
  let snap: Snapshot, runs: CableRun[];
  const run = (id: string) => runs.find((r) => r.id === id)!;
  beforeAll(() => {
    const g = maxed();
    snap = g.snapshot();
    runs = machine(g).cableRuns();
  });

  it('has a run for every cable that carries power', () => {
    for (const c of snap.cables) if (!DATA.has(c.id)) expect(run(c.id), c.id).toBeDefined();
  });

  it('keeps real points: two or more in a strand, every one a number, a sleeve and a unit way out of the socket', () => {
    for (const r of runs) {
      expect(r.strands.length, r.id).toBeGreaterThan(0);
      for (const s of r.strands) {
        expect(s.length, r.id).toBeGreaterThan(1);
        for (const p of s) for (const v of p) expect(Number.isFinite(v), r.id).toBe(true);
      }
      expect(r.r, r.id).toBeGreaterThan(0);
      expect(Math.hypot(...r.seat.axis), r.id).toBeCloseTo(1, 3);
      expect(r.seated).toBe(true);
      expect(r.held).toBe(false);
    }
  });

  it('runs a lead from the supply to its plug, and a fan cord from its header out to the fan', () => {
    // (the 24-pin ends at its socket on the board's east edge; the strands come from behind the tray)
    for (const id of ['atx', 'cpu'])
      for (const s of run(id).strands) expect(dist(s[s.length - 1]!, run(id).seat.at), id).toBeLessThan(700);
    for (const id of ['cpufan', 'vrmfan', 'ramfan', 'sysfan', 'fan:front0', 'fan:rear'])
      expect(dist(run(id).strands[0]![0]!, run(id).seat.at), id).toBeLessThan(150);
  });

  it('runs a mains cord from the wall up to its device', () => {
    for (const id of ['pcmains', 'monmains']) {
      const s = run(id).strands[0]!;
      // (world y is up: the wall socket is under the desk, its device above it)
      expect(s[0]![1], id).toBeLessThan(s[s.length - 1]![1]!);
    }
  });

  it("plugs each mains cord into its recess of the room's Swiss plate: the seat on the plate's face, a type 12 plug at the plate's scale, drawn out clear of its pins", () => {
    const g = roomGeo(),
      m = machine(maxed());
    for (const [id, o] of [
      ['pcmains', g.socket.pc],
      ['monmains', g.socket.mon],
    ] as const) {
      const rig = m.rig(id)!;
      expect(rig.seat.at, id).toEqual([o.x, -o.y, ROOM_SOCKET.face]);
      expect(rig.seat.axis, id).toEqual([0, 0, 1]);
      expect(rig.engage, id).toBe(swissEngage(ROOM_SOCKET.k));
      expect(rig.engage, id).toBeGreaterThan((SWISS.head.l + SWISS.pin.l) * ROOM_SOCKET.k);
      // (the plug is 39 mm across at the plate's scale, as the recess it goes into)
      const b = new Box3().setFromObject(rig.model().root),
        across = (b.max.x - b.min.x) / ROOM_SOCKET.k;
      expect(across, id).toBeGreaterThan(39);
      expect(across, id).toBeLessThan(41);
    }
  });

  it("hands the lens the room's plate as the source: its outline, y up", () => {
    const p = roomGeo().socket.plate;
    expect(machine(maxed()).outlet).toEqual({ x: p.x + p.w / 2, y: -(p.y + p.h / 2), hx: p.w / 2, hy: p.h / 2 });
  });

  it('says which cables come in behind the tray from the supply', () => {
    for (const id of ['atx', 'cpu']) expect(run(id).fed, id).toBe(true);
    for (const id of ['pcmains', 'monmains', 'sysfan', 'fan:front0']) expect(run(id).fed, id).toBe(false);
  });

  it('follows the lead of a graphics card, which comes from the supply too', () => {
    const gm = machine(withGpu()),
      lead = gm.cableRuns().find((r) => r.id.startsWith('pcie'));
    expect(lead).toBeDefined();
    expect(lead!.fed).toBe(true);
    expect(lead!.strands.length).toBeGreaterThan(1);
  });
});

describe('Machine3D.cablesRev', () => {
  it('moves whenever a cable is built again, and the run follows the plug', () => {
    const m = machine(maxed()),
      at = m.cablesRev;
    expect(at).toBeGreaterThan(0);
    m.setCable('atx', false);
    expect(m.cablesRev).toBeGreaterThan(at);
    expect(m.cableRuns().find((r) => r.id === 'atx')!.seated).toBe(false);
    m.setCable('atx', true);
    expect(m.cableRuns().find((r) => r.id === 'atx')!.seated).toBe(true);
  });
});

describe('Machine3D.heldCables', () => {
  it('holds none at rest, and names a cable whose built piece a hand has hidden', () => {
    const m = machine(maxed());
    expect([...m.heldCables()]).toEqual([]);
    let cable: Object3D | undefined;
    m.root.traverse((o) => {
      if (o.userData['id'] === 'cable.atx') cable = o;
    });
    const rig = cable?.children.find((c) => c.userData['rig']);
    expect(rig).toBeDefined();
    rig!.visible = false;
    expect([...m.heldCables()]).toEqual(['atx']);
    expect(m.cableRuns().find((r) => r.id === 'atx')!.held).toBe(true);
  });
});

describe('Machine3D.partBox', () => {
  let snap: Snapshot, m: Machine3D;
  beforeAll(() => {
    const g = maxed();
    snap = g.snapshot();
    m = machine(g);
  });

  it('gives the box of a part in the machine space', () => {
    const cpu = snap.devices.find((d) => d.kind === 'cpu')!,
      b = m.partBox(cpu.id);
    expect(b).not.toBeNull();
    for (let a = 0; a < 3; a++) expect(b!.max[a]!).toBeGreaterThan(b!.min[a]!);
  });

  it('gives nothing for a part that is not there', () => {
    expect(m.partBox('dev-none')).toBeNull();
  });
});
