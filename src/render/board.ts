import { Application, Graphics } from 'pixi.js';
import { snapshot } from '../game/store';
import { effect } from '@preact/signals';

// Placeholder board: a square that pulses with the cycle count.
export async function mountBoard(host: HTMLElement) {
  const app = new Application();
  await app.init({ resizeTo: window, background: '#0b0f14', antialias: true });
  host.appendChild(app.canvas);

  const chip = new Graphics().roundRect(-40, -40, 80, 80, 8).fill('#3fd0ff');
  app.stage.addChild(chip);
  app.renderer.on('resize', () => chip.position.set(app.screen.width / 2, app.screen.height / 2));
  chip.position.set(app.screen.width / 2, app.screen.height / 2);

  effect(() => { chip.alpha = 0.5 + 0.5 * Math.abs(Math.sin(snapshot.value.cycle / 20)); });
}
