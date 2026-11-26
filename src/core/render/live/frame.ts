import { fanBank } from '../fanmotor';
import { pointAt, drawDriveLive, EdgeFan } from './features';
import { PROBE_MS, STREAM_GAP, clamp } from './consts';
import type { LiveState } from './state';
import { fire, send } from './traffic';
import type { DriveLive } from './types';

/** The fans ease toward their targets (fanmotor.ts): a fan seen edge-on slides its blades along it, the others turn. */
export function frameFans(s: LiveState, dt: number): void {
  for (const f of s.fans) {
    f.speed = f.motor.step(dt, f.target); // eases up from still and coasts down to still (fanmotor.ts); a fan that may not turn has target 0
    fanBank.set(f.kind, f.speed);
    // a fan seen edge-on (a case fan, a sink's): the blades slide along it
    if (f.c instanceof EdgeFan) {
      f.c.spin(f.speed * dt * 0.8, Math.min(1, f.speed / 5));
    } else {
      f.c.rotation += f.speed * dt;
    }
  }
}

/** The parts' heat glow breathes a little. */
export function frameGlows(s: LiveState, now: number): void {
  for (const gl of s.glows.values()) {
    const pulse = 0.85 + 0.15 * Math.sin(now * 0.004 + gl.t.rect.x);
    gl.g.alpha = clamp(gl.base * pulse, 0, 1);
  }
}

/**
 * Data buses: a packet per message (events send theirs where they happen); a streaming bus sends the next one when the last has gone.
 * Power conductors glow in proportion to their current. The streams and the pings of POST send their next message.
 */
export function frameBuses(s: LiveState, dt: number, now: number): void {
  // off, tripped or dead: no packet or glow on the next frame
  if (!s.liveOn) {
    s.busFlow.clear();
    s.extFlow.clear();
  }
  for (const l of s.interior ? [...s.lit.values(), ...s.memLit.values()] : []) {
    if (!s.liveOn) {
      l.level = 0;
      if (l.g) {
        l.g.alpha = 0;
      }
      continue;
    }
    // current, not messages: glows in proportion
    if (l.power) {
      l.level += (l.hold - l.level) * Math.min(1, dt * 3);
      if (l.g) {
        l.g.alpha = l.level * 0.55;
      }
      continue;
    }
    if (l.stream) {
      send(s, l, STREAM_GAP);
    }
  }
  for (const [key, c] of s.streams) {
    fire(s, { key, gap: STREAM_GAP }, c);
  }
  if (s.probes.length > 0) {
    const i = Math.floor(now / PROBE_MS) % s.probes.length;
    const probe = s.probes[i];
    if (probe) {
      fire(s, { key: `probe:${i}`, gap: PROBE_MS }, probe);
    }
  }
}

/** The power cables' glow eases to its level, and three dots run along each lit cable. Returns how many dots are used. */
export function frameCables(s: LiveState, dt: number): number {
  const r = Math.max(9, 2.4 / s.zoom) / 16;
  let k = 0;
  if (!s.interior) {
    return k;
  }
  for (const lc of s.cables) {
    if (!s.liveOn) {
      lc.level = 0;
      lc.g.alpha = 0;
      continue;
    }
    lc.level += (lc.target - lc.level) * Math.min(1, dt * 2.5);
    lc.g.alpha = lc.level * 0.55;
    if (lc.level < 0.03) {
      continue;
    }
    const lane = lc.cable.path;
    for (let j = 0; j < 3; j++) {
      const pt = pointAt(lane, s.phase * -0.9 + (j * lane.len) / 3);
      const sp = s.dots[k++];
      if (!sp) {
        continue;
      }
      sp.visible = true;
      sp.position.set(pt[0], pt[1]);
      sp.tint = lc.color;
      sp.alpha = 0.85 * lc.level;
      sp.scale.set(r * 1.4);
    }
  }
  return k;
}

/** The drive's LED target: an HDD's flickers, an SSD's blinks, while busy. */
const ledTarget = (dr: DriveLive, lit: boolean, now: number): number => {
  if (!lit) {
    return 0;
  }
  if (dr.kind === 'hdd') {
    return 0.65 + 0.35 * Math.sin(now * 0.03);
  }
  return Math.floor(now / 80) % 2 ? 1 : 0.15;
};

/** One drive: platter / head / LED move only while busy. */
function frameDrive(s: LiveState, dr: DriveLive, at: { dt: number; now: number }): void {
  const { dt, now } = at;
  // off, tripped or dead: platter, arm and LED are still at once
  if (!s.liveOn) {
    dr.speed = 0;
    dr.head = 0;
    dr.led = 0;
  }
  const lit = dr.busyUntil > now;
  const idle = dr.kind === 'hdd' && s.liveOn ? 4 : 0; // a powered hard disk keeps turning between commands
  dr.speed += ((lit ? 16 : idle) - dr.speed) * Math.min(1, dt * (lit ? 4 : 2.5));
  if (!lit && !idle && dr.speed < 0.05) {
    dr.speed = 0;
  }
  dr.spin += dr.speed * dt;
  dr.head += ((lit ? 0.5 + 0.5 * Math.sin(now * 0.009 + 1) : 0) - dr.head) * Math.min(1, dt * 6);
  dr.led += (ledTarget(dr, lit, now) - dr.led) * Math.min(1, dt * 14);
  if (!lit && dr.led < 0.03) {
    dr.led = 0;
  }
  const sig = `${Math.round(dr.spin * 20)}|${Math.round(dr.head * 40)}|${Math.round(dr.led * 10)}|${dr.burnt}`;
  if (s.interior && dr.g && sig !== dr.sig) {
    dr.sig = sig;
    drawDriveLive(dr.g, s.T, dr.kind, dr.slot, { spin: dr.spin, head: dr.head, led: dr.led, burnt: dr.burnt });
  }
}

/** Drives: platter / head / LED only while busy (the SATA cable sends packets while data moves); the case's disk LED follows the brightest. */
export function frameDrives(s: LiveState, dt: number, now: number): void {
  s.diskLevel = 0;
  for (const dr of s.drives.values()) {
    frameDrive(s, dr, { dt, now });
    s.diskLevel = Math.max(s.diskLevel, dr.led);
  }
}

/** The cards: those out of view are not drawn, and at most two show their counters, the ones nearest the centre (lod.ts `TierBudget`). */
export function frameCards(s: LiveState, dt: number, paused: boolean): void {
  const inner = s.interior,
    v = s.view;
  const lod =
    inner && v
      ? {
          view: v,
          top: s.detail.assign([
            ...s.gpu.candidates(v),
            ...s.disk.candidates(v),
            ...s.npu.candidates(v),
            ...s.tpm.candidates(v),
          ]),
        }
      : undefined;
  s.ram.frame(inner, undefined, v ?? undefined);
  s.gpu.frame(dt, inner, paused, lod);
  s.disk.frame(dt, inner, paused, lod);
  s.tpm.frame(dt, inner, paused, lod);
  s.npu.frame(dt, inner, paused, lod);
}
