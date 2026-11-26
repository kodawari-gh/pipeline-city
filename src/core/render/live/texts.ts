import { Graphics, Text } from 'pixi.js';
import { HEAD, MONO } from '../ink';
import { blades, PSU_PANEL, SCREEN_D } from './features';
import type { Container, PsuTexts } from './types';

/** The pooled texts of the live layer, made once by `LiveState`'s constructor. */

/** The warning over the CPU (`BOARD DEAD`, `THROTTLED 80%`...). */
export function makeBadge(): Text {
  const t = new Text({
    text: '',
    style: { fontFamily: MONO, fontSize: 70, fontWeight: '700', fill: '#ffffff' },
    resolution: 2,
  });
  t.anchor.set(0.5, 0.5);
  return t;
}

/** The monitor's text console (the CLI screen). */
export function makeScreenText(): Text {
  const t = new Text({
    text: '',
    style: { fontFamily: MONO, fontSize: 150, lineHeight: 190, fill: '#ffffff', fontWeight: '500' },
    resolution: 2,
  });
  t.position.set(90, 70);
  return t;
}

/** `NO SIGNAL`, centred on the screen. */
export function makeNoSignal(): Text {
  const t = new Text({
    text: 'NO SIGNAL',
    style: { fontFamily: HEAD, fontSize: 220, fontWeight: '700', fill: '#5d6a8f' },
    resolution: 2,
  });
  t.anchor.set(0.5, 0.5);
  t.position.set(SCREEN_D.w / 2, SCREEN_D.h / 2);
  return t;
}

const mkText = (size: number, head = false, right = false): Text => {
  const t = new Text({
    text: '',
    style: { fontFamily: head ? HEAD : MONO, fontSize: size, fontWeight: '700', fill: '#ffffff' },
    resolution: 2,
  });
  t.anchor.set(right ? 1 : 0, 0.5);
  return t;
};

/** The PSU panel's readout: load, budget, percentage, temperature, thermal state and fan speed. */
export function makePsuTexts(): PsuTexts {
  return {
    load: mkText(250, true),
    of: mkText(80),
    pct: mkText(80, true, true),
    temp: mkText(170, true),
    state: mkText(64, true),
    rpm: mkText(76, true),
  };
}

/** The PSU panel's little fan icon. */
export function fillPanelFan(panelFan: Container): void {
  const pf = new Graphics();
  blades(pf, 5, 22, 120, '#ffffff', '#ffffff', 4);
  panelFan.addChild(pf);
}

/** Put the PSU readout texts on the panel of the current tier (the panel moves with the board's height). */
export function placePsuTexts(tx: PsuTexts, panelFan: Container): void {
  const p = PSU_PANEL;
  tx.load.position.set(p.x + 50, p.y + 290);
  tx.of.position.set(p.x + 50, p.y + 475);
  tx.pct.position.set(p.x + 1100, p.y + 475);
  tx.temp.position.set(p.x + 1190, p.y + 290);
  tx.state.position.set(p.x + 1190, p.y + 475);
  tx.rpm.position.set(p.x + 1660, p.y + 475);
  panelFan.position.set(p.x + 1890, p.y + 285);
}
