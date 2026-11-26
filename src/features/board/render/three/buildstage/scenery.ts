// The room behind the machine: the studio wall, the tabs that frame the view.
import { ArtSet } from '../artset3d';
import { fitRect } from '@/core/render/three/camera';
import { frameMachine } from '@/core/render/three/buildframe';

import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { CASE as CASE_RECT } from '../../layout/layout';
import { StudioWall } from '../studiowall3d';
import { WALL_SHIFT, WALL_FOCUS_Z, wallPlanNow, wallNet } from './tuning';
import type { Box, OrbitView } from './types';
import { StageRun } from './run';

export abstract class StageScenery extends StageRun {
  /** What the UI drags now (a catalogue item off the shelf, a fitted device out of the machine), and the part it points at without a drag (a row it hovers). */
  protected carried: { item: string } | { device: string } | null = null;
  /** Tab boxes the UI measured and this stage has not framed yet: a drag in progress holds them (`applyTabs`). */
  protected wantTabs: Box[] | null = null;

  protected wall: StudioWall | null = null;
  // ------------------------------------------------------------------ drawing
  /** The case alone: the machine. The wall's plates and router stand behind it and may leave the frame (the Wall preset shows them). */
  protected override frameView(): OrbitView {
    // the machine fills the free window the tabs leave, and its middle sits at the window's middle (`frameMachine`, `core/render/three/buildframe.ts`)
    const c = CASE_RECT;
    return frameMachine({ x: 0, y: 0, w: this.W, h: this.H }, this.tabs, {
      centre: { x: c.x + c.w / 2, y: -(c.y + c.h / 2), z: BOARD_Z },
      size: { x: c.w, y: c.h, z: 0 },
    });
  }

  /** The tab boxes the UI measured (CSS px in the stage): the machine is framed in the free window they leave. A drag in progress holds the framing until it ends. */
  setTabs(tabs: Box[]): void {
    this.wantTabs = tabs;
    this.applyTabs();
  }

  /** Frame the machine in the window the UI last measured, once no drag is in progress; the view eases there (`goal`). */
  protected applyTabs(): void {
    const t = this.wantTabs;
    if (!t || this.carried || this.holding) {
      return;
    }
    this.wantTabs = null;
    if (JSON.stringify(t) === JSON.stringify(this.tabs)) {
      return;
    }
    this.tabs = t;
    this.goal = this.frameView();
    this.demand.ask();
  }

  /** The wall's plates, the router and the cords between (the Wall preset): seen nearly head on, a little from the east, the target a little west for the free window. */
  protected wallView(): OrbitView {
    const f = (this.wall?.plan ?? wallPlanNow()).frame,
      h = f.y1 - f.y0,
      w = f.x1 - f.x0;
    return fitRect(
      { x: f.x0 - WALL_SHIFT / 3, y: -f.y1, w, h },
      WALL_FOCUS_Z,
      this.W / this.H,
      { yaw: 0.2, pitch: 0.1, fov: 30 },
      0.54,
    );
  }

  /** The studio's wall as the case and the game's network have it: built, moved when the case's size moves it, its router, lights and lead set. */
  protected syncWall(): void {
    const { scene } = this.ctx,
      plan = wallPlanNow(),
      net = wallNet(this.snapshot);
    if (this.wall && this.wall.plan.key !== plan.key) {
      scene.remove(this.wall.root);
      this.wall.dispose();
      this.wall = null;
    }
    if (this.wall) {
      this.wall.set(net);
    } else {
      this.wall = new StudioWall(plan, net, new ArtSet(this.bakes));
      scene.add(this.wall.root);
    }
    this.demand.ask();
  }
}
