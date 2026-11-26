import type { Snapshot } from '../../../worker/protocol';
import { loopBank, machineLive } from '../fanmotor';
import {
  getSpec,
  POST_CODE_CHAIN,
  POWER_ON_CHAIN,
  VIDEO_CHAIN,
  VOLTAGE_CHAIN,
  hasTpm,
  keyChain,
  slotChain,
} from './features';
import { clamp } from './consts';
import { updateGpuFrame, updateOsScreen } from './osScreen';
import { updatePower } from './power';
import type { Cpu } from './types';
import type { LiveState } from './state';
import { arm, armDrive, fire, flowMem, netHops, postProbes } from './traffic';

/** A stick's size in bytes (0 for a spec that is not RAM). */
function stickBytes(id: string): number {
  const spec = getSpec(id);
  return spec !== undefined && 'sizeBytes' in spec ? spec.sizeBytes : 0;
}

/** The card views and the RAM map follow every snapshot (also the null one before the sim starts). */
function updateViews(s: LiveState, snap: Snapshot | null): void {
  if (snap) {
    const sticks = snap.devices
      .filter((d) => d.kind === 'ram')
      .map((d, i) => ({
        idx: s.dimmIdx[i] ?? i,
        bytes: stickBytes(d.spec),
      }));
    s.ram.setSticks(sticks);
  }
  s.ram.setMap(snap?.ram ?? null);
  loopBank.set(snap?.board?.loop ?? null);
  s.gpu.update(snap?.gpus, snap?.devices, machineLive(snap));
  s.disk.update(snap?.storage);
  s.tpm.update(snap?.tpm);
  s.npu.update(snap?.npus);
}

/**
 * Power: a switched off, tripped or dead machine is dead (no fans, lights or current). A halted or error machine is still ON:
 * its fans, lights and power conductors run, but no data moves (no buses, drive activity or USB LED), so no packet starts.
 * The cold-boot wait (posting, before the first POST line: no progress yet) is the CPU idling: nothing is read yet.
 */
function readMachine(s: LiveState, snap: Snapshot, cpu: Cpu | undefined): void {
  const spec = cpu && getSpec(cpu.spec);
  s.clockRatio = cpu && spec?.clock ? clamp(cpu.effectiveClock / spec.clock.base, 0.25, 3) : 1;
  s.cpuHeat = cpu ? clamp((cpu.tempC - 35) / 55) : 0;
  const coldWait = snap.phase === 'posting' && !(snap.bootProgress > 0);
  s.liveOn = machineLive(snap);
  s.quiet = !s.liveOn || snap.phase === 'halted' || snap.phase === 'error' || coldWait;
  // the phase below arms what moves data now
  for (const l of s.memLit.values()) {
    l.stream = false;
  }
  s.streams.clear();
  s.probes = [];
  // ---- activity: only real traffic lights a bus ----
  s.snap = snap;
  s.installed = new Set([...snap.devices.map((d) => d.slot), ...(snap.storage ?? []).map((d) => d.slot)]);
  s.tpmFitted = hasTpm(snap.devices);
  s.keyIn = Boolean(snap.plugged);
  s.boardVideo = (snap.videoPort ?? 'board') === 'board';
  s.bootPhase = snap.phase;
  s.bootProgress = snap.bootProgress;
  s.monitorLive = snap.monitorLive;
  s.monitorPowered = snap.monitorPowered ?? true;
  s.powered = snap.powered;
}

/**
 * Every message goes where the copper goes (board/busmap.ts): the key's data over the hub's uplink and its port only, a SATA drive over its
 * port and DMI, an M.2 straight to the CPU, a card over its slot (and DMI when the slot is the chipset's), the BIOS over SPI and DMI.
 */
function armPhase(s: LiveState, snap: Snapshot): void {
  const ph = snap.phase;
  // POST pings what is installed, also while the screen is still black
  if (ph === 'posting') {
    s.probes = postProbes(s, snap);
  } else if (ph === 'loading') {
    arm(s, 'key', { hops: keyChain(false) });
    flowMem(s, 1);
  } else if (ph === 'writing') {
    arm(s, 'key', { hops: keyChain(true) });
    flowMem(s, -1);
  } else if (ph === 'booting-os' || ph === 'ingesting' || ph === 'flashing') {
    // Drive side: booting reads the kernel (drive -> RAM/CPU), ingesting writes the key's job to the spool (key -> drive), flashing reads the result back (drive -> key).
    const bootSlot = snap.os?.slot ?? snap.storage.find((d) => d.hasOs)?.slot ?? null;
    if (bootSlot !== null && bootSlot !== '') {
      armDrive(s, bootSlot, ph === 'ingesting');
    }
    const dir = ph === 'flashing' ? 'up' : 'down';
    // the phase is the same for a stick in the port and for a job from the network (the kernel's NIC driver takes it from the receive ring): only a real key uses the USB lanes
    if (ph === 'booting-os') {
      flowMem(s, 1);
    } else if (snap.plugged) {
      arm(s, 'key', { hops: keyChain(ph === 'flashing') });
    } else {
      arm(s, `net:${dir}`, { hops: netHops(snap, dir) });
    }
  }
}

