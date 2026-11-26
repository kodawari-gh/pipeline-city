// The machine's live frame (machine3d.ts): between rebuilds it only turns the fans, eases the state looks, lights the jacks, the RGB, the strip
// and the LEDs, and swings the side panel.
import { DARK, lightJack } from '@/features/network/render/jackleds';
import { fanBank } from '@/core/render/fanmotor';
import { fanMounts } from '@/features/room/render/desk/props/case';
import { stripModeOf } from '@/features/room/render/shell/exterior';
import { stripLight } from '../case3d';
import { doorOpen, swingDoor } from './door';
import { stateOf } from './keys';
import type { Fan, LinkLevels, MachineParts, Snapshot } from './types';

/** A frame's times and the network's say: `doorDt` is the side panel's own time, `net` what the network gives the jacks' lights. */
export interface Tick {
  dt: number;
  doorDt: number;
  net: LinkLevels;
}

/** The id a fan's speed goes by in `fanBank` (docs/render/air.md), from the cable it runs on, as the plan of the air names its banks. */
function bankOf(m: MachineParts, needs: string): string | null {
  if (needs === 'cpufan') {
    return 'cooler';
  }
  if (needs === 'vrmfan') {
    return 'vrm';
  }
  if (needs === 'ramfan') {
    return 'ramvrm';
  }
  const id = needs.startsWith('fan:') ? needs.slice(4) : '';
  return id !== '' && fanMounts().some((f) => f.id === id)
    ? `${m.rad?.span.ids.includes(id) === true ? 'radiator' : 'case'}:${id}`
    : null;
}

/** The jacks' lights, the memory map and the parts' state looks. */
function frameLooks(m: MachineParts, s: Snapshot | null, { dt, net }: Tick): void {
  const port = s?.net?.port;
  let plugged: string | null = null;
  if (port?.kind === 'board') {
    plugged = 'board';
  } else if (port?.kind === 'nic') {
    plugged = port.deviceId;
  }
  for (const [id, j] of m.lan) {
    lightJack(j, id === plugged ? net.pc : DARK.pc);
  }
  m.ramMap?.update(s?.ram ?? null, performance.now());
  if (s) {
    for (const d of s.devices) {
      m.skins.get(d.id)?.set(stateOf(s, d));
    }
  }
  for (const sk of m.skins.values()) {
    sk.frame(dt);
  }
  for (const sk of m.powerSkins.values()) {
    sk.frame(dt);
  }
}

/** One fan: it spins up quicker than it coasts down, its ring glows by its speed. */
function turnFan(m: MachineParts, f: Fan, at: { live: boolean; s: Snapshot | null; dt: number }): void {
  const { live, s, dt } = at,
    needs = f.needs ?? '';
  const want = live && (needs === '' || s?.cables.some((c) => c.id === f.needs && c.connected) === true) ? 1 : 0;
  f.speed += (want - f.speed) * (1 - (want > 0 ? 0.3 : 0.6) ** dt); // spins up quicker than it coasts down
  const a = f.speed * 18 * dt;
  f.rotor.rotation.z -= a;
  if (f.ring) {
    if (f.fixed === undefined) {
      f.ring.emissive.copy(m.accent);
    } else {
      f.ring.emissive.setHex(f.fixed);
    }
    f.ring.emissiveIntensity = (f.gain ?? (f.fixed === undefined ? 1.6 : 2)) * f.speed * m.ringK;
  }
}

/** The fans, and the speeds the airflow lens blows by: the air moves as fast as the fans on the screen turn. */
function turnFans(m: MachineParts, at: { live: boolean; s: Snapshot | null; dt: number }): void {
  const turning = new Map<string, number>();
  for (const f of m.fans) {
    turnFan(m, f, at);
    const need = f.needs ?? '',
      bank = need === '' ? null : bankOf(m, need);
    if (bank !== null) {
      turning.set(bank, Math.max(turning.get(bank) ?? 0, f.speed));
    }
  }
  for (const [bank, v] of turning) {
    fanBank.setLevel(bank, v);
  }
}

/** The RGB's lights, the strip, the side panel, the disk's blink and the front LEDs. */
function frameCase(m: MachineParts, s: Snapshot | null, at: { live: boolean; doorDt: number }): void {
  const { live } = at,
    rgb = m.accent;
  m.rgb.color.copy(rgb);
  m.rgb.intensity = live && m.caseRgb ? 0.9 : 0;
  m.spill.color.copy(rgb);
  m.spill.intensity = m.rgb.intensity * 0.3;
  m.stripMode = stripModeOf(s);
  if (m.strip) {
    stripLight(m.strip, m.stripMode, performance.now());
  }
  if (m.door) {
    swingDoor(m, m.door, at.doorDt);
  }
  m.blink = live && s !== null && s.storage.some((d) => d.busy);
  if (m.leds) {
    m.leds.on.emissiveIntensity = live ? 1.5 : 0;
    m.leds.err.emissiveIntensity = s?.phase === 'error' || s?.power.tripped === true ? 1.5 : 0;
    m.leds.disk.emissiveIntensity = m.blink && performance.now() % 240 < 150 ? 1.6 : 0;
  }
}

/** The live frame: `net` lights the jack the cable is in, every other jack stays dark. */
export function frame(m: MachineParts, s: Snapshot | null, t: Tick): void {
  const live = s !== null && s.powered && !s.power.tripped && !s.board.burnt;
  frameLooks(m, s, t);
  turnFans(m, { live, s, dt: t.dt });
  frameCase(m, s, { live, doorDt: t.doorDt });
}

/**
 * Something of the machine moves after the last `frame`: a fan turns or coasts, the side panel swings, the strip pulses or blinks, the disk LED
 * flickers, a part eases to its state's look. A frame drawn on demand (docs/render/load.md) keeps drawing meanwhile.
 */
export function moving(m: MachineParts): boolean {
  if (m.fans.some((f) => f.speed > 1e-3)) {
    return true;
  }
  const d = m.door;
  if (d && d.t !== (doorOpen(m) ? 1 : 0)) {
    return true;
  }
  if (m.strip && (m.stripMode === 'work' || m.stripMode === 'error')) {
    return true;
  }
  if (m.blink && m.leds) {
    return true;
  }
  return [...m.skins.values(), ...m.powerSkins.values()].some((sk) => sk.easing);
}
