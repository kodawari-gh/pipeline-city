// Compatibility checks: does this build work together? Pure and static (no ticks): they read the board as it is and say what will go wrong.
// Two users: tests (a rig that overloads its own parts fails with a clear message, not a timeout) and, later, the player (warnings and tips in the UI:
// every issue has an id, a severity, the part it is about and a plain message). `install` still refuses what cannot be fitted at all; these are for what fits but runs badly.
//   error  it breaks: a part burns, a part has no power, the machine cannot run
//   warn   it runs badly: crashes, throttling, heat
//   tip    it works, but there is something better to do

import { AMBIENT_C, BOARD_TIERS } from "./specs";
import type { CoolerSpec, CpuSpec, RadiatorSpec, RamSpec } from "./specs";
import { deviceSpec, findDevices, fittedRadiator, installedPsu, pcieLeadsNeeded, ratedLoadW, type Board } from "./board";
import { clockPowerW } from "./thermal";
import { SMT_LOAD_SHARE } from "@/core/sim/memmap";
import { currentDemand, loadRatio, ramDemand, VRM_BURN_RATIO, VRM_OVERLOAD } from "./vrm";

export type CompatSeverity = "error" | "warn" | "tip";

export interface CompatIssue {
  /** Stable id, for the UI to pick its wording or an icon (`vrm-overload`, `psu-budget`...). */
  id: string;
  severity: CompatSeverity;
  /** The device id the issue is about; null for the board or the machine as a whole. */
  part: string | null;
  /** One plain sentence for the player. */
  message: string;
  /** The number that broke the limit, and the limit (in the unit of the message). */
  value?: number;
  limit?: number;
  /** A change that clears it, when there is one that is only a setting: the CPU clock (in clock units) that is safe. */
  fix?: { clock: number };
}

const fmt = (n: number, d = 2) => n.toFixed(d);

/** The load a CPU draws with every thread busy: 1 for one thread per core, a little more with SMT (the machine's `busyCores` counts the same way). */
export const cpuFullLoad = (spec: CpuSpec): number => 1 + SMT_LOAD_SHARE * ((spec.threads ?? 1) - 1);

/** The CPU's current demand over its VRM's rating at a clock, every thread busy and the chip cool (what the VRM sees at the worst moment of a job). */
export function cpuVrmRatio(board: Board, cpuId: string, clock?: number): number {
  const d = board.devices.find((x) => x.id === cpuId);
  if (!d) return 0;
  const spec = deviceSpec(d) as CpuSpec, r = (clock ?? d.clock ?? spec.clock.base) / spec.clock.base;
  return loadRatio(BOARD_TIERS[board.tier]!.vrm, currentDemand(clockPowerW(spec, r, cpuFullLoad(spec)), r));
}

/** The memory regulator's load for every stick at its clock, flat out. */
export function ramVrmRatio(board: Board): number {
  const sticks = findDevices(board, "ram").filter((d) => !d.burnt);
  if (!sticks.length) return 0;
  let w = 0, rs = 0;
  for (const d of sticks) { const s = deviceSpec(d) as RamSpec, r = (d.clock ?? s.clock!.base) / s.clock!.base; w += clockPowerW(s, r, 1); rs += r; }
  return loadRatio(BOARD_TIERS[board.tier]!.ramVrm, ramDemand(w, rs / sticks.length));
}

/** The highest CPU clock (steps of 0.05) at which the CPU's VRM is not overloaded, or null if even the lowest clock is. */
export function safeCpuClock(board: Board, cpuId: string): number | null {
  const d = board.devices.find((x) => x.id === cpuId);
  if (!d) return null;
  const { clock } = deviceSpec(d) as CpuSpec;
  for (let c = clock.max; c >= clock.min - 1e-9; c -= 0.05) if (cpuVrmRatio(board, cpuId, c) <= VRM_OVERLOAD) return Math.round(c * 100) / 100;
  return null;
}

/** The temperature a CPU settles at with no case fans, flat out (the cooler and the passive path only): a ceiling the case fans then improve on. */
function cpuSteadyC(board: Board, cpuId: string): number | null {
  const d = board.devices.find((x) => x.id === cpuId), cooler = findDevices(board, "cooler").find((c) => !c.burnt);
  if (!d || !cooler) return null;
  const s = deviceSpec(d) as CpuSpec, cs = deviceSpec(cooler) as CoolerSpec, r = (d.clock ?? s.clock.base) / s.clock.base;
  const rad = fittedRadiator(board);
  const k = s.thermal.passive + (cs.loop ? cs.loop.pumpPerC + (rad ? (deviceSpec(rad.dev) as RadiatorSpec).coolingPerC : 0) : cs.coolingPerC);
  return AMBIENT_C + (clockPowerW(s, r, cpuFullLoad(s)) * s.heatFactor) / k;
}

