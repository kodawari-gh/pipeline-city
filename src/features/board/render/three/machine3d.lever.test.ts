// The CPU socket's load lever follows its socket: down with a CPU in it, lifted when it is bare (a memory socket's latches close on a stick and open without
// one). A patch and a build must agree, or the lever jumps at the next build. Build my PC's removal leaves it lifted (`buildmode3d.ts`, `latchOpen`).
import { describe, expect, it } from 'vitest';
import { Game } from '@/worker/game/game';
import type { Snapshot } from '@/worker/game/types';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { LEVER_OPEN } from './boardhw3d';
import { Machine3D } from './machine3d';
import { quietCanvas } from './testutil';

quietCanvas();

const stage = (s: Snapshot): Machine3D =>
  new Machine3D(s, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false });
const lever = (m: Machine3D): number[] => {
  const r: number[] = [];
  m.root.traverse((o) => {
    if (o.userData['leverOf'] === 'cpu0') r.push(o.rotation.y);
  });
  return r;
};

describe('the CPU socket lever', () => {
  it('is down with a CPU in the socket and lifted without one, in a build and in a patch', () => {
    const g = new Game({ seed: 1, sandbox: true, preassembled: true, maxed: true });
    // (the maxed machine has a liquid loop on the CPU: it goes first, so that a patch is for the CPU alone)
    for (const d of g.snapshot().devices.filter((x) => x.kind === 'radiator' || x.kind === 'cooler')) g.uninstall(d.id);
    const m = stage(g.snapshot());
    expect(lever(m), 'a CPU in').toEqual([0]);
    const cpu = g.snapshot().devices.find((x) => x.kind === 'cpu')!,
      out = g.uninstall(cpu.id);
    if (!out.ok) throw new Error(out.reason);
    expect(m.patch(g.snapshot(), roomGeo()), 'a patch for the removal').toBe(true);
    expect(lever(m), 'patched bare').toEqual([LEVER_OPEN]);
    expect(lever(stage(g.snapshot())), 'built bare').toEqual([LEVER_OPEN]);
    expect(g.install(out.invId!, cpu.slot).ok).toBe(true);
    expect(m.patch(g.snapshot(), roomGeo()), 'a patch for the fit').toBe(true);
    expect(lever(m), 'patched in').toEqual([0]);
    expect(lever(stage(g.snapshot())), 'built in').toEqual([0]);
  }, 60_000);
});
