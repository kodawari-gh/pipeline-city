// What the power lens follows of the machine (docs/render/power.md): `Machine3D.cableRuns` (each cable's strands as the sleeves are made from them, in the order the
// power goes), `cablesRev`, `heldCables` and `partBox`.
import { beforeAll, describe, expect, it } from 'vitest';
import * as three from 'three';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/protocol';
import { Machine3D } from './machine3d';
import { SWISS, swissEngage } from './plugs3d';
import type { CableRun } from './power/runs';
import { ROOM_SOCKET } from './swisssocket3d';
import { quietCanvas } from './testutil';

/** Returns `value`, or fails the test with a clear message when it is missing. */
function must<T>(value: T): NonNullable<T> {
  if (value === undefined || value === null) {
    throw new Error('expected a value, got nothing');
  }
  return value;
}

quietCanvas();

const maxed = (): Game => new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
/** The biggest machine with a graphics card in the first slot (a card that needs a lead of its own: the lead comes from the supply too). */
const withGpu = (): Game => {
  const g = maxed(),
    bought = g.purchase('gpu2');
  if (bought.ok) {
    g.install(bought.invId, 'pcie0');
  }
  return g;
};
const machine = (g: Game): Machine3D =>
  new Machine3D(g.snapshot(), roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false });
const dist = (a: readonly number[], b: readonly number[]): number =>
  Math.hypot(must(a[0]) - must(b[0]), must(a[1]) - must(b[1]), must(a[2]) - must(b[2]));
/** The cables that carry data, not power: the lens leaves them out. */
const DATA = new Set(['video', 'lan']);

function assert_plugs_each_mains_cord_into_its_recess_of_the_roo(): void {
  const g = roomGeo(),
    m = machine(maxed());
  for (const [id, o] of [
    ['pcmains', g.socket.pc],
    ['monmains', g.socket.mon],
  ] as const) {
    const rig = must(m.rig(id));
    expect(rig.seat.at).toStrictEqual([o.x, -o.y, ROOM_SOCKET.face]);
    expect(rig.seat.axis).toStrictEqual([0, 0, 1]);
    expect(rig.engage).toBe(swissEngage(ROOM_SOCKET.k));
    expect(rig.engage).toBeGreaterThan((SWISS.head.l + SWISS.pin.l) * ROOM_SOCKET.k);
    // (the plug is 39 mm across at the plate's scale, as the recess it goes into)
    const b = new three.Box3().setFromObject(rig.model().root),
      across = (b.max.x - b.min.x) / ROOM_SOCKET.k;
    expect(across).toBeGreaterThan(39);
    expect(across).toBeLessThan(41);
  }
}

function assert_holds_none_at_rest_and_names_a_cable_whose_built(): void {
  const m = machine(maxed());
  expect([...m.heldCables()]).toStrictEqual([]);
  let cable: three.Object3D | undefined;
  m.root.traverse((o) => {
    if (o.userData['id'] === 'cable.atx') {
      cable = o;
    }
  });
  const rig = cable?.children.find((c) => c.userData['rig']);
  expect(rig).toBeDefined();
  must(rig).visible = false;
  expect([...m.heldCables()]).toStrictEqual(['atx']);
  expect(must(m.cableRuns().find((r) => r.id === 'atx')).held).toBe(true);
}

