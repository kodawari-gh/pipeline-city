// Cables and the machine's solid bodies (the board, the memory bank, the drive cage, a cooler, a card, a sink): a power lead or a cord that runs through a part
// is a render defect (found by eye in close-ups, then held here). `Machine3D.cableRuns` has each cable's strands as the sleeves are made from them, `airBodies`
// the boxes the air meets: the boxes the cables go round. The cables that end inside a body by design (a fan's cord at its heatsink, the drives' leads in their
// cage, the hub's cords at the hub under the shroud) are left out; a lead of the supply, the video and the mains cords may not sink into any.
import { beforeAll, describe, expect, it } from 'vitest';
import { BakeQueue } from '@/core/render/three/artlod';
import { roomGeo } from '@/features/room/render/shell/room';
import { BUILD_PRESETS } from '@/features/board/sim/buildspecs';
import { fullGame, presetGame } from '@/features/board/sim/buildpreset';
import type { Game } from '@/worker/game/game';
import { setLayoutTier } from '../layout/layout';
import { Machine3D } from './machine3d';
import { quietCanvas } from './testutil';

quietCanvas();

/** The cables that run from the tray's holes or the room to a socket on the board's face, over nothing: no part stands between. */
const OVER_OPEN = new Set(['atx', 'cpu', 'pcie', 'pcie2', 'pcie3', 'pcie4', 'video', 'lan', 'pcmains', 'monmains']);
/** How far (units) a strand's centre may sink into a body past its own radius: the rope settles a little into what it rests on. */
const SLACK = 8;

/** How deep (units) the polyline `pts`, thick `r`, goes into a box: the worst point of it, sampled every 25 units. */
function depthIn(
  pts: readonly (readonly number[])[],
  r: number,
  min: readonly number[],
  max: readonly number[],
): number {
  let worst = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!,
      b = pts[i]!,
      len = Math.hypot(b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!),
      k = Math.max(1, Math.ceil(len / 25));
    for (let j = 0; j <= k; j++) {
      const f = j / k;
      worst = Math.max(
        worst,
        Math.min(
          ...[0, 1, 2].map((q) =>
            Math.min(a[q]! + (b[q]! - a[q]!) * f - min[q]!, max[q]! - (a[q]! + (b[q]! - a[q]!) * f)),
          ),
        ) - r,
      );
    }
  }
  return worst;
}

describe("the cables and the machine's bodies", () => {
  const games: [string, Game][] = [];
  beforeAll(async () => {
    for (const p of BUILD_PRESETS) games.push([p.name, await presetGame(p)]);
    games.push(['full', await fullGame()]);
  }, 120_000);

  it("leaves the supply's leads, the video cable and the mains cords clear of every part, in each ready-made machine", () => {
    for (const [name, g] of games) {
      const s = g.snapshot();
      setLayoutTier(s.boardTier, Math.max(s.boardTier, s.caseTier));
      const m = new Machine3D(s, roomGeo(), { q: new BakeQueue(), chips: null, inRoom: false }),
        bodies = m.airBodies();
      try {
        const runs = m.cableRuns().filter((r) => OVER_OPEN.has(r.id));
        expect(runs.length, `${name}: its supply's leads`).toBeGreaterThan(1);
        for (const r of runs)
          for (const b of bodies) {
            const worst = Math.max(...r.strands.map((st) => depthIn(st, r.r, b.min, b.max)));
            expect(worst, `${name}: ${r.id} in ${b.id} (${b.kind})`).toBeLessThanOrEqual(SLACK);
          }
      } finally {
        m.dispose();
      }
    }
  }, 120_000);
});
