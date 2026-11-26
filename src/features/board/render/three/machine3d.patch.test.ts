// A machine patched from one snapshot to the next stands as a machine built from the next (Build my PC builds no new machine for a stick, an
// M.2 drive or a card: `Machine3D.patch`).
import { describe, expect, it } from 'vitest';
import type { Mesh, Object3D } from 'three';

import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { findById, idOf } from '@/core/render/three/pick';
import { roomGeo } from '@/features/room/render/shell/room';
import { Machine3D } from './machine3d';
import { quietCanvas } from './testutil';

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

const stage = (s: Snapshot): Machine3D =>
  new Machine3D(s, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false });

/** What a viewer sees: the meshes drawn, by the part (or socket) they belong to, and the tagged things a drop or a click finds. */
function shape(m: Machine3D): { parts: Record<string, string>; tagged: string[] } {
  m.root.updateMatrixWorld(true);
  const parts = new Map<string, { draws: number; verts: number }>(),
    tagged = new Set<string>();
  m.root.traverseVisible((o: Object3D) => {
    if (typeof o.userData['id'] === 'string') {
      tagged.add(o.userData['id']);
    }
    if (!isMesh(o)) {
      return;
    }
    const mesh = o;
    if (!(mesh.layers.mask & 1)) {
      return;
    }
    const k = or(idOf(o), 'case'),
      p = or(parts.get(k), { draws: 0, verts: 0 });
    p.draws++;
    p.verts += or(mesh.geometry.attributes['position']?.count, 0);
    parts.set(k, p);
  });
  // (the cables hang again and merge in their own order: their totals count)
  const out: Record<string, string> = {};
  for (const [k, p] of [...parts].toSorted(([a], [b]) => (a < b ? -1 : 1))) {
    out[k.startsWith('cable') ? 'cables' : k] = `${p.draws}/${p.verts}`;
  }
  return { parts: out, tagged: [...tagged].toSorted() };
}

const fresh = (g: Game) => shape(stage(g.snapshot()));

function assert_takes_the_CPU_an_air_cooler_with_its_fan_and_a_h(): void {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  const snap = () => g.snapshot();
  const ok = (r: { ok: boolean }, what: string) => {
    if (!r.ok) {
      throw new Error(`${what}: ${JSON.stringify(r)}`);
    }
  };
  // (the maxed machine has a liquid loop: its pump goes, an air tower with a fan takes its seat; the hoses are the build's, not a patch's)
  for (const d of snap().devices.filter((x) => x.kind === 'radiator' || x.kind === 'cooler')) {
    ok(g.uninstall(d.id), 'out');
  }
  const tower = g.purchase('cooler1');
  ok(tower, 'buy');
  ok(g.install((tower as { invId: string }).invId, 'cooler0'), 'tower');
  const fan = g.purchase('fan120');
  ok(fan, 'buy');
  ok(g.install((fan as { invId: string }).invId, 'cooler0.fan0'), 'fan');
  const m = stage(snap());
  const same = (what: string) => {
    const got = shape(m),
      want = fresh(g);
    expect(
      got.tagged.filter((t) => !t.startsWith('cable')),
      `${what}: sockets`,
    ).toStrictEqual(want.tagged.filter((t) => !t.startsWith('cable')));
    // (a bare CPU socket is the board's own mesh in a build and an unseen drop box in a patch: the tag is the same, as `sockets` says)
    // (and the bare socket's gold contacts are one more draw of their own, where a build merges them into the board's)
    const { cpu0: _a, ...a } = got.parts,
      { cpu0: _b, ...b } = want.parts;
    if (what === 'cpu out') {
      delete a['case'];
      delete b['case'];
    }
    expect(a).toStrictEqual(b);
  };
  const step = (what: string, act: () => { ok: boolean }) => {
    ok(act(), what);
    expect(m.patch(snap(), roomGeo()), `${what}: a patch`).toBe(true);
    same(what);
  };
  const find = (kind: string, slot?: string) =>
    must(snap().devices.find((x) => x.kind === kind && (!slot || x.slot === slot)));
  const gone: { id: string; spec: string; slot: string; inv: string }[] = [];
  const out = (kind: string, slot?: string) => {
    step(`${kind} out`, () => {
      const d = find(kind, slot),
        r = g.uninstall(d.id);
      if (r.ok) {
        gone.push({ id: d.id, spec: d.spec, slot: d.slot, inv: must(r.invId) });
      }
      return r;
    });
  };
  const back = () => {
    const u = must(gone.pop());
    step(`${u.spec} back`, () => g.install(u.inv, u.slot));
  };
  out('fan', 'cooler0.fan0');
  out('cooler');
  out('cpu');
  back();
  back();
  back();
  const sink = snap().devices.find((x) => x.kind === 'vrm-sink');
  if (sink) {
    out('fan', `${sink.slot}.fan0`);
    out('vrm-sink');
    back();
    back();
  }
}

