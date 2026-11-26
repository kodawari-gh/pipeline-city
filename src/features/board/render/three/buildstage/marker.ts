// The marker that shows where a part goes, and the floor under the case.
import { CircleGeometry, Color, Mesh, MeshBasicMaterial, MeshStandardMaterial, PlaneGeometry } from 'three';
import { SEG } from '@/core/render/three/geometry';
import { CASE as CASE_RECT } from '../../layout/layout';
import { slotRects } from '../slots3d';
import { seeThrough } from '@/core/render/three/pick';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { StageMonitor } from './monitor';

export abstract class StageMarker extends StageMonitor {
  protected floor: Mesh | null = null;
  protected marker: Mesh<PlaneGeometry, MeshBasicMaterial> | null = null;
  protected markerAt = '';
  /** The snap preview: a glowing box over the socket a dragged part would fit in (`dropTarget`); null hides it. A socket with no place of its own (a case fan) shows none. */
  showTarget(slot: string | null): void {
    this.demand.ask();
    const rect = slot !== null && slot !== '' && this.machine.doorOpen ? slotRects(this.snapshot).get(slot) : undefined;
    if (!rect) {
      if (this.marker) {
        this.marker.visible = false;
      }
      this.markerAt = '';
      return;
    }
    if (!this.marker) {
      this.marker = seeThrough(
        new Mesh(
          new PlaneGeometry(1, 1),
          new MeshBasicMaterial({
            color: 0x3b_e3_ff,
            transparent: true,
            opacity: 0.3,
            depthTest: false,
            depthWrite: false,
            toneMapped: false,
          }),
        ),
      );
      this.marker.renderOrder = 999;
      this.ctx.scene.add(this.marker);
    }
    const key = `${slot}`;
    if (key !== this.markerAt) {
      this.markerAt = key;
      this.marker.position.set(rect.x + rect.w / 2, -(rect.y + rect.h / 2), BOARD_Z + 250);
      this.marker.scale.set(rect.w, rect.h, 1);
    }
    this.marker.visible = true;
  }

  /** The plain floor under the case. */
  protected stage(_caseTier: number): void {
    const { scene } = this.ctx;
    if (!this.floor) {
      this.floor = new Mesh(
        new CircleGeometry(1, SEG.fineRing).rotateX(-Math.PI / 2),
        new MeshStandardMaterial({ color: new Color(0x1c_1c_1e), roughness: 0.55, metalness: 0.25 }),
      );
      this.floor.receiveShadow = true;
      scene.add(this.floor);
    }
    this.floor.scale.setScalar(CASE_RECT.w * 1.4);
    this.floor.position.set(CASE_RECT.x + CASE_RECT.w / 2, -(CASE_RECT.y + CASE_RECT.h) - 140, BOARD_Z + 1800);
  }
}
