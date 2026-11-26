// Case air, device temperatures, the liquid loop and both regulators: one thermal tick.
import { deviceSpec, fanAir, fansOn, findDevices, fittedRadiator, hostSpots } from './board';
import type * as boardTypes from './board';
import { AMBIENT_C, DAMAGE_TICKS, fanShare } from './specs';
import type * as specsTypes from './specs';
import { AIR_ZONES, cageShade, zoneAir, zoneOf } from './airflow';
import type * as airflowTypes from './airflow';
import { errorProb, VRM_BURN_RATIO, VRM_HOT_STRESS, VRM_OVERLOAD } from './vrm';
import {
  CARD_FAN_AIR_MIN,
  CASE_FAN_K,
  CASE_HEAT_C_PER_W,
  LOOP_FLOW_CP,
  LOOP_FLOW_EASE,
  LOOP_MASS,
  LOOP_MAX_RISE_C,
  LOOP_SUBSTEPS,
  cardFan,
  isCard,
} from './thermalCore';
import type * as thermalCoreTypes from './thermalCore';
import { ensure } from './thermalStepSupport';
import type * as thermalStepSupportTypes from './thermalStepSupport';

function bayDrives(board: boardTypes.Board): airflowTypes.BayDrive[] {
  return board.devices.flatMap((d): airflowTypes.BayDrive[] => {
    const m = /^sata(?<bay>\d+)$/u.exec(d.slot),
      s = deviceSpec(d);
    return m && s.kind === 'storage' ? [{ bay: Number(m.groups?.['bay']), hdd: s.visual !== 'ssd-sata' }] : [];
  });
}

export function caseAir(input: {
  board: boardTypes.Board;
  fans: thermalCoreTypes.FanPower;
  airW: number;
  effLive: boolean;
}): {
  air: Record<airflowTypes.AirZoneId, airflowTypes.ZoneAir>;
  caseRiseC: number;
  airOf: (kind: specsTypes.DeviceKind) => { k: number; rise: number };
} {
  const air = zoneAir({
    tier: input.board.caseTier,
    turning: input.fans.mounts,
    caseFans: input.fans.caseFans,
    cardW: input.airW,
    heatPerW: CASE_HEAT_C_PER_W,
    flowOf: input.fans.mountFlow,
    shade: cageShade(input.board.caseTier, bayDrives(input.board)),
  });
  const caseRiseC = input.fans.mounts ? (air.north.riseC + air.bay.riseC) / 2 : CASE_HEAT_C_PER_W * input.airW;
  const meanFans = AIR_ZONES.reduce((a, z) => a + air[z].fans, 0) / AIR_ZONES.length;
  const airOf = (kind: specsTypes.DeviceKind) => {
    const z = zoneOf(kind);
    return { k: input.effLive ? (z ? air[z].fans : meanFans) * CASE_FAN_K : 0, rise: z ? air[z].riseC : caseRiseC };
  };
  return { air, caseRiseC, airOf };
}

function radiatorCooling(rad: ReturnType<typeof fittedRadiator>): number {
  if (rad === null || rad.dev.burnt === true) {
    return 0;
  }
  const spec = deviceSpec(rad.dev);
  return spec.kind === 'radiator' ? spec.coolingPerC : 0;
}

export function coolerCoeff(input: {
  cooler: boardTypes.InstalledDevice | undefined;
  coolerSpec: specsTypes.CoolerSpec | null;
  fans: thermalCoreTypes.FanPower;
  effLive: boolean;
  board: boardTypes.Board;
}): { coolerK: number; cpuAir: number; loop: specsTypes.CoolerSpec['loop']; loopK: number } {
  const { cooler, coolerSpec, fans, effLive, board } = input;
  const rad = coolerSpec?.loop && fans.loopK === undefined ? fittedRadiator(board) : null;
  const loopK = fans.loopK ?? radiatorCooling(rad);
  const cpuAir = cooler && fans.cpu ? fanAir(fansOn(board, cooler.slot)) : 0;
  const loop = coolerSpec?.loop;
  const coolerBase = loop ? 0 : (coolerSpec?.coolingPerC ?? 0);
  let coolerK = 0;
  if (effLive && coolerSpec?.fanSpots) {
    coolerK = coolerBase * fanShare(coolerSpec.fanSpots.bare, cpuAir);
  } else if (effLive && fans.cpu) {
    coolerK = coolerBase;
  }
  return { coolerK, cpuAir, loop, loopK };
}

