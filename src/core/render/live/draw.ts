import type { Snapshot } from '../../../worker/protocol';
import { box, mix } from '../ink';
import { clamp } from './consts';
import type { Theme } from '../theme';
import { BD, BR, RAM_SINK, VRM_LED, VRM_SINK, vrmPhase } from './features';
import type { LiveState } from './state';
import type { Glow } from './types';

/** A dead board: the whole board dimmed, the VRM scorched and cracked. Static; redrawn only when the state flips. */
export function drawDead(s: LiveState): void {
  if (s.dead === s.deadDrawn) {
    return;
  }
  s.deadDrawn = s.dead;
  const g = s.deadG,
    { T } = s;
  g.clear();
  if (!s.dead) {
    return;
  }
  box(g, BD.x, BD.y, BD.w, BD.h, 150, { fill: T.bg, fa: 0.5 });
  const v = BR.vrm;
  // soot: dark, uneven blots over the phase blocks and the heatsink pad
  for (let i = 0; i < 6; i++) {
    const r = vrmPhase(i),
      k = (i * 37) % 5;
    g.setFillStyle({ color: '#000000', alpha: 0.4 })
      .ellipse(r.x + r.w / 2 + (k - 2) * 14, r.y + 120 + (k % 3) * 40, 150 - k * 8, 170 - k * 12)
      .fill();
  }
  g.setFillStyle({ color: '#000000', alpha: 0.28 })
    .ellipse(v.x + v.w / 2, v.y + 150, v.w * 0.42, 150)
    .fill();
  const vs = VRM_SINK;
  g.setFillStyle({ color: '#000000', alpha: 0.2 }).rect(vs.x, vs.y, vs.w, vs.h).fill();
  const rs = RAM_SINK,
    dv = BR.dvrm;
  g.setFillStyle({ color: '#000000', alpha: 0.3 })
    .ellipse(dv.x + dv.w / 2, dv.y + dv.h / 2, dv.w * 0.4, dv.h * 0.4)
    .fill();
  g.setFillStyle({ color: '#000000', alpha: 0.2 }).rect(rs.x, rs.y, rs.w, rs.h).fill();
  // cracks
  g.moveTo(v.x + 520, v.y + 40)
    .lineTo(v.x + 560, v.y + 150)
    .lineTo(v.x + 520, v.y + 250)
    .lineTo(v.x + 590, v.y + 380);
  g.moveTo(v.x + 1500, v.y + 60)
    .lineTo(v.x + 1460, v.y + 190)
    .lineTo(v.x + 1530, v.y + 300);
  g.stroke({ width: 8, color: '#000000', alpha: 0.7, cap: 'round', join: 'round' });
  g.moveTo(v.x + 520, v.y + 40)
    .lineTo(v.x + 560, v.y + 150)
    .lineTo(v.x + 520, v.y + 250)
    .lineTo(v.x + 590, v.y + 380);
  g.stroke({ width: 2.5, color: T.bad, alpha: 0.5, cap: 'round', join: 'round' });
}

/** The colour of the power-good light: green when healthy, amber when unstable, red when the board is dead, dark (null) with no power. */
function powerGoodColor(s: LiveState): string | null {
  const v = s.vrm,
    { T } = s;
  if (!v) {
    return null;
  }
  if (s.dead) {
    return T.bad;
  }
  if (!s.liveOn) {
    return null;
  }
  return v.unstable ? T.ld : T.st;
}

/** The power-good light of the VRM, steady: green when healthy, amber when unstable, red when the board is dead, dark with no power. (The phases do not glow and a crash does not flash: the power lens shows the regulators.) */
export function drawPowerGood(s: LiveState): void {
  const col = powerGoodColor(s);
  const key = col ?? '';
  if (key === s.pgoodDrawn) {
    return;
  }
  s.pgoodDrawn = key;
  const g = s.vrmG;
  g.clear();
  if (col === null || col === '') {
    return;
  }
  g.setFillStyle({ color: col, alpha: 0.28 }).circle(VRM_LED.x, VRM_LED.y, 38).fill();
  g.setFillStyle({ color: col }).circle(VRM_LED.x, VRM_LED.y, 14).fill();
}

