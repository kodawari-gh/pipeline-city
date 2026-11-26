import type { Text } from 'pixi.js';
import { box } from '../ink';
import type { Theme } from '../theme';
import { PSU_PANEL } from './features';
import { LCD_INK, LCD_MUTE, clamp } from './consts';
import type { LiveState } from './state';
import type { FanLive } from './types';

/** Green, amber over `warm`, red over `hot` (or when `bad`). */
const band = (T: Theme, bad: boolean, warm: boolean): string => {
  if (bad) {
    return T.bad;
  }
  return warm ? T.ld : T.st;
};

const setText = (t: Text, v: string, fill: string): void => {
  if (t.text !== v) {
    t.text = v;
  }
  if (t.style.fill !== fill) {
    t.style.fill = fill;
  }
};

/** What the percentage text says: tripped, off, or the load in percent. */
const pctText = (trip: boolean, off: boolean, ratio: number): string => {
  if (trip) {
    return 'TRIPPED';
  }
  return off ? 'OFF' : `${Math.round(ratio * 100)}%`;
};

/** The PSU's thermal state word. */
const stateText = (off: boolean, hot: boolean, warm: boolean): string => {
  if (off) {
    return 'COLD';
  }
  if (hot) {
    return 'HOT';
  }
  return warm ? 'WARM' : 'COOL';
};

/** The draw versus budget gauge: 20 segments, and a mark at 100 %. */
function drawGauge(s: LiveState, at: { bx: number; by: number }): void {
  const { T } = s,
    g = s.gauge,
    { bx, by } = at,
    ratio = s.psuRatio,
    bw = 1050,
    bh = 90,
    n = 20,
    seg = bw / n;
  box(g, bx - 8, by - 8, bw + 16, bh + 16, 12, { fill: '#000000', fa: 0.5, stroke: T.line, lw: 4 });
  const lit = Math.round((clamp(ratio, 0, 1.2) / 1.2) * n);
  for (let i = 0; i < n; i++) {
    const on = i < lit && !s.psuOff,
      f = (i / n) * 1.2;
    const c = band(T, f > 1, f > 0.8);
    g.setFillStyle({ color: on ? c : '#6c7aa8', alpha: on ? 0.95 : 0.3 })
      .rect(bx + i * seg + 4, by, seg - 8, bh)
      .fill();
  }
  // 100 % mark
  g.setFillStyle({ color: LCD_INK, alpha: 0.6 })
    .rect(bx + bw / 1.2 - 3, by - 14, 6, bh + 28)
    .fill();
}

/** PSU readout: draw versus budget gauge, temperature, fan. */
export function drawPsu(s: LiveState): void {
  const { T } = s,
    p = PSU_PANEL,
    g = s.gauge,
    tx = s.psuTexts;
  g.clear();
  if (!s.hasPsu) {
    return;
  }
  const ratio = s.psuRatio,
    off = s.psuOff,
    trip = s.psuTripped;
  const col = band(T, trip || ratio > 1, ratio > 0.8);
  setText(tx.load, off ? '0' : String(Math.round(s.psuW)), off ? T.mute : col);
  setText(tx.of, `W  /  ${Math.round(s.psuBudget)} W`, LCD_MUTE);
  setText(tx.pct, pctText(trip, off, ratio), off ? T.bad : col);
  const by = p.y + 560,
    bh = 90;
  drawGauge(s, { bx: p.x + 50, by });
  // temperature (estimated from load: the sim has no PSU heat), thermal state
  const tc = Math.round(s.psuTemp);
  const hot = tc >= 70,
    warm = tc >= 55;
  const tcol = band(T, hot, warm);
  setText(tx.temp, `${tc}°C`, tcol);
  setText(tx.state, stateText(off, hot, warm), off ? LCD_MUTE : tcol);
  const tw = 420,
    tt = clamp((s.psuTemp - 25) / 55);
  box(g, p.x + 1190 - 8, by - 8, tw + 16, bh + 16, 12, { fill: '#000000', fa: 0.5, stroke: T.line, lw: 4 });
  box(g, p.x + 1190, by, Math.max(10, tw * tt), bh, 8, { fill: tcol, fa: 0.9 });
}

/** The PSU fan's speed as a readout. */
const rpmText = (psuFan: FanLive | undefined): string => {
  if (!psuFan) {
    return 'NO FAN';
  }
  const rpm = psuFan.speed > 0.05 ? Math.round((500 + (psuFan.speed / 9) * 2300) / 10) * 10 : 0;
  return rpm === 0 ? 'STOPPED' : `${rpm} rpm`;
};

/** Per frame: the panel's fan turns, the rpm readout, and a first-order PSU temperature that follows load (estimated; the sim does not model PSU heat). */
export function framePsu(s: LiveState, dt: number): void {
  const psuFan = s.fans.find((f) => f.kind === 'psu');
  s.panelFan.rotation += (psuFan?.speed ?? 0) * dt;
  const target = s.psuOff ? 25 : 25 + 34 * clamp(s.psuRatio, 0, 1.4) ** 1.5;
  s.psuTemp += (target - s.psuTemp) * Math.min(1, dt * 0.25);
  const txt = rpmText(psuFan);
  if (s.psuTexts.rpm.text !== txt) {
    s.psuTexts.rpm.text = txt;
  }
  const tc = Math.round(s.psuTemp),
    tt = `${tc}°C`;
  if (s.psuTexts.temp.text !== tt) {
    s.psuTexts.temp.text = tt;
    s.psuTexts.temp.style.fill = band(s.T, tc >= 70, tc >= 55);
  }
}