export function stepDeviceTemps(input: {
  board: boardTypes.Board;
  model: thermalStepSupportTypes.ThermalRuntime;
  effLive: boolean;
  psuFactor: number;
  powerOf: thermalStepSupportTypes.PowerOf;
  airOf: (kind: specsTypes.DeviceKind) => { k: number; rise: number };
  air: Record<airflowTypes.AirZoneId, airflowTypes.ZoneAir>;
  coolerK: number;
  therm: Map<string, number>;
}): { cpus: { st: thermalCoreTypes.DeviceThermal; mass: number }[]; partsW: number } {
  const cpus: { st: thermalCoreTypes.DeviceThermal; mass: number }[] = [];
  let partsW = 0;
  for (const d of input.board.devices) {
    const spec = deviceSpec(d);
    const st = ensure(input.model.devices, d);
    const p = input.effLive ? input.powerOf(d, input.psuFactor) : { w: 0, clk: 0 };
    partsW += p.w;
    const heat = p.w * spec.heatFactor;
    const around = input.airOf(spec.kind);
    st.fan =
      input.effLive && d.burnt !== true && (spec.thermal.fanPerC ?? 0) > 0
        ? cardFan(st.tempC, spec.thermal.throttleC)
        : 0;
    const cardAir = isCard(spec.kind) ? CARD_FAN_AIR_MIN + (1 - CARD_FAN_AIR_MIN) * input.air.cards.flow : 1;
    const k =
      spec.thermal.passive +
      around.k +
      (spec.kind === 'cpu' ? input.coolerK : 0) +
      st.fan * (spec.thermal.fanPerC ?? 0) * cardAir;
    st.powerW = p.w;
    st.heatW = heat;
    if (spec.kind === 'cpu') {
      cpus.push({ st, mass: spec.thermal.mass });
    }
    st.tempC += (heat - k * (st.tempC - (AMBIENT_C + (isCard(spec.kind) ? 0 : around.rise)))) / spec.thermal.mass;
    st.effClock = p.clk;
    finishDeviceTemp({ st, d, spec, therm: input.therm });
  }
  return { cpus, partsW };
}

function finishDeviceTemp(input: {
  st: thermalCoreTypes.DeviceThermal;
  d: boardTypes.InstalledDevice;
  spec: specsTypes.DeviceSpec;
  therm: Map<string, number>;
}): void {
  const { st, d, spec } = input;
  const lastTherm = input.therm.get(d.id);
  if (lastTherm === undefined) {
    throw new Error(`no thermal state for ${d.id}`);
  }
  st.throttle = lastTherm;
  st.unstable = d.burnt !== true && st.tempC > spec.thermal.unstableC;
  st.errProb = st.unstable ? Math.min(0.5, 0.01 + 0.02 * (st.tempC - spec.thermal.unstableC)) : 0;
  if (st.tempC > spec.thermal.damageC) {
    st.stress++;
  } else {
    st.stress = Math.max(0, st.stress - 1);
  }
  if (st.stress >= DAMAGE_TICKS && d.burnt !== true) {
    d.burnt = true;
  }
}