function assert_leaves_no_id_on_a_host_it_built_again_a_lookup_f(): void {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  const m = stage(g.snapshot());
  const fan = must(g.snapshot().devices.find((x) => x.kind === 'fan' && x.slot === 'vrm-sink0.fan0')),
    host = must(g.snapshot().devices.find((x) => x.slot === 'vrm-sink0'));
  // (the fan off and on again: the sink is built twice, its old copies stay hidden in the tree)
  const r = g.uninstall(fan.id);
  if (!r.ok) {
    throw new Error(r.reason);
  }
  expect(m.patch(g.snapshot(), roomGeo())).toBe(true);
  expect(g.install(must(r.invId), fan.slot).ok).toBe(true);
  expect(m.patch(g.snapshot(), roomGeo())).toBe(true);
  const shown = (o: Object3D | null) => {
    for (let q = o; q; q = q.parent) {
      if (!q.visible) {
        return false;
      }
    }
    return Boolean(o);
  };
  for (const d of g.snapshot().devices.filter((x) => x.slot.startsWith('vrm-sink0'))) {
    let n = 0;
    m.root.traverse((o) => {
      if (o.userData['id'] === d.id) {
        n++;
      }
    });
    expect(n, `${d.kind} ${d.id}: one object`).toBe(1);
    expect(shown(findById(m.root, d.id)), `${d.kind} ${d.id}: shown`).toBe(true);
  }
  expect(host.id).toBe(must(g.snapshot().devices.find((x) => x.slot === 'vrm-sink0')).id);
}

function assert_asks_for_a_build_for_a_liquid_pump_its_hoses_joi(): void {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  const m = stage(g.snapshot());
  const rad = g.snapshot().devices.find((x) => x.kind === 'radiator'),
    pump = g.snapshot().devices.find((x) => x.kind === 'cooler');
  if (rad) {
    g.uninstall(rad.id);
  }
  if (pump) {
    g.uninstall(pump.id);
  }
  expect(m.patch(g.snapshot(), roomGeo())).toBe(false);
}

function assert_asks_for_a_build_when_the_change_is_more_than_a_(): void {
  const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
  const m = stage(g.snapshot());
  const cpu = must(g.snapshot().devices.find((x) => x.kind === 'cpu'));
  const cooler = g.snapshot().devices.find((x) => x.kind === 'cooler');
  if (cooler) {
    g.uninstall(cooler.id);
  }
  g.uninstall(cpu.id);
  expect(m.patch(g.snapshot(), roomGeo())).toBe(false);
}

describe('a patched machine stands as a built one', () => {
  for (const kind of ['ram', 'storage', 'gpu', 'npu', 'nic']) {
    const assert_takes_a_x_out_and_puts_it_back = (): void => {
      const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
      // (the maxed machine has no GPU or NPU: one goes in first)
      if (kind === 'gpu' || kind === 'npu') {
        const b = g.purchase(`${kind}1`);
        if (b.ok) {
          g.install(b.invId, 'pcie0');
        }
      }
      const m = stage(g.snapshot());
      // (the first of the kind the game lets go: a drive with the OS on it stays)
      let d = null as ReturnType<Game['snapshot']>['devices'][number] | null,
        out = null as ReturnType<Game['uninstall']> | null;
      for (const x of g
        .snapshot()
        .devices.filter((v) => v.kind === kind && (kind !== 'storage' || v.slot.startsWith('m2')))) {
        const r = g.uninstall(x.id);
        if (r.ok) {
          d = x;
          out = r;
          break;
        }
      }
      if (!d || !out || !out.ok) {
        throw new Error(`the maxed machine lets no ${kind} go`);
      }
      expect(m.patch(g.snapshot(), roomGeo()), 'a patch for the removal').toBe(true);
      const gone = shape(m),
        want = fresh(g);
      // (the cables fall apart in their hanging: counts of the parts and the sockets are the test)
      expect(gone.tagged.filter((t) => !t.startsWith('cable'))).toStrictEqual(
        want.tagged.filter((t) => !t.startsWith('cable')),
      );
      expect(Object.keys(gone.parts)).toStrictEqual(Object.keys(want.parts));
      expect(gone.parts).toStrictEqual(want.parts);
      const back = g.install(must(out.invId), d.slot);
      expect(back.ok).toBe(true);
      expect(m.patch(g.snapshot(), roomGeo()), 'a patch for the fit').toBe(true);
      const there = shape(m),
        built = fresh(g);
      expect(there.tagged.filter((t) => !t.startsWith('cable'))).toStrictEqual(
        built.tagged.filter((t) => !t.startsWith('cable')),
      );
      expect(there.parts).toStrictEqual(built.parts);
    };

    it(`takes a ${kind} out and puts it back`, () => {
      expect.hasAssertions();
      assert_takes_a_x_out_and_puts_it_back();
    }, 60_000);
  }

  it('takes the CPU, an air cooler with its fan and a heat sink out and puts them back', () => {
    expect.hasAssertions();
    assert_takes_the_CPU_an_air_cooler_with_its_fan_and_a_h();
  });

  it('leaves no id on a host it built again: a lookup finds the shown one', () => {
    expect.hasAssertions();
    assert_leaves_no_id_on_a_host_it_built_again_a_lookup_f();
  }, 60_000);

  it('asks for a build for a liquid pump (its hoses join it)', () => {
    expect.hasAssertions();
    assert_asks_for_a_build_for_a_liquid_pump_its_hoses_joi();
  }, 60_000);

  it('asks for a build when the change is more than a stick', () => {
    expect.hasAssertions();
    assert_asks_for_a_build_when_the_change_is_more_than_a_();
  }, 60_000);
});
