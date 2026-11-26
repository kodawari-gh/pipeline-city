// Power-draw helpers for one thermal tick.
import { deviceSpec, fanHost } from './board';
import type * as boardTypes from './board';
import { AMBIENT_C } from './specs';
import type * as specsTypes from './specs';
import type * as airflowTypes from './airflow';
import { currentDemand, efficiency, lossW, loadRatio, ramDemand } from './vrm';
import { THROTTLE_MIN, TRIP_RATIO, clockPowerW, isCard } from './thermalCore';
import type * as thermalCoreTypes from './thermalCore';

/** The live fields `runThermalStep` reads and writes (the `ThermalModel` instance). */
export interface ThermalRuntime {
  devices: Map<string, thermalCoreTypes.DeviceThermal>;
  vrm: thermalCoreTypes.VrmThermal;
  ramVrm: thermalCoreTypes.VrmThermal;
  power: thermalCoreTypes.PowerReport;
  caseRiseC: number;
  loopC: number;
  loopRejectW: number;
  loopFlow: number;
  loopHotC: number;
  loopColdC: number;
  loopSide: 'front' | 'top' | null;
  air: Record<airflowTypes.AirZoneId, airflowTypes.ZoneAir>;
}

export interface VrmNow {
  ratio: number;
  eff: number;
  loss: number;
}
export type PowerOf = (d: boardTypes.InstalledDevice, psuFactor: number) => { w: number; clk: number };

export function kindLoad(loads: thermalCoreTypes.Loads) {
  return (d: boardTypes.InstalledDevice): number => {
    const k = deviceSpec(d).kind;
    return loads[k] ?? (k === 'gpu' || k === 'npu' || k === 'tpm' ? 0 : 1);
  };
}

export function throttleOf(v: thermalCoreTypes.VrmThermal, s: thermalCoreTypes.VrmSpecOf): number {
  if (v.tempC <= s.throttleC) {
    return 1;
  }
  return Math.max(THROTTLE_MIN, 1 - ((1 - THROTTLE_MIN) * (v.tempC - s.throttleC)) / (s.unstableC - s.throttleC));
}

function deviceTherm(st: thermalCoreTypes.DeviceThermal, t: specsTypes.DeviceSpec['thermal']): number {
  if (st.tempC <= t.throttleC) {
    return 1;
  }
  return Math.max(THROTTLE_MIN, 1 - ((1 - THROTTLE_MIN) * (st.tempC - t.throttleC)) / (t.unstableC - t.throttleC));
}

export function ensure(
  devices: Map<string, thermalCoreTypes.DeviceThermal>,
  d: boardTypes.InstalledDevice,
): thermalCoreTypes.DeviceThermal {
  let s = devices.get(d.id);
  if (!s) {
    s = {
      tempC: AMBIENT_C,
      powerW: 0,
      heatW: 0,
      effClock: 0,
      throttle: 1,
      unstable: false,
      stress: 0,
      errProb: 0,
      fan: 0,
    };
    devices.set(d.id, s);
  }
  return s;
}

export function pruneDevices(model: ThermalRuntime, board: boardTypes.Board): void {
  const stale: string[] = [];
  for (const id of model.devices.keys()) {
    if (!board.devices.some((d) => d.id === id)) {
      stale.push(id);
    }
  }
  for (const id of stale) {
    model.devices.delete(id);
  }
}

export function lastTickTherm(model: ThermalRuntime, board: boardTypes.Board): Map<string, number> {
  const therm = new Map<string, number>();
  for (const d of board.devices) {
    therm.set(d.id, deviceTherm(ensure(model.devices, d), deviceSpec(d).thermal));
  }
  return therm;
}

function clockTrim(kind: specsTypes.DeviceKind, vrmThrottle: number, ramThrottle: number): number {
  if (kind === 'cpu') {
    return vrmThrottle;
  }
  if (kind === 'ram') {
    return ramThrottle;
  }
  return 1;
}

