// What the 3D world follows (board3d.ts): the snapshot (the world is built again from it), the page's size, and a lost GL context come back.
import { effect } from '@preact/signals';
import { snapshot } from '@/app/store';
import { rebuild } from './rebuild';
import type { Core } from './world';

/** Snapshot, size and context: each asks for a new picture. */
export function followPage(c: Core): void {
  const { stage } = c;
  effect(() => {
    void snapshot.value;
    rebuild(c);
  });
  new ResizeObserver(() => {
    stage.W = stage.host.clientWidth;
    stage.H = Math.max(1, stage.host.clientHeight);
    stage.renderer.setSize(stage.W, stage.H);
    stage.post.setSize(stage.W, stage.H);
    stage.demand.ask(); // (a new size clears the canvas)
  }).observe(stage.host);
  stage.canvas.addEventListener('webglcontextrestored', () => {
    stage.demand.ask();
  });
}
