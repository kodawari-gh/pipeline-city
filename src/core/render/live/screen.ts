import { Graphics, Text } from 'pixi.js';
import { label, MONO } from '../ink';
import { brandSprite } from '../brands/pixi';
import type { Theme } from '../theme';
import { SCREEN_D, monitorView, standbyLook } from './features';
import { OS_FONT, OS_LINE, OS_ROWS } from './consts';
import type { LiveState } from './state';

/** The blank screen's art, at the screen's design size: a faint light in the glass, the city's mark (`brands/pipeline.ts`), its name and, while off, `STANDBY`. */
export function buildStandby(s: LiveState, T: Theme): void {
  for (const c of s.standby.removeChildren()) {
    c.destroy({ children: true });
  }
  const g = new Graphics(),
    W = SCREEN_D.w,
    H = SCREEN_D.h,
    cx = W / 2,
    cy = H / 2;
  for (let k = 0; k < 7; k++) {
    g.setFillStyle({ color: '#1a2a4a', alpha: 0.05 })
      .ellipse(cx, cy, W * 0.5 * (1 - k / 8), H * 0.5 * (1 - k / 8))
      .fill();
  }
  const mh = 200,
    mark = brandSprite('pipeline', cx, cy - 40 - mh / 2, mh, T.mute, { word: false, alpha: 0.55 });
  s.standbyCap = label('STANDBY', cx, cy + 330, 64, T.mute, { head: true, anchor: [0.5, 0.5], a: 0.65 });
  const word = brandSprite('pipeline', cx, cy + 100, 92, T.mute, { mark: false, cap: 1, alpha: 0.45 });
  s.standby.addChild(g, mark, word, s.standbyCap);
  s.standby.visible = false;
}

/** The blank screen: dim glass with the mark instead of a black slab (still: it is a screen that is off, not an animation). */
export function frameStandby(s: LiveState): void {
  const k = s.blank ? standbyLook(s.blank, monitorView(s.blank), s.osOn) : null;
  s.standby.visible = k !== null && !s.frameOn;
  if (k === null) {
    return;
  }
  if (s.standbyCap) {
    s.standbyCap.visible = k === 'off';
  }
}

/** The pooled rows of the OS screen (created on first use). */
export function osRowsFor(s: LiveState): Text[] {
  if (s.osRows.length === 0) {
    for (let i = 0; i < OS_ROWS; i++) {
      const t = new Text({
        text: '',
        style: { fontFamily: MONO, fontSize: OS_FONT, fontWeight: '600', fill: '#ffffff' },
        resolution: 2,
      });
      t.position.set(90, 56 + i * OS_LINE);
      t.visible = false;
      s.osRows.push(t);
    }
  }
  return s.osRows;
}