export function setBadge(s: LiveState, text: string, color: string): void {
  s.badge.visible = true;
  if (s.badge.text !== text) {
    s.badge.text = text;
  }
  s.badge.style.fill = color;
}

/** A part's glow: four soft rings in `look.color`; a burnt part instead is dimmed and crossed out. */
function drawGlow(T: Theme, gl: Glow, look: { color: string; burnt: boolean }): void {
  const { g, dim, t } = gl,
    r = t.rect;
  g.clear();
  dim.clear();
  if (look.burnt) {
    box(dim, r.x, r.y, r.w, r.h, 24, { fill: T.bg, fa: 0.62 });
    dim
      .moveTo(r.x + r.w * 0.2, r.y + r.h * 0.2)
      .lineTo(r.x + r.w * 0.8, r.y + r.h * 0.8)
      .moveTo(r.x + r.w * 0.8, r.y + r.h * 0.2)
      .lineTo(r.x + r.w * 0.2, r.y + r.h * 0.8);
    dim.stroke({ width: Math.max(16, Math.min(r.w, r.h) * 0.03), color: T.bad, alpha: 0.85, cap: 'round' });
    return;
  }
  for (let i = 0; i < 4; i++) {
    const e = 8 + i * 14;
    box(g, r.x - e, r.y - e, r.w + 2 * e, r.h + 2 * e, 40 + e, { stroke: look.color, lw: 14, sa: 0.5 * (1 - i / 4) });
  }
}

/** The OS badge's dot: its colour and alpha for the phase, on the game clock. */
function badgeDot(T: Theme, ph: LiveState['badgePhase'], now: number): { col: string; a: number } {
  const blink = Math.floor(now / 140) % 2 ? 1 : 0.4;
  if (ph === 'booting-os') {
    return { col: T.ld, a: 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(now * 0.008)) };
  }
  if (ph === 'idle-os') {
    return { col: T.st, a: 1 };
  }
  if (ph === 'ingesting') {
    return { col: T.mul, a: blink };
  }
  if (ph === 'running-os') {
    return { col: T.alu, a: 0.6 + 0.4 * Math.sin(now * 0.012) };
  }
  if (ph === 'flashing') {
    return { col: T.ld, a: blink };
  }
  return { col: T.mute, a: ph === 'off' || ph === 'error' ? 0.5 : 1 };
}

/** The OS badge on the host drive, its dot animated by phase. */
export function drawBadge(s: LiveState, now: number): void {
  const g = s.badgeG,
    r = s.badgeRect,
    t = s.badgeText,
    { T } = s;
  g.clear();
  if (!t) {
    return;
  }
  t.visible = r !== null;
  if (!r) {
    return;
  }
  box(g, r.x, r.y, r.w, r.h, 14, { fill: '#0b1226', fa: 0.92, stroke: T.st, lw: 5, sa: 0.85 });
  const dotX = r.x + r.w - 30,
    dotY = r.y + r.h / 2;
  const { col, a } = badgeDot(T, s.badgePhase, now);
  g.setFillStyle({ color: col, alpha: 0.25 * a })
    .circle(dotX, dotY, 22)
    .fill();
  g.setFillStyle({ color: col, alpha: a }).circle(dotX, dotY, 13).fill();
  t.position.set(r.x + 20, r.y + r.h / 2);
  t.style.fill = T.st;
}

/** The parts' glow is heat, not load: a cool part at idle stays unlit; an unstable part glows red, a burnt one is crossed out. */
export function updateHeatGlows(s: LiveState, snap: Snapshot): void {
  const { T } = s;
  for (const d of snap.devices) {
    // (their fans only: `fans.ts`)
    if (d.kind === 'vrm-sink' || d.kind === 'ram-sink' || d.kind === 'psu') {
      continue;
    }
    const gl = s.glows.get(d.id);
    if (!gl) {
      continue;
    }
    const heat = clamp((d.tempC - 42) / 48);
    let col = heat < 0.5 ? mix(T.alu, T.ld, heat * 2) : mix(T.ld, T.bad, (heat - 0.5) * 2);
    if (d.unstable) {
      col = T.bad;
    }
    gl.base = d.burnt || d.kind === 'display' ? 0 : heat * 0.85;
    drawGlow(T, gl, { color: col, burnt: d.burnt });
  }
}