export function makePowerOf(input: {
  board: boardTypes.Board;
  live: boolean;
  fans: thermalCoreTypes.FanPower;
  load: (d: boardTypes.InstalledDevice) => number;
  cpuLoad: number;
  therm: Map<string, number>;
  vrmThrottle: number;
  ramThrottle: number;
}): PowerOf {
  const hostOn: Partial<Record<specsTypes.DeviceKind, boolean>> = {
    cooler: input.fans.cpu,
    'vrm-sink': input.fans.vrm,
    'ram-sink': input.fans.ram,
  };
  const turns = (d: boardTypes.InstalledDevice): boolean => {
    const host = fanHost(d.slot);
    if (host === null) {
      return input.fans.mounts ? input.fans.mounts.includes(d.slot) : true;
    }
    const h = input.board.devices.find((x) => x.slot === host);
    return h !== undefined && hostOn[deviceSpec(h).kind] === true;
  };
  return (d, psuFactor) => {
    const spec = deviceSpec(d);
    if (!input.live || d.burnt === true) {
      return { w: 0, clk: 0 };
    }
    if (spec.kind === 'nic' || spec.kind === 'tpm') {
      return { w: spec.idleW + (spec.loadW - spec.idleW) * input.load(d), clk: 0 };
    }
    if (!spec.clock) {
      // A pump or a fan follows the CPU load (a fan only while it turns); the PSU draws nothing of its own in this model.
      const follows =
        spec.kind === 'cooler' ||
        spec.kind === 'vrm-sink' ||
        spec.kind === 'ram-sink' ||
        (spec.kind === 'fan' && turns(d));
      return { w: follows ? spec.idleW + (spec.loadW - spec.idleW) * input.cpuLoad : 0, clk: 0 };
    }
    const lastTherm = input.therm.get(d.id);
    if (lastTherm === undefined) {
      throw new Error(`no thermal state for ${d.id}`);
    }
    const clk =
      (d.clock ?? spec.clock.base) * lastTherm * clockTrim(spec.kind, input.vrmThrottle, input.ramThrottle) * psuFactor;
    return { w: clockPowerW(spec, clk / spec.clock.base, input.load(d)), clk };
  };
}

export function vrmAtOf(input: {
  cpuDev: boardTypes.InstalledDevice | undefined;
  live: boolean;
  vspec: thermalCoreTypes.VrmSpecOf;
  powerOf: PowerOf;
}): (psuFactor: number) => VrmNow {
  const { cpuDev, live, vspec, powerOf } = input;
  return (psuFactor) => {
    if (!cpuDev || !live) {
      return { ratio: 0, eff: vspec.peakEfficiency, loss: 0 };
    }
    const cs = deviceSpec(cpuDev);
    if (cs.clock === undefined) {
      return { ratio: 0, eff: vspec.peakEfficiency, loss: 0 };
    }
    const p = powerOf(cpuDev, psuFactor);
    const ratio = loadRatio(vspec, currentDemand(p.w, p.clk / cs.clock.base));
    const eff = efficiency(vspec, ratio);
    return { ratio, eff, loss: lossW(p.w, eff) };
  };
}

export function ramAtOf(input: {
  ramDevs: boardTypes.InstalledDevice[];
  live: boolean;
  rspec: thermalCoreTypes.VrmSpecOf;
  powerOf: PowerOf;
}): (psuFactor: number) => VrmNow {
  const { ramDevs, live, rspec, powerOf } = input;
  return (psuFactor) => {
    if (ramDevs.length === 0 || !live) {
      return { ratio: 0, eff: rspec.peakEfficiency, loss: 0 };
    }
    let w = 0,
      r = 0;
    for (const d of ramDevs) {
      const { w: watts, clk } = powerOf(d, psuFactor);
      const { clock } = deviceSpec(d);
      if (clock === undefined) {
        throw new Error(`RAM ${d.id} has no clock`);
      }
      const { base } = clock;
      w += watts;
      r += clk / base;
    }
    const ratio = loadRatio(rspec, ramDemand(w, r / ramDevs.length));
    const eff = efficiency(rspec, ratio);
    return { ratio, eff, loss: lossW(w, eff) };
  };
}

export function psuDraw(input: {
  live: boolean;
  tripped: boolean;
  board: boardTypes.Board;
  budget: number;
  vrmAt: (f: number) => VrmNow;
  ramAt: (f: number) => VrmNow;
  powerOf: PowerOf;
}): { psuFactor: number; nowTripped: boolean; effLive: boolean; vrmNow: VrmNow; ramNow: VrmNow; drawn: number } {
  let total = input.vrmAt(1).loss + input.ramAt(1).loss;
  for (const d of input.board.devices) {
    total += input.powerOf(d, 1).w;
  }
  let psuFactor = 1;
  let nowTripped = input.tripped;
  if (input.live && total > input.budget) {
    psuFactor = input.budget / total;
    if (total > input.budget * TRIP_RATIO) {
      nowTripped = true;
    }
  }
  const effLive = input.live && !nowTripped;
  const vrmNow = input.vrmAt(effLive ? psuFactor : 1);
  const ramNow = input.ramAt(effLive ? psuFactor : 1);
  return {
    psuFactor,
    nowTripped,
    effLive,
    vrmNow,
    ramNow,
    drawn: effLive ? vrmNow.loss + ramNow.loss : 0,
  };
}

export function cardDrawW(input: {
  board: boardTypes.Board;
  effLive: boolean;
  psuFactor: number;
  powerOf: PowerOf;
}): number {
  if (!input.effLive) {
    return 0;
  }
  let cardW = 0;
  for (const d of input.board.devices) {
    if (isCard(deviceSpec(d).kind) && d.burnt !== true) {
      cardW += input.powerOf(d, input.psuFactor).w;
    }
  }
  return cardW;
}