describe('Machine3D.cableRuns', () => {
  // (built when the file's canvases are quiet: `quietCanvas` sets them in a `beforeAll`)
  let snap: Snapshot, runs: CableRun[];
  const run = (id: string) => must(runs.find((r) => r.id === id));
  beforeAll(() => {
    const g = maxed();
    snap = g.snapshot();
    runs = machine(g).cableRuns();
  });
  function assert_has_a_run_for_every_cable_that_carries_power(): void {
    for (const c of snap.cables) {
      if (!DATA.has(c.id)) {
        expect(run(c.id)).toBeDefined();
      }
    }
  }

  it('has a run for every cable that carries power', () => {
    expect.hasAssertions();
    assert_has_a_run_for_every_cable_that_carries_power();
  });

  function assert_keeps_real_points_two_or_more_in_a_strand_every_(): void {
    for (const r of runs) {
      expect(r.strands.length).toBeGreaterThan(0);
      for (const s of r.strands) {
        expect(s.length).toBeGreaterThan(1);
        for (const p of s) {
          for (const v of p) {
            expect(Number.isFinite(v)).toBe(true);
          }
        }
      }
      expect(r.r).toBeGreaterThan(0);
      expect(Math.hypot(...r.seat.axis)).toBeCloseTo(1, 3);
      expect(r.seated).toBe(true);
      expect(r.held).toBe(false);
    }
  }

  it('keeps real points: two or more in a strand, every one a number, a sleeve and a unit way out of the socket', () => {
    expect.hasAssertions();
    assert_keeps_real_points_two_or_more_in_a_strand_every_();
  });

  function assert_runs_a_lead_from_the_supply_to_its_plug_and_a_fa(): void {
    // (the 24-pin ends at its socket on the board's east edge; the strands come from behind the tray)
    for (const id of ['atx', 'cpu']) {
      for (const s of run(id).strands) {
        const plugAt = must(s.at(-1));
        expect(dist(plugAt, run(id).seat.at)).toBeLessThan(700);
      }
    }
    for (const id of ['cpufan', 'vrmfan', 'ramfan', 'sysfan', 'fan:front0', 'fan:rear']) {
      const strand0 = must(must(run(id).strands[0])[0]);
      expect(dist(strand0, run(id).seat.at)).toBeLessThan(150);
    }
  }

  it('runs a lead from the supply to its plug, and a fan cord from its header out to the fan', () => {
    expect.hasAssertions();
    assert_runs_a_lead_from_the_supply_to_its_plug_and_a_fa();
  });

  function assert_runs_a_mains_cord_from_the_wall_up_to_its_device(): void {
    for (const id of ['pcmains', 'monmains']) {
      const s = must(run(id).strands[0]);
      // (world y is up: the wall socket is under the desk, its device above it)
      expect(must(s[0])[1]).toBeLessThan(must(s.at(-1))[1]);
    }
  }

  it('runs a mains cord from the wall up to its device', () => {
    expect.hasAssertions();
    assert_runs_a_mains_cord_from_the_wall_up_to_its_device();
  });

  it("plugs each mains cord into its recess of the room's Swiss plate: the seat on the plate's face, a type 12 plug at the plate's scale, drawn out clear of its pins", () => {
    expect.hasAssertions();
    assert_plugs_each_mains_cord_into_its_recess_of_the_roo();
  });

  it("hands the lens the room's plate as the source: its outline, y up", () => {
    const p = roomGeo().socket.plate;
    expect(machine(maxed()).outlet).toStrictEqual({ x: p.x + p.w / 2, y: -(p.y + p.h / 2), hx: p.w / 2, hy: p.h / 2 });
  });

  function assert_says_which_cables_come_in_behind_the_tray_from_t(): void {
    for (const id of ['atx', 'cpu']) {
      expect(run(id).fed).toBe(true);
    }
    for (const id of ['pcmains', 'monmains', 'sysfan', 'fan:front0']) {
      expect(run(id).fed).toBe(false);
    }
  }

  it('says which cables come in behind the tray from the supply', () => {
    expect.hasAssertions();
    assert_says_which_cables_come_in_behind_the_tray_from_t();
  });

  it('follows the lead of a graphics card, which comes from the supply too', () => {
    const gm = machine(withGpu()),
      lead = gm.cableRuns().find((r) => r.id.startsWith('pcie'));
    expect(lead).toBeDefined();
    expect(must(lead).fed).toBe(true);
    expect(must(lead).strands.length).toBeGreaterThan(1);
  });
});

describe('Machine3D.cablesRev', () => {
  it('moves whenever a cable is built again, and the run follows the plug', () => {
    const m = machine(maxed()),
      at = m.cablesRev;
    expect(at).toBeGreaterThan(0);
    m.setCable('atx', false);
    expect(m.cablesRev).toBeGreaterThan(at);
    expect(must(m.cableRuns().find((r) => r.id === 'atx')).seated).toBe(false);
    m.setCable('atx', true);
    expect(must(m.cableRuns().find((r) => r.id === 'atx')).seated).toBe(true);
  });
});

describe('Machine3D.heldCables', () => {
  it('holds none at rest, and names a cable whose built piece a hand has hidden', () => {
    expect.hasAssertions();
    assert_holds_none_at_rest_and_names_a_cable_whose_built();
  });
});

describe('Machine3D.partBox', () => {
  let snap: Snapshot, m: Machine3D;
  beforeAll(() => {
    const g = maxed();
    snap = g.snapshot();
    m = machine(g);
  });

  function assert_gives_the_box_of_a_part_in_the_machine_space(): void {
    const cpu = must(snap.devices.find((d) => d.kind === 'cpu')),
      b = m.partBox(cpu.id);
    expect(b).not.toBeNull();
    for (let a = 0; a < 3; a++) {
      expect(must(must(b).max[a])).toBeGreaterThan(must(must(b).min[a]));
    }
  }

  it('gives the box of a part in the machine space', () => {
    expect.hasAssertions();
    assert_gives_the_box_of_a_part_in_the_machine_space();
  });

  it('gives nothing for a part that is not there', () => {
    expect(m.partBox('dev-none')).toBeNull();
  });
});
