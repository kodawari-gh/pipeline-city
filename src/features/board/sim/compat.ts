// Compatibility checks: does this build work together? Pure and static (no ticks): they read the board as it is and say what will go wrong.
// Two users: tests (a rig that overloads its own parts fails with a clear message, not a timeout) and, later, the player (warnings and tips in the UI:
// every issue has an id, a severity, the part it is about and a plain message). `install` still refuses what cannot be fitted at all; these are for what fits but runs badly.
// Build my PC (`Game.looseFit`) also fits a part the power rules would refuse (a supply too small, a card with no lead): Build my PC's panel shows these issues (`buildAlerts`).
//   error  it breaks: a part burns, a part has no power, the supply trips, the machine cannot run
//   warn   it runs badly: crashes, throttling, heat
//   tip    it works, but there is something better to do

import { AMBIENT_C, basicFan, BOARD_TIERS, CASE_TIERS, fanShare } from './specs';
import type { CoolerSpec, CpuSpec, RadiatorSpec, RamSpec } from './specs';
import * as B from './board';
import { clockPowerW, UNFANNED_SHARE } from './thermal';
import { coolerTipIssues, psuIssues } from './compatTips';
import { SMT_LOAD_SHARE } from '@/core/sim/memmap';
import { currentDemand, efficiency, lossW, loadRatio, ramDemand, VRM_BURN_RATIO, VRM_OVERLOAD } from './vrm';

import type { CompatIssue, CompatSeverity } from './compatTypes';

export type { CompatIssue } from './compatTypes';

const fmt = (n: number, d = 2) => n.toFixed(d);

/** The load a CPU draws with every thread busy: 1 for one thread per core, a little more with SMT (the machine's `busyCores` counts the same way). */
export const cpuFullLoad = (spec: CpuSpec): number => 1 + SMT_LOAD_SHARE * ((spec.threads ?? 1) - 1);

/** A CPU's current demand over the rating of a board tier's VRM at a clock ratio `r` (1 is its base clock), every thread busy and the chip cool. */
export function vrmRatioOf(boardTier: number, spec: CpuSpec, r = 1): number {
  const power = clockPowerW(spec, r, cpuFullLoad(spec));
  const demand = currentDemand(power, r);
  return loadRatio(BOARD_TIERS[boardTier]!.vrm, demand);
}

/** The CPU's current demand over its VRM's rating at a clock, every thread busy and the chip cool (what the VRM sees at the worst moment of a job). */
export function cpuVrmRatio(board: B.Board, cpuId: string, clock?: number): number {
  const d = board.devices.find((x) => x.id === cpuId);
  if (!d) {
    return 0;
  }
  const spec = B.deviceSpec(d) as CpuSpec;
  return vrmRatioOf(board.tier, spec, (clock ?? d.clock ?? spec.clock.base) / spec.clock.base);
}

/** The memory regulator's load for every stick at its clock, flat out. */
function ramVrmRatio(board: B.Board): number {
  const sticks = B.findDevices(board, 'ram').filter((d) => !d.burnt);
  if (sticks.length === 0) {
    return 0;
  }
  let w = 0,
    rs = 0;
  for (const d of sticks) {
    const s = B.deviceSpec(d) as RamSpec,
      r = (d.clock ?? s.clock!.base) / s.clock!.base;
    w += clockPowerW(s, r, 1);
    rs += r;
  }
  return loadRatio(BOARD_TIERS[board.tier]!.ramVrm, ramDemand(w, rs / sticks.length));
}

/**
 * What the machine draws flat out, W: every part at its rated load, the CPU at its clock with every thread busy, and what the two regulators waste on top.
 * It is the sum `ThermalModel.step` holds against the supply (a draw over the rating slows every clock by rating / draw; over `TRIP_RATIO` times it trips).
 */
export function fullDrawW(board: B.Board): number {
  let w = B.ratedLoadW(board);
  const cpu = B.findDevices(board, 'cpu').find((d) => !d.burnt);
  if (cpu) {
    const s = B.deviceSpec(cpu) as CpuSpec,
      r = (cpu.clock ?? s.clock.base) / s.clock.base,
      p = clockPowerW(s, r, cpuFullLoad(s));
    w += p - s.loadW + lossW(p, efficiency(BOARD_TIERS[board.tier]!.vrm, cpuVrmRatio(board, cpu.id)));
  }
  const sticks = B.findDevices(board, 'ram').filter((d) => !d.burnt);
  if (sticks.length > 0) {
    let rw = 0;
    for (const d of sticks) {
      const s = B.deviceSpec(d) as RamSpec;
      rw += clockPowerW(s, (d.clock ?? s.clock!.base) / s.clock!.base, 1);
    }
    w += lossW(rw, efficiency(BOARD_TIERS[board.tier]!.ramVrm, ramVrmRatio(board)));
  }
  return w;
}

/** The highest CPU clock (steps of 0.05) at which the CPU's VRM is not overloaded, or null if even the lowest clock is. */
export function safeCpuClock(board: B.Board, cpuId: string): number | null {
  const d = board.devices.find((x) => x.id === cpuId);
  if (!d) {
    return null;
  }
  const { clock } = B.deviceSpec(d) as CpuSpec;
  for (let c = clock.max; c >= clock.min - 1e-9; c -= 0.05) {
    if (cpuVrmRatio(board, cpuId, c) <= VRM_OVERLOAD) {
      return Math.round(c * 100) / 100;
    }
  }
  return null;
}

