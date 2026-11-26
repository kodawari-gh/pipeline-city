// One tick of the thermal model. Called from ThermalModel.step.
import { deviceSpec, findDevices, fittedRadiator, installedPsu } from './board';
import type * as boardTypes from './board';
import { AMBIENT_C, BOARD_TIERS } from './specs';
import { CASE_FAN_K, LOOP_BLOCK_K, parseStepOpts } from './thermalCore';
import type * as thermalCoreTypes from './thermalCore';
import {
  cardDrawW,
  kindLoad,
  lastTickTherm,
  makePowerOf,
  pruneDevices,
  psuDraw,
  ramAtOf,
  throttleOf,
  vrmAtOf,
} from './thermalStepSupport';
import type * as thermalStepSupportTypes from './thermalStepSupport';
import { caseAir, coolerCoeff, stepCoolant, stepDeviceTemps, stepVrm } from './thermalHeat';

/**
 * Advance one base tick. `opts` is either a `Loads` map (the old second argument) or a `ThermalStepOpts` object.
 */
export function runThermalStep(
  model: thermalStepSupportTypes.ThermalRuntime,
  board: boardTypes.Board,
  opts: thermalCoreTypes.Loads | thermalCoreTypes.ThermalStepOpts = {},
): void {
  applyThermalHeat(gatherThermal(model, board, opts));
}

function boardVrmSpecs(tier: number): {
  vspec: (typeof BOARD_TIERS)[number]['vrm'];
  rspec: (typeof BOARD_TIERS)[number]['ramVrm'];
} {
  const boardSpec = BOARD_TIERS[tier];
  if (boardSpec === undefined) {
    throw new Error(`unknown board tier ${tier}`);
  }
  return { vspec: boardSpec.vrm, rspec: boardSpec.ramVrm };
}

function gatherThermal(
  model: thermalStepSupportTypes.ThermalRuntime,
  board: boardTypes.Board,
  opts: thermalCoreTypes.Loads | thermalCoreTypes.ThermalStepOpts,
) {
  const { loads, powered, fans } = parseStepOpts(opts);
  const psu = installedPsu(board);
  const { tripped } = model.power;
  const live = powered && psu !== null && psu.dev.burnt !== true && !tripped && board.burnt !== true;
  const { vspec, rspec } = boardVrmSpecs(board.tier);
  const load = kindLoad(loads);
  const cpuLoad = Math.max(0, ...findDevices(board, 'cpu').map((d) => load(d)));
  const therm = lastTickTherm(model, board);
  const vrmThrottle = throttleOf(model.vrm, vspec);
  const ramThrottle = throttleOf(model.ramVrm, rspec);
  pruneDevices(model, board);
  const powerOf = makePowerOf({ board, live, fans, load, cpuLoad, therm, vrmThrottle, ramThrottle });
  const vrmAt = vrmAtOf({ cpuDev: findDevices(board, 'cpu').find((d) => d.burnt !== true), live, vspec, powerOf });
  const ramAt = ramAtOf({ ramDevs: findDevices(board, 'ram').filter((d) => d.burnt !== true), live, rspec, powerOf });
  const budget = psu && psu.dev.burnt !== true ? psu.spec.watts : 0;
  const drawn = psuDraw({ live, tripped, board, budget, vrmAt, ramAt, powerOf });
  const radFit = fittedRadiator(board);
  const radSide = fans.radSide ?? radFit?.side ?? null;
  const airW =
    cardDrawW({ board, effLive: drawn.effLive, psuFactor: drawn.psuFactor, powerOf }) +
    (radSide === 'front' ? model.loopRejectW : 0);
  const { air, caseRiseC, airOf } = caseAir({ board, fans, airW, effLive: drawn.effLive });
  model.air = air;
  model.caseRiseC = caseRiseC;
  return {
    model,
    board,
    fans,
    vspec,
    rspec,
    therm,
    vrmThrottle,
    ramThrottle,
    powerOf,
    budget,
    drawn,
    radFit,
    radSide,
    air,
    airOf,
  };
}

function applyThermalHeat(ctx: ReturnType<typeof gatherThermal>): void {
  const { model, board, fans, therm, powerOf, budget, drawn, radFit, radSide, air, airOf } = ctx;
  const cooler = findDevices(board, 'cooler').find((d) => d.burnt !== true);
  const coolerKind = cooler === undefined ? undefined : deviceSpec(cooler);
  const coolerSpec = coolerKind !== undefined && coolerKind.kind === 'cooler' ? coolerKind : null;
  const { coolerK, cpuAir, loop, loopK } = coolerCoeff({ cooler, coolerSpec, fans, effLive: drawn.effLive, board });
  const pumping = loop !== undefined && drawn.effLive && fans.cpu;
  const blockK = pumping ? LOOP_BLOCK_K : 0;
  const radK = pumping ? loopK : 0;
  const airInC = AMBIENT_C + (radSide === 'top' ? air.north.riseC : 0);
  const rejectW = loop ? Math.max(0, loop.pumpPerC * (model.loopC - AMBIENT_C) + radK * (model.loopC - airInC)) : 0;
  const { cpus, partsW } = stepDeviceTemps({
    board,
    model,
    effLive: drawn.effLive,
    psuFactor: drawn.psuFactor,
    powerOf,
    airOf,
    air,
    coolerK,
    therm,
  });
  // the coolant: what the block brought in less what the radiator gave away
  stepCoolant({ model, loop, pumping, blockK, rejectW, cpus, radFit, radSide });
  applyVrmPair(ctx, cpuAir);
  model.power = {
    totalW: drawn.drawn + partsW,
    vrmLossW: drawn.effLive ? drawn.vrmNow.loss + drawn.ramNow.loss : 0,
    budgetW: budget,
    psuFactor: drawn.psuFactor,
    off: !drawn.effLive,
    tripped: drawn.nowTripped,
  };
}

function applyVrmPair(ctx: ReturnType<typeof gatherThermal>, cpuAir: number): void {
  const { model, board, fans, vspec, rspec, vrmThrottle, ramThrottle, drawn, air } = ctx;
  const north = { k: drawn.effLive ? air.north.fans * CASE_FAN_K : 0, rise: air.north.riseC };
  stepVrm({
    board,
    v: model.vrm,
    vspec,
    now: drawn.vrmNow,
    throttle: vrmThrottle,
    live: drawn.effLive,
    sinkKind: 'vrm-sink',
    caseRiseC: north.rise,
    sinkFanOn: fans.vrm,
    cpuAir,
    caseAirK: north.k,
  });
  stepVrm({
    board,
    v: model.ramVrm,
    vspec: rspec,
    now: drawn.ramNow,
    throttle: ramThrottle,
    live: drawn.effLive,
    sinkKind: 'ram-sink',
    caseRiseC: north.rise,
    sinkFanOn: fans.ram,
    cpuAir,
    caseAirK: north.k,
  });
}