/** Every problem and tip for the build as it stands. Errors first, then warnings, then tips. */
export function checkCompat(board: Board): CompatIssue[] {
  const out: CompatIssue[] = [];
  const add = (i: CompatIssue) => out.push(i);

  for (const cpu of findDevices(board, "cpu").filter((d) => !d.burnt)) {
    const spec = deviceSpec(cpu) as CpuSpec, ratio = cpuVrmRatio(board, cpu.id), safe = safeCpuClock(board, cpu.id);
    const fix = safe !== null ? { clock: safe } : undefined;
    if (ratio >= VRM_BURN_RATIO) {
      add({ id: "vrm-burn", severity: "error", part: cpu.id, value: ratio, limit: VRM_BURN_RATIO, fix, message: `${spec.name} asks the board's voltage regulator for ${fmt(ratio)}x what it can give: it will burn the board out.` });
    } else if (ratio > VRM_OVERLOAD) {
      add({ id: "vrm-overload", severity: "warn", part: cpu.id, value: ratio, limit: VRM_OVERLOAD, fix, message: `${spec.name} draws more current than the board's voltage regulator can give (${fmt(ratio)}x): under load the voltage droops and the machine crashes at random. Use a better board${safe !== null ? ` or lower the clock to ${fmt(safe)}` : ""}.` });
    }
    const t = cpuSteadyC(board, cpu.id);
    if (t !== null && t > spec.thermal.unstableC) add({ id: "cpu-cooling", severity: "error", part: cpu.id, value: t, limit: spec.thermal.unstableC, message: `${spec.name} would settle near ${fmt(t, 0)} C flat out, past the point where it makes errors (${spec.thermal.unstableC} C). It needs a better cooler.` });
    else if (t !== null && t > spec.thermal.throttleC) add({ id: "cpu-cooling", severity: "warn", part: cpu.id, value: t, limit: spec.thermal.throttleC, message: `${spec.name} would settle near ${fmt(t, 0)} C flat out (before the case fans help), past its throttle point of ${spec.thermal.throttleC} C: it will slow down. A better cooler or more case fans cool it.` });
  }

  const ramRatio = ramVrmRatio(board);
  if (ramRatio >= VRM_BURN_RATIO) add({ id: "ram-vrm-burn", severity: "error", part: null, value: ramRatio, limit: VRM_BURN_RATIO, message: `The memory asks its regulator for ${fmt(ramRatio)}x what it can give: it will burn the board out.` });
  else if (ramRatio > VRM_OVERLOAD) add({ id: "ram-vrm-overload", severity: "warn", part: null, value: ramRatio, limit: VRM_OVERLOAD, message: `The memory draws more current than its regulator can give (${fmt(ramRatio)}x): the machine crashes at random. Use fewer or slower sticks, or a better board.` });

  const psu = installedPsu(board);
  if (!psu) add({ id: "psu-missing", severity: "error", part: null, message: "There is no power supply: the machine cannot start." });
  else {
    const need = ratedLoadW(board);
    if (need > psu.spec.watts) add({ id: "psu-budget", severity: "error", part: psu.dev.id, value: need, limit: psu.spec.watts, message: `The parts need ${fmt(need, 0)} W but the power supply gives ${psu.spec.watts} W: it will trip.` });
    else if (need > psu.spec.watts * 0.9) add({ id: "psu-headroom", severity: "tip", part: psu.dev.id, value: need, limit: psu.spec.watts, message: `The parts use ${fmt((need / psu.spec.watts) * 100, 0)}% of the power supply: an overclock or a hot part can push it over.` });
    const leads = pcieLeadsNeeded(board);
    if (leads > psu.spec.pcieLeads) add({ id: "pcie-leads", severity: "error", part: psu.dev.id, value: leads, limit: psu.spec.pcieLeads, message: `The cards need ${leads} PCIe power lead${leads === 1 ? "" : "s"} but the power supply has ${psu.spec.pcieLeads}.` });
  }

  const cooler = findDevices(board, "cooler").find((d) => !d.burnt), rad = fittedRadiator(board);
  if (cooler && (deviceSpec(cooler) as CoolerSpec).loop && !rad) add({ id: "loop-no-radiator", severity: "tip", part: cooler.id, message: "The liquid loop has no radiator: the pump alone gives it little cooling. Fit a radiator on the front or the top of the case." });
  if (rad && rad.side === "front" && findDevices(board, "cpu").some((d) => (deviceSpec(d) as CpuSpec).loadW >= 60)) add({ id: "radiator-front-heat", severity: "tip", part: rad.dev.id, message: "A radiator on the front puts the CPU's heat into the case air, which warms the other parts. On the top it blows the heat out of the case." });

  const rank: Record<CompatSeverity, number> = { error: 0, warn: 1, tip: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/** The issues that stop a build from working well (errors and warnings): what a test rig must not have. */
export const compatProblems = (board: Board): CompatIssue[] => checkCompat(board).filter((i) => i.severity !== "tip");