/** The temperature a CPU settles at with no case fans, flat out (the cooler and the passive path only): a ceiling the case fans then improve on. */
function cpuSteadyC(board: B.Board, cpuId: string): number | null {
  const d = board.devices.find((x) => x.id === cpuId),
    cooler = B.findDevices(board, 'cooler').find((c) => !c.burnt);
  if (!d || !cooler) {
    return null;
  }
  const s = B.deviceSpec(d) as CpuSpec,
    cs = B.deviceSpec(cooler) as CoolerSpec,
    r = (d.clock ?? s.clock.base) / s.clock.base;
  // the fans fitted on the heatsink, or on the radiator's mounts, all turning
  const rad = B.fittedRadiator(board),
    base = basicFan(CASE_TIERS[board.caseTier]!.fanSize).airflow;
  const radAir = rad ? B.fanAir(rad.mounts.flatMap((m) => B.mountFan(board, m) ?? [])) / (rad.mounts.length * base) : 0;
  const radK = rad
    ? (B.deviceSpec(rad.dev) as RadiatorSpec).coolingPerC *
      (UNFANNED_SHARE + (1 - UNFANNED_SHARE) * Math.min(1, radAir))
    : 0;
  const airK = cs.coolingPerC * (cs.fanSpots ? fanShare(cs.fanSpots.bare, B.fanAir(B.fansOn(board, cooler.slot))) : 1);
  const k = s.thermal.passive + (cs.loop ? cs.loop.pumpPerC + radK : airK);
  return AMBIENT_C + (clockPowerW(s, r, cpuFullLoad(s)) * s.heatFactor) / k;
}

function cpuCompatIssues(board: B.Board): CompatIssue[] {
  const out: CompatIssue[] = [];
  for (const cpu of B.findDevices(board, 'cpu').filter((d) => !d.burnt)) {
    const spec = B.deviceSpec(cpu) as CpuSpec,
      ratio = cpuVrmRatio(board, cpu.id),
      safe = safeCpuClock(board, cpu.id);
    const fix = safe !== null ? { clock: safe } : undefined;
    if (ratio >= VRM_BURN_RATIO) {
      out.push({
        id: 'vrm-burn',
        severity: 'error',
        part: cpu.id,
        value: ratio,
        limit: VRM_BURN_RATIO,
        fix,
        message: `${spec.name} asks the board's voltage regulator for ${fmt(ratio)}x what it can give: it will burn the board out.`,
      });
    } else if (ratio > VRM_OVERLOAD) {
      out.push({
        id: 'vrm-overload',
        severity: 'warn',
        part: cpu.id,
        value: ratio,
        limit: VRM_OVERLOAD,
        fix,
        message: `${spec.name} draws more current than the board's voltage regulator can give (${fmt(ratio)}x): under load the voltage droops and the machine crashes at random. Use a better board${safe !== null ? ` or lower the clock to ${fmt(safe)}` : ''}.`,
      });
    }
    out.push(...cpuTempIssues(board, cpu, spec));
  }
  return out;
}

function cpuTempIssues(board: B.Board, cpu: B.InstalledDevice, spec: CpuSpec): CompatIssue[] {
  const temp = cpuSteadyC(board, cpu.id);
  if (temp === null) {
    return [];
  }
  if (temp > spec.thermal.unstableC) {
    return [
      {
        id: 'cpu-cooling',
        severity: 'error',
        part: cpu.id,
        value: temp,
        limit: spec.thermal.unstableC,
        message: `${spec.name} would settle near ${fmt(temp, 0)} C flat out, past the point where it makes errors (${spec.thermal.unstableC} C). It needs a better cooler.`,
      },
    ];
  }
  if (temp > spec.thermal.throttleC) {
    return [
      {
        id: 'cpu-cooling',
        severity: 'warn',
        part: cpu.id,
        value: temp,
        limit: spec.thermal.throttleC,
        message: `${spec.name} would settle near ${fmt(temp, 0)} C flat out (before the case fans help), past its throttle point of ${spec.thermal.throttleC} C: it will slow down. A better cooler or more case fans cool it.`,
      },
    ];
  }
  return [];
}

function ramVrmIssues(board: B.Board): CompatIssue[] {
  const ramRatio = ramVrmRatio(board);
  if (ramRatio >= VRM_BURN_RATIO) {
    return [
      {
        id: 'ram-vrm-burn',
        severity: 'error',
        part: null,
        value: ramRatio,
        limit: VRM_BURN_RATIO,
        message: `The memory asks its regulator for ${fmt(ramRatio)}x what it can give: it will burn the board out.`,
      },
    ];
  }
  if (ramRatio > VRM_OVERLOAD) {
    return [
      {
        id: 'ram-vrm-overload',
        severity: 'warn',
        part: null,
        value: ramRatio,
        limit: VRM_OVERLOAD,
        message: `The memory draws more current than its regulator can give (${fmt(ramRatio)}x): the machine crashes at random. Use fewer or slower sticks, or a better board.`,
      },
    ];
  }
  return [];
}

/** Every problem and tip for the build as it stands. Errors first, then warnings, then tips. */
export function checkCompat(board: B.Board): CompatIssue[] {
  const rank: Record<CompatSeverity, number> = { error: 0, warn: 1, tip: 2 };
  return [
    ...cpuCompatIssues(board),
    ...ramVrmIssues(board),
    ...psuIssues(board, fullDrawW(board)),
    ...coolerTipIssues(board),
  ].sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** The issues that stop a build from working well (errors and warnings): what a test rig must not have. */
export const compatProblems = (board: B.Board): CompatIssue[] => checkCompat(board).filter((i) => i.severity !== 'tip');
