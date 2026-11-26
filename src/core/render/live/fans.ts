import type { Snapshot } from '../../../worker/protocol';
import { clamp } from './consts';
import type { LiveState } from './state';

/** A device of the snapshot (the CPU, a cooler, a sink...). */
type Device = Snapshot['devices'][number];
type Cpu = Device;

/** A fan only turns while its cable is plugged (a case fan or the radiator's on the hub, so the hub's own cable too; the others on their header). */
const pluggedIn =
  (snap: Snapshot) =>
  (id: string): boolean =>
    snap.cables.find((c) => c.id === id)?.connected === true;

/** The CPU runs a job: a request, a working CPU, power, and a clock. */
function cpuRunning(snap: Snapshot, cpu: Cpu | undefined): boolean {
  return (
    Boolean(snap.request) &&
    cpu !== undefined &&
    !cpu.burnt &&
    !snap.power.off &&
    !snap.power.tripped &&
    cpu.effectiveClock > 0
  );
}

/** The fan or the pump's impeller (on the CPU_FAN header), and a liquid cooler's radiator fan (on its mount's hub header). */
function coolerFans(s: LiveState, d: Device, at: { plugged: (id: string) => boolean; running: boolean }): void {
  const { plugged, running } = at,
    hubOn = plugged('sysfan');
  for (const f of s.fans) {
    let on: boolean | null = null;
    if (f.kind === 'cooler') {
      on = plugged('cpufan');
    } else if (f.kind.startsWith('radiator:')) {
      on = hubOn && plugged(`fan:${f.kind.slice(9)}`);
    }
    if (on !== null) {
      f.target = d.burnt || !s.liveOn || !on ? 0 : 1.2 + 9 * s.cpuHeat + (running ? 2 : 0);
    }
  }
}

/** A heatsink's fan follows its part's load (its draw is 0.3 W idle to 1.5 W under load) and stops with the power. */
function sinkFan(
  s: LiveState,
  d: Device,
  fan: { kind: string; cable: string; plugged: (id: string) => boolean },
): void {
  const f = s.fans.find((x) => x.kind === fan.kind);
  if (f) {
    f.target = d.burnt || !s.liveOn || !fan.plugged(fan.cable) ? 0 : 1.5 + 7 * clamp((d.powerW - 0.3) / 1.2);
  }
}

/** The case fans run with the machine and speed up with the CPU's heat; the cooler, sink and PSU fans follow their parts. */
export function updateFans(s: LiveState, snap: Snapshot, at: { cpu: Cpu | undefined; ratio: number }): void {
  const plugged = pluggedIn(snap);
  const hubOn = plugged('sysfan');
  const running = cpuRunning(snap, at.cpu);
  for (const f of s.fans) {
    if (f.kind.startsWith('case:')) {
      f.target = !s.liveOn || !hubOn || !plugged(`fan:${f.kind.slice(5)}`) ? 0 : 1.6 + 6 * s.cpuHeat;
    }
  }
  for (const d of snap.devices) {
    if (d.kind === 'cooler') {
      coolerFans(s, d, { plugged, running });
    } else if (d.kind === 'vrm-sink') {
      sinkFan(s, d, { kind: 'vrm', cable: 'vrmfan', plugged });
    } else if (d.kind === 'ram-sink') {
      sinkFan(s, d, { kind: 'ramvrm', cable: 'ramfan', plugged });
    } else if (d.kind === 'psu') {
      for (const f of s.fans) {
        if (f.kind === 'psu' || f.kind === 'psurear') {
          f.target = s.liveOn ? 1 + 8 * clamp(at.ratio) : 0;
        }
      }
    }
  }
}