export function stepCoolant(input: {
  model: thermalStepSupportTypes.ThermalRuntime;
  loop: specsTypes.CoolerSpec['loop'];
  pumping: boolean;
  blockK: number;
  rejectW: number;
  cpus: { st: thermalCoreTypes.DeviceThermal; mass: number }[];
  radFit: ReturnType<typeof fittedRadiator>;
  radSide: 'front' | 'top' | null;
}): void {
  const { model, loop } = input;
  let blockW = 0;
  if (loop) {
    for (let sub = 0; sub < LOOP_SUBSTEPS; sub++) {
      for (const c of input.cpus) {
        const q = (input.blockK * (c.st.tempC - model.loopC)) / LOOP_SUBSTEPS;
        c.st.tempC -= q / c.mass;
        model.loopC += q / LOOP_MASS;
        blockW += q;
      }
    }
    model.loopC -= input.rejectW / LOOP_MASS;
  } else {
    model.loopC = AMBIENT_C;
  }
  model.loopFlow = loop ? model.loopFlow + ((input.pumping ? 1 : 0) - model.loopFlow) * LOOP_FLOW_EASE : 0;
  const carried = Math.max(0, blockW),
    rise = model.loopFlow > 0.05 ? Math.min(LOOP_MAX_RISE_C, carried / (LOOP_FLOW_CP * model.loopFlow)) : 0;
  model.loopHotC = loop ? model.loopC + rise / 2 : AMBIENT_C;
  model.loopColdC = loop ? model.loopC - rise / 2 : AMBIENT_C;
  model.loopRejectW = input.rejectW;
  model.loopSide = loop && input.radFit ? input.radSide : null;
}

export function stepVrm(input: {
  board: boardTypes.Board;
  v: thermalCoreTypes.VrmThermal;
  vspec: thermalCoreTypes.VrmSpecOf;
  now: thermalStepSupportTypes.VrmNow;
  throttle: number;
  live: boolean;
  sinkKind: 'vrm-sink' | 'ram-sink';
  caseRiseC: number;
  sinkFanOn: boolean;
  cpuAir: number;
  caseAirK: number;
}): void {
  const { board, v, vspec, now } = input;
  const sink = input.live ? findDevices(board, input.sinkKind).find((d) => d.burnt !== true) : undefined;
  const cooler = input.live ? findDevices(board, 'cooler').find((d) => d.burnt !== true) : undefined;
  const sinkKindSpec = sink === undefined ? undefined : deviceSpec(sink);
  const sinkSpec =
    sinkKindSpec !== undefined && (sinkKindSpec.kind === 'vrm-sink' || sinkKindSpec.kind === 'ram-sink')
      ? sinkKindSpec
      : undefined;
  const spots = sink === undefined ? null : hostSpots(sink);
  const sinkAir = spots
    ? fanShare(spots.bare, input.sinkFanOn && sink !== undefined ? fanAir(fansOn(board, sink.slot)) : 0)
    : 1;
  const sinkK = sinkSpec === undefined ? 0 : sinkSpec.coolingPerC * sinkAir;
  const coolerKind = cooler === undefined ? undefined : deviceSpec(cooler);
  const coolerSpec = coolerKind !== undefined && coolerKind.kind === 'cooler' ? coolerKind : undefined;
  const airK = coolerSpec === undefined ? 0 : coolerSpec.vrmAirPerC * Math.min(1, input.cpuAir);
  v.heatW = now.loss;
  v.tempC +=
    (now.loss - (vspec.passive + sinkK + airK + input.caseAirK) * (v.tempC - AMBIENT_C - input.caseRiseC)) / vspec.mass;
  v.loadRatio = now.ratio;
  v.efficiency = now.eff;
  v.throttle = input.throttle;
  applyVrmStress({ v, vspec, now, live: input.live, board });
}

function applyVrmStress(input: {
  v: thermalCoreTypes.VrmThermal;
  vspec: thermalCoreTypes.VrmSpecOf;
  now: thermalStepSupportTypes.VrmNow;
  live: boolean;
  board: boardTypes.Board;
}): void {
  const { v, vspec, now, board } = input;
  v.unstable = board.burnt !== true && input.live && (now.ratio > VRM_OVERLOAD || v.tempC > vspec.unstableC);
  v.errProb = v.unstable ? errorProb(vspec, now.ratio, v.tempC) : 0;
  // Burn-out stress: fast when far over the limits, slow when overloaded AND hot (so cooling the VRM saves it), else it recovers.
  if (v.tempC > vspec.damageC || now.ratio > VRM_BURN_RATIO) {
    v.stress++;
  } else if (v.unstable && v.tempC > vspec.throttleC) {
    v.stress += VRM_HOT_STRESS;
  } else {
    v.stress = Math.max(0, v.stress - 1);
  }
  if (v.stress >= DAMAGE_TICKS && board.burnt !== true) {
    board.burnt = true;
  }
}
