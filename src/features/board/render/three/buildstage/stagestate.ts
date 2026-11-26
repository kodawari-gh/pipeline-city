// The stage's state (`BuildStage`, docs/PC_PARTS.md): the signals the page reads and what the later layers of the stage keep. The bottom of the class
// chain.
import { computed, signal } from '@preact/signals';
import { BakeQueue } from '@/core/render/three/artlod';
import type { Box } from '@/core/render/three/camera';
import { DrawGate } from '@/core/render/three/ondemand';
import type { Game } from '@/worker/game/game';
import { LAYOUT_CASE, LAYOUT_TIER } from '../../layout/layout';
import type { Machine3D } from '../machine3d';
import type { Shown } from '@/features/board/sim/buildspecs';
import type { benchable, benchIssues, BuildStatus, runBenchTasks, Step, Undo } from './types';
import { noop } from './tuning';

export abstract class StageState {
  /** The sandbox game (`StageGame`). */
  abstract get game(): Game;
  /** Abstract here, defined by a later layer of the stage. */
  protected abstract holdReeled(): void;
  abstract get insideOpen(): boolean;
  protected abstract putBackAssembly(u: Undo & { t: 'dev' }): Promise<void>;
  protected abstract record(s: Step): void;
  abstract fit(item: string, drop?: string): Promise<void>;

  readonly status = signal<BuildStatus>({ busy: false, step: '', log: [], rev: 0 });
  /**
   * What stands on the stage (`Shown`). The "Empty" start is `nothing`: no case at all, until the player brings one in from the shelf; that case is `case`, bare,
   * with no motherboard in it, and nothing else can be fitted until a board comes (`fit`); a board lowered into it makes it the `machine`. The sim game always
   * has a case and a board with no part on it; the stage holds them aside while they are not shown.
   */
  readonly shown = signal<Shown>('machine');
  /** Is there no board in the case (a bare case, or no case yet)? The parts have no socket then. */
  readonly bare = computed(() => this.shown.value !== 'machine');
  /** The benchmark's code carries the game's whole sim: it loads when the benchmark screen opens (`loadBench`), not with the stage. */
  /** The bench module (`pcbench`), loaded when the scores are first asked for (`loadBench`). */
  protected benchMod: {
    benchable: typeof benchable;
    benchIssues: typeof benchIssues;
    runBenchTasks: typeof runBenchTasks;
  } | null = null;
  protected readonly benchLoaded = signal(false);
  /** Why each benchmark task cannot run on the machine as it stands (null: it can), by task id; null until `loadBench` has loaded the code. */
  readonly benchIssues = computed((): ReadonlyMap<string, string | null> | null => {
    void this.status.value.rev; // (every change of the machine ends in a new `rev`)
    return this.benchLoaded.value && this.benchMod && !this.dead ? this.benchMod.benchIssues(this.game) : null;
  });
  protected _game: Game | null = null;
  protected _machine: Machine3D | null = null;
  protected readonly bakes = new BakeQueue();
  /** Drawn on demand (docs/render/load.md): a still machine draws no frame; a change, a motion or a camera move draws. */
  protected readonly demand = new DrawGate();
  protected dead = false;
  protected onPicture: () => void = noop;
  /** Resolves with the first picture, or at the stage's disposal: `open` waits for it, and the skeleton stays up. */
  protected readonly picture = new Promise<void>((resolve) => {
    this.onPicture = resolve;
  });
  protected readonly was: [number, number] = [LAYOUT_TIER, LAYOUT_CASE];
  protected readonly cleanup: (() => void)[] = [];
  /** The free window the UI leaves round the machine (CSS px from each edge). The machine is framed in it. */
  /** The tab boxes the UI measured (CSS px in the stage): the machine is framed in the free window they leave. */
  protected tabs: Box[] = [];
}
