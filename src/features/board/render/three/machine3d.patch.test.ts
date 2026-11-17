// A machine patched from one snapshot to the next stands as a machine built from the next (Build my PC builds no new machine for a stick, an
// M.2 drive or a card: `Machine3D.patch`).
import { describe, expect, it } from 'vitest';
import type { Mesh, Object3D } from 'three';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { idOf } from '@/core/render/three/pick';
import { roomGeo } from '@/features/room/render/shell/room';
import { Machine3D } from './machine3d';
import { quietCanvas } from './testutil';

quietCanvas();

const stage = (s: Snapshot): Machine3D => new Machine3D(s, roomGeo(), new BakeQueue(), null, false);

/** What a viewer sees: the meshes drawn, by the part (or socket) they belong to, and the tagged things a drop or a click finds. */
function shape(m: Machine3D): { parts: Record<string, string>; tagged: string[] } {
  m.root.updateMatrixWorld(true);
  const parts = new Map<string, { draws: number; verts: number }>(), tagged = new Set<string>();
  m.root.traverseVisible((o: Object3D) => {
    if (typeof o.userData.id === 'string') tagged.add(o.userData.id);
    const mesh = o as Mesh;
    if (!mesh.isMesh || !(mesh.layers.mask & 1)) return;
    const k = idOf(o) ?? 'case', p = parts.get(k) ?? { draws: 0, verts: 0 };
    p.draws++; p.verts += mesh.geometry.attributes.position?.count ?? 0;
    parts.set(k, p);
  });
  // (the cables hang again and merge in their own order: their totals count)
  const out: Record<string, string> = {};
  for (const [k, p] of [...parts].sort(([a], [b]) => (a < b ? -1 : 1))) out[k.startsWith('cable') ? 'cables' : k] = `${p.draws}/${p.verts}`;
  return { parts: out, tagged: [...tagged].sort() };
}

const fresh = (g: Game) => shape(stage(g.snapshot()));

describe('a patched machine stands as a built one', () => {
  for (const kind of ['ram', 'storage', 'gpu', 'npu', 'nic']) {
    it(`takes a ${kind} out and puts it back`, () => {
      const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
      // (the maxed machine has no GPU or NPU: one goes in first)
      if (kind === 'gpu' || kind === 'npu') { const b = g.purchase(`${kind}1`); if (b.ok) g.install(b.invId, 'pcie0'); }
      const m = stage(g.snapshot());
      // (the first of the kind the game lets go: a drive with the OS on it stays)
      let d = null as ReturnType<Game['snapshot']>['devices'][number] | null, out = null as ReturnType<Game['uninstall']> | null;
      for (const x of g.snapshot().devices.filter((v) => v.kind === kind && (kind !== 'storage' || v.slot.startsWith('m2')))) {
        const r = g.uninstall(x.id);
        if (r.ok) { d = x; out = r; break; }
      }
      if (!d || !out || !out.ok) throw new Error(`the maxed machine lets no ${kind} go`);
      expect(m.patch(g.snapshot(), roomGeo()), 'a patch for the removal').toBe(true);
      const gone = shape(m), want = fresh(g);
      // (the cables fall apart in their hanging: counts of the parts and the sockets are the test)
      expect(gone.tagged.filter((t) => !t.startsWith('cable'))).toEqual(want.tagged.filter((t) => !t.startsWith('cable')));
      expect(Object.keys(gone.parts)).toEqual(Object.keys(want.parts));
      expect(gone.parts).toEqual(want.parts);
      const back = g.install(out.invId!, d.slot);
      expect(back.ok).toBe(true);
      expect(m.patch(g.snapshot(), roomGeo()), 'a patch for the fit').toBe(true);
      const there = shape(m), built = fresh(g);
      expect(there.tagged.filter((t) => !t.startsWith('cable'))).toEqual(built.tagged.filter((t) => !t.startsWith('cable')));
      expect(there.parts).toEqual(built.parts);
    }, 60_000);
  }

  it('asks for a build when the change is more than a stick', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
    const m = stage(g.snapshot());
    const cpu = g.snapshot().devices.find((x) => x.kind === 'cpu')!;
    const cooler = g.snapshot().devices.find((x) => x.kind === 'cooler');
    if (cooler) g.uninstall(cooler.id);
    g.uninstall(cpu.id);
    expect(m.patch(g.snapshot(), roomGeo())).toBe(false);
  }, 60_000);
});
