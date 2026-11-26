import { deviceLod } from '../lod/lod';
import { BR, GEO, MONITOR, MONITOR_K, SCREEN, USB_PORT, HIT_MS, drawPch, ledOf } from './features';
import { clamp } from './consts';
import type { LiveState } from './state';

/** The chipset works only while a message is on a path through it (BIOS at POST, a SATA drive, a card on its slots, the power switch). */
function stepPch(s: LiveState, now: number, dt: number): void {
  const busy = s.powered && s.liveOn && s.pchUntil > now;
  // a hard power-off is dark on the next frame
  if (s.powered) {
    s.pchLevel += ((busy ? 1 : 0) - s.pchLevel) * Math.min(1, dt * (busy ? 8 : 2.5));
  } else {
    s.pchLevel = 0;
  }
}

/** PCH: the legs a packet reaches or leaves flash, the package edge and heat sink warm while traffic crosses it, and the corner LED shows its state. */
function drawPchLive(s: LiveState, now: number): void {
  const lv = s.pchLevel;
  s.pchHits = s.powered ? s.pchHits.filter((h) => now < h.at + HIT_MS) : [];
  // out of view it is not drawn; the level and the hits above keep running, and the flag below makes it redraw on the way back
  if (s.view && !deviceLod(BR.chip, s.view).onScreen) {
    s.pchDrawn = true;
    return;
  }
  const led = ledOf(s.powered, s.bootPhase, s.keyActivity, now),
    drawn = led !== null || lv > 0.01 || s.pchHits.length > 0;
  if (drawn || s.pchDrawn) {
    s.bootG.clear();
    drawPch(s.bootG, s.T, BR.chip, { tier: GEO.tier, level: lv, hits: s.pchHits, led, now });
  }
  s.pchDrawn = drawn;
}

/** The USB LED's colour (null: dark), whether it is lit in its blink, and its brightness. */
interface UsbLook {
  col: string | null;
  on: boolean;
  la: number;
}

/**
 * USB port LED: dark with no power, and dark while halted or in error (no data moves: a key in the port is not read); steady green with
 * a key in; with an OS it follows keyActivity (enumerating: slow amber blink, ingesting / flashing: fast blink, done: steady green that
 * breathes = collect the key); without an OS it blinks while loading or writing.
 */
function usbLook(s: LiveState, now: number): UsbLook {
  const { T } = s,
    ph = s.bootPhase,
    act = s.keyActivity;
  // the USB port is dead, or nothing reads it
  if (!s.powered || ph === 'halted' || ph === 'error') {
    return { col: null, on: true, la: 1 };
  }
  if (act === 'enumerating') {
    return { col: T.ld, on: Math.floor(now / 450) % 2 === 0, la: 1 };
  }
  if (act === 'ingesting') {
    return { col: T.ld, on: Math.floor(now / 130) % 2 === 0, la: 1 };
  }
  if (act === 'flashing') {
    return { col: T.alu, on: Math.floor(now / 130) % 2 === 0, la: 1 };
  }
  if (act === 'done') {
    return { col: T.st, on: true, la: 0.75 + 0.25 * Math.sin(now * 0.005) };
  }
  if (s.plugged) {
    const active = ph === 'loading' || ph === 'writing';
    return { col: active ? T.ld : T.st, on: active ? Math.floor(now / 140) % 2 === 0 : true, la: 1 };
  }
  return { col: null, on: true, la: 1 };
}

function drawUsbLed(s: LiveState, now: number): void {
  const e = s.extG,
    lx = USB_PORT.x + 46,
    ly = USB_PORT.y - 52,
    { col, on, la } = usbLook(s, now);
  if (col !== null && col !== '') {
    if (on) {
      e.setFillStyle({ color: col, alpha: 0.3 * la })
        .circle(lx, ly, 30)
        .fill();
    }
    e.setFillStyle({ color: on ? col : '#2a3150', alpha: on ? la : 0.7 })
      .circle(lx, ly, 15)
      .fill();
  } else {
    e.setFillStyle({ color: '#2a3150', alpha: 0.6 }).circle(lx, ly, 15).fill();
  }
}

/** The monitor power LED's colour (green live, amber standby) and alpha (dark with its cord out). */
function monitorLed(s: LiveState): { col: string; a: number } {
  const { T } = s;
  if (!s.monitorLive) {
    return { col: T.mute, a: s.monitorPowered ? 0.4 : 0.12 };
  }
  return { col: s.powered ? T.st : T.ld, a: s.monitorPowered ? 1 : 0.12 };
}

/** The monitor power LED, and the thin boot progress bar under the picture while the machine boots. */
function drawMonitorLed(s: LiveState, showBar: boolean): void {
  const e = s.extG,
    m = MONITOR,
    sc = SCREEN,
    K = MONITOR_K,
    cy = sc.y + sc.h + 14 * K + (m.y + m.h - (sc.y + sc.h + 14 * K)) / 2;
  e.setFillStyle({ color: '#0a0f1a' })
    .circle(m.x + m.w - 150 * K, cy, 19 * K)
    .fill();
  const led = monitorLed(s);
  e.setFillStyle({ color: led.col, alpha: led.a })
    .circle(m.x + m.w - 150 * K, cy, 15 * K)
    .fill();
  if (!showBar) {
    return;
  }
  const bx = sc.x + 60 * K,
    by = sc.y + sc.h - 36 * K,
    bw = sc.w - 120 * K,
    th = 14 * K;
  e.setFillStyle({ color: '#0e1830' })
    .roundRect(bx, by, bw, th, th / 2)
    .fill();
  e.setFillStyle({ color: s.T.st, alpha: 0.9 })
    .roundRect(bx, by, Math.max(th, bw * clamp(s.bootProgress)), th, th / 2)
    .fill();
}

/** PCH leg flashes, edge glow and LED (interior), USB activity LED, monitor power LED, thin boot progress bar (external). */
export function drawBoot(s: LiveState, now: number, dt: number): void {
  const ph = s.bootPhase;
  stepPch(s, now, dt);
  const showBar =
    s.hasDisplay &&
    s.monitorLive &&
    s.powered &&
    (ph === 'posting' || ph === 'mounting' || ph === 'loading' || ph === 'booting-os');
  if (s.interior) {
    drawPchLive(s, now);
  }
  s.extG.clear();
  drawUsbLed(s, now);
  if (s.hasDisplay) {
    drawMonitorLed(s, showBar);
  }
}
