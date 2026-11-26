// The monitor on the desk and its screen.
import { Group } from 'three';
import { disposeTree } from '@/core/render/three/geometry';
import { tag } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import type { Snapshot } from '@/worker/protocol';
import { Monitor } from '@/features/room/render/three/props3d';
import { CASE as CASE_RECT, DESK_Y, MONITOR, SCREEN } from '../../layout/layout';
import { worldPace } from '@/core/render/lod/lod';
import { MONITOR_AT } from './tuning';
import { StageScenery } from './scenery';

export abstract class StageMonitor extends StageScenery {
  /** The room's monitor as the stage drives it (`screen`). */
  protected mon: Monitor | null = null;
  /**
   * The room's own monitor (`Monitor`, props3d.ts) on the stage when the machine has one, tagged for the animation. It works as the room's does (`screen`): on
   * standby while the PC is off, the game's own screen (boot text, the OS) while it runs, dark with its cord out.
   */
  protected syncMonitor(on: boolean): void {
    const { scene } = this.ctx;
    if (this.monitor) {
      scene.remove(this.monitor);
      disposeTree(this.monitor, true);
      this.monitor = null;
      this.mon = null;
    }
    if (!on) {
      return;
    }
    // (built where the room puts it, then moved so its foot's middle stands on the stage's origin, beside the case and turned to the camera)
    const g = tag(new Group(), 'monitor'),
      m = new Monitor(MONITOR, SCREEN, DESK_Y, 0);
    m.set({ installed: true, powered: this.snapshot.monitorPowered, live: false, text: '' }, 12);
    m.root.position.set(-(MONITOR.x + MONITOR.w / 2), DESK_Y, MONITOR_AT.rootZ);
    g.add(m.root);
    g.position.set(CASE_RECT.x + MONITOR_AT.dx, -(CASE_RECT.y + CASE_RECT.h), BOARD_Z + MONITOR_AT.dz);
    g.rotation.y = MONITOR_AT.yaw;
    scene.add(g);
    this.monitor = g;
    this.mon = m;
  }

  /**
   * One frame of the screen, as the game's does (`board3d.ts`): the board's live layer runs at the world's pace for the machine's speed while it is on (its packets,
   * lights and replay: `BoardLive3D`) and draws the monitor's picture; the monitor shows it when the cord is in and the PC drives it, and its standby card otherwise.
   */
  protected screen(s: Snapshot, dt: number): void {
    const on = s.powered,
      pace = on ? this.simSpeed.peek() : 1;
    this.live.frame(this.ctx.camera, this.H, s, dt * worldPace(pace), !on, this.ctx.renderer.getPixelRatio(), on);
    const m = this.mon;
    if (!m) {
      return;
    }
    m.set(
      {
        installed: true,
        powered: s.monitorPowered,
        live: s.monitorLive && s.monitorPowered && on && s.display !== '',
        text: s.display ?? '',
      },
      12,
    );
    m.useLive(this.live.screen);
  }
}
