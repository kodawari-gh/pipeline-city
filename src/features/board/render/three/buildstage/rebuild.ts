// Building the machine's model from the game's snapshot, a slice at a time, and patching it after an edit.
import { roomGeo } from '@/features/room/render/shell/room';
import { setLayoutTier } from '../../layout/layout';
import { Machine3D, machineKey } from '../machine3d';
import type { Held } from './types';
import { stageWall } from './tuning';
import { StageBench } from './bench';

export abstract class StageRebuild extends StageBench {
  /** The loop's hoses are off their fittings (a step took them off, or a part just made the loop): a build keeps them hidden until they go on. */
  protected hosesOff = false;
  protected tierKey = '';
  /** What the machine builds cost since the stage opened (a swap's cost, read by the bench through `window.__build` in dev; `docs/render/load.md`). */
  readonly cost = { builds: 0, buildMs: 0, skipped: 0, patches: 0, patchMs: 0 };
  /** What the machine on the stage was built from (`machineKey`): a redraw of the same parts builds nothing (cables and the key sync themselves). */
  protected builtKey = '';

  /** Parts a removal took out and keeps built, by `spec@slot`: hidden at the far end of their way, with the place, the turns and the id they had. */
  protected readonly held = new Map<string, Held>();
  /**
   * The case's front-panel leads that are out of their headers (the board is out, or going in: `fitShell`). The machine shares the set (`syncPanel`).
   * They are the case's, not the game's cables: the sim has no such cable and a machine the game builds has every lead in.
   */
  protected readonly panelOut = new Set<string>();
  protected rebuild(): void {
    if (this.dead) {
      return;
    }
    this.snaps.drop();
    const shown = this.shown.peek(),
      key = machineKey(this.snapshot, shown);
    this.syncWall(); // (the router and the plan are the game's: a change of either leaves the machine as it was)
    if (this._machine && key === this.builtKey) {
      // the same tiers, parts and sockets: the machine stands as it is (the end of a job after a step that built it already, a cable the hand moved)
      this.cost.skipped++;
      // (a cable plugged in or out by the game's answer, not by the hand: it hangs as the game says)
      this._machine.syncCables(this.snapshot, roomGeo());
      this._machine.syncPanel(this.panelOut);
      this.holdReeled();
      const st = this.status.peek();
      this.status.value = { ...st, rev: st.rev + 1 };
      this.demand.ask();
      return;
    }
    const t0 = performance.now();
    // a part more or less that a patch can make (a stick, an M.2 drive, a card): the machine stays, only that part is built or hidden
    // (a case that gains or loses its board, or a stage that gains or loses its case, is built again: a patch keeps the board it has)
    if (this._machine && this._machine.shown === shown && this._machine.patch(this.snapshot, roomGeo())) {
      this.builtKey = key;
      this.held.clear();
      this.warm = true;
      this._machine.syncPanel(this.panelOut);
      this.holdReeled();
      this.cost.patches++;
      this.cost.patchMs += performance.now() - t0;
      this.bump();
      this.demand.ask();
      return;
    }
    try {
      this.rebuildNow();
      this.builtKey = key;
    } finally {
      this.cost.builds++;
      this.cost.buildMs += performance.now() - t0;
    }
  }

  /** The machine built again whatever its key says: a swap lifted the old one away, so a skipped build (the same tiers) or a patch would leave the stage empty. */
  protected rebuildAll(): void {
    if (this.dead) {
      return;
    }
    const t0 = performance.now();
    try {
      this.rebuildNow();
      this.builtKey = machineKey(this.snapshot, this.shown.peek());
    } finally {
      this.cost.builds++;
      this.cost.buildMs += performance.now() - t0;
    }
  }

  /** The stage's first machine, built a slice at a time (`Machine3D.make`; a machine built in one task held the page for 0.9 s): `rebuild` for a stage with none. */
  protected async buildFirst(): Promise<void> {
    const t0 = performance.now();
    this.snaps.drop();
    const s = this.snapshot,
      shown = this.shown.peek(),
      key = machineKey(s, shown),
      tier = s.boardTier;
    setLayoutTier(tier, Math.max(tier, s.caseTier));
    const made = await Machine3D.make(s, roomGeo(), {
      q: this.bakes,
      chips: null,
      inRoom: false,
      stop: () => this.dead,
      shown,
      wall: stageWall(s),
    });
    if (this.dead) {
      made?.dispose();
      return;
    }
    try {
      this.rebuildNow(made ?? undefined);
      this.builtKey = key;
    } finally {
      this.cost.builds++;
      this.cost.buildMs += performance.now() - t0;
    }
  }

  /** The machine for the snapshot, now. `made`: one built already (`buildFirst`), in place of building it here. */
  protected rebuildNow(made?: Machine3D): void {
    this.held.clear();
    // (the redraw always reads the game as it is now)
    this.snaps.drop();
    const s = this.snapshot,
      tier = s.boardTier,
      caseTier = Math.max(tier, s.caseTier);
    const refit = !this._machine || `${tier}|${caseTier}` !== this.tierKey;
    this.tierKey = `${tier}|${caseTier}`;
    setLayoutTier(tier, caseTier);
    const { scene } = this.ctx;
    const old = this._machine;
    if (old) {
      scene.remove(old.root);
      old.dispose();
    }
    this._machine =
      made ??
      new Machine3D(s, roomGeo(), {
        q: this.bakes,
        chips: null,
        inRoom: false,
        shown: this.shown.peek(),
        wall: stageWall(s),
      });
    if (old) {
      this._machine.takeDoor(old);
    }
    if (this._machine.hoses) {
      this._machine.hoses.root.visible = !this.hosesOff;
    }
    scene.add(this._machine.root);
    this._machine.syncPanel(this.panelOut);
    this.holdReeled();
    this.warm = true;
    this.stage(caseTier);
    this.syncWall();
    this.syncMonitor(s.devices.some((d) => d.kind === 'display'));
    if (refit) {
      this.goal = this.frameView();
      this.view = this.goal;
    }
    const st = this.status.peek();
    this.status.value = { ...st, rev: st.rev + 1 };
    this.demand.ask();
  }
}