/** Storage activity: the platter / LEDs / bus light only while the drive reports busy (held a moment so snapshots do not flicker). */
function armDrives(s: LiveState, snap: Snapshot, now: number): void {
  for (const st of snap.storage ?? []) {
    const dr = s.drives.get(st.slot);
    if (!dr) {
      continue;
    }
    dr.burnt = st.burnt;
    // data moved since the last snapshot (file-system writes and reads do not always show as a busy port): hold its direction for a moment
    if (dr.read >= 0 && (st.bytesRead > dr.read || st.bytesWritten > dr.wrote)) {
      dr.ioUntil = now + 900;
      dr.ioWrite = st.bytesWritten > dr.wrote;
    }
    dr.read = st.bytesRead;
    dr.wrote = st.bytesWritten;
    if (snap.powered && !s.quiet && dr.ioUntil > now) {
      dr.busyUntil = Math.max(dr.busyUntil, now + 900);
      armDrive(s, st.slot, dr.ioWrite);
    } else if (st.busy && snap.powered) {
      dr.busyUntil = Math.max(dr.busyUntil, now + 900);
      armDrive(s, st.slot, snap.phase === 'ingesting');
    }
  }
}

/** The picture: a new line on the screen leaves the CPU's video lanes for the HDMI port (or, with the cable on a card, leaves the card). */
function fireVideo(s: LiveState, snap: Snapshot): void {
  const shown = snap.display || '';
  if (shown !== s.lastText) {
    if (shown && snap.monitorLive) {
      fire(s, { key: 'video' }, { hops: (snap.videoPort ?? 'board') === 'board' ? VIDEO_CHAIN : [], cable: true });
    }
    // a POST step: the code on the debug display
    if (snap.phase === 'posting' && snap.bootProgress !== s.lastProgress) {
      fire(s, { key: 'postcode' }, { hops: POST_CODE_CHAIN });
    }
    s.lastText = shown;
  }
  s.lastProgress = snap.bootProgress;
}

/** Cards on the PCIe slots (the host copies in, the card computes inside, the result is copied out) and network transfers. */
function armCards(s: LiveState, snap: Snapshot): void {
  for (const g of snap.gpus ?? []) {
    if (g.phase === 'in' || g.phase === 'out') {
      arm(s, `gpu:${g.slot}`, { hops: slotChain(g.slot, g.phase === 'in') });
    }
    // the card is drawing the picture the cable carries
    if (g.phase === 'run' && g.slot === snap.videoPort) {
      arm(s, 'gpuvideo', { hops: [], cable: true });
    }
  }
  // the network: transfers run over the board's jack (PHY, hub, uplink) or the NIC card's slot, toward the CPU for a download
  const { net } = snap,
    down = net?.transfers.some((t) => t.dir === 'down') ?? false,
    up = net?.transfers.some((t) => t.dir === 'up') ?? false;
  if (net !== undefined && (down || up) && (net.state === 'link-up' || net.state === 'saturated')) {
    if (down) {
      arm(s, 'net:down', { hops: netHops(snap, 'down') });
    }
    if (up) {
      arm(s, 'net:up', { hops: netHops(snap, 'up') });
    }
  }
}

/** Power-on: the switch is read and the CPU asks for its voltage; a change of clock or throttle asks again. */
function firePower(s: LiveState, snap: Snapshot, cpu: Cpu | undefined): void {
  if (s.wasPowered === false && snap.powered) {
    fire(s, { key: 'power', gap: 0 }, { hops: POWER_ON_CHAIN, force: true });
    fire(s, { key: 'volt', gap: 0 }, { hops: VOLTAGE_CHAIN, force: true });
  }
  s.wasPowered = snap.powered;
  if (
    cpu &&
    snap.powered &&
    (Math.abs(cpu.effectiveClock - s.lastClock) > 0.01 * Math.max(1, s.lastClock) ||
      Math.abs(cpu.throttle - s.lastThrottle) > 0.01)
  ) {
    fire(s, { key: 'volt', gap: 900 }, { hops: VOLTAGE_CHAIN });
  }
  s.lastClock = cpu?.effectiveClock ?? 0;
  s.lastThrottle = cpu?.throttle ?? 1;
}

/** The board: the regulator's state for its power-good light, a dead board for the dimming; a quiet machine stops its streams. */
function settle(s: LiveState, snap: Snapshot): void {
  s.vrm = snap.board?.vrm ?? null;
  s.dead = snap.board?.burnt ?? false;
  if (!s.quiet) {
    return;
  }
  for (const l of s.memLit.values()) {
    l.stream = false;
  }
  // (only the BIOS reads while the screen is black)
  for (const [k, c] of s.streams) {
    if (!s.liveOn || c.force !== true) {
      s.streams.delete(k);
    }
  }
  for (const dr of s.drives.values()) {
    dr.busyUntil = -1e9;
  }
}

/** Per-snapshot update. `snap` may be null before the sim has started. */
export function update(s: LiveState, snap: Snapshot | null, now: number): void {
  s.gt = now;
  updateViews(s, snap);
  if (!snap) {
    return;
  }
  const cpu = snap.devices.find((d) => d.kind === 'cpu');
  readMachine(s, snap, cpu);
  if (snap.powered) {
    armPhase(s, snap);
  }
  armDrives(s, snap, now);
  fireVideo(s, snap);
  armCards(s, snap);
  firePower(s, snap, cpu);
  s.keyActivity = snap.keyActivity ?? 'none';
  updateGpuFrame(s, snap);
  updateOsScreen(s, snap);
  settle(s, snap);
  updatePower(s, snap, cpu);
}
