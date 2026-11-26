// The stage's studio lights and its frame's cuts (docs/render/case.md "Build my PC's frame").
import { AmbientLight, DirectionalLight, HemisphereLight, PointLight } from 'three';
import type { Scene, WebGLRenderer } from './types';
import { byProgram } from '@/core/render/three/drawsort';

/** The studio's lights on the stage's scene. The still parts' matrices stay (`syncWorld` in `frame`), and the opaque draws go in program order. */
export function lightStudio(scene: Scene, renderer: WebGLRenderer): void {
  scene.environmentIntensity = 0.45;
  scene.add(new AmbientLight(0xff_ff_ff, 0.12), new HemisphereLight(0xbf_d0_ff, 0x1a_14_10, 0.3));
  const key = new DirectionalLight(0xff_f0_dc, 0.9);
  key.position.set(-6000, 9000, 14_000);
  const rim = new DirectionalLight(0x8f_b0_ff, 0.45);
  rim.position.set(9000, 3000, -4000);
  const lamp = new PointLight(0xff_f1_dd, 1, 0, 0);
  lamp.position.set(0, 4000, 9000);
  scene.add(key, rim, lamp);
  // the frame's cuts (docs/render/case.md "Build my PC's frame"): the still parts' matrices stay (`syncWorld` in `frame`), and the opaque
  // draws go in program order
  scene.matrixWorldAutoUpdate = false;
  renderer.setOpaqueSort(byProgram);
}
