// The machine's stress (ticket #62): one pure amount, 0..1, read from a snapshot. The music's stress layer follows it (music.ts);
// the ?debug cue board shows each term (cueBoard.ts). Pure TS (no Web Audio, no DOM).
// Terms: the worst device throttle, the board VRM's temperature between its throttle and damage temperatures, the VRM load
// ratio, and the power ratio (totalW over budgetW). Each raw term is 0 at its threshold and grows past it; a term reaches 1 at
// `STRESS_SCALE` past its threshold (music-spec.json `stress.amount`, `/scale`). The amount is the largest term.

/** A raw term reaches 1 this far past its threshold. */
export const STRESS_SCALE = 0.2;
/** The power ratio where the power term starts (music-spec.json: totalW / budgetW - 0.9). */
const POWER_THRESHOLD = 0.9;

/** The parts of a snapshot the stress reads. Every field may be missing: a missing term is 0. */
interface StressVrm {
  loadRatio?: number;
  tempC?: number;
  throttleC?: number;
  damageC?: number;
}

export interface StressSnap {
  devices?: readonly { throttle?: number | undefined }[] | null | undefined;
  /** The board's VRM, at top level. A snapshot that carries it only under `board` (the game's shape) is read there too. */
  vrm?: StressVrm | null | undefined;
  board?: { vrm?: StressVrm | null | undefined } | null | undefined;
  power?: { totalW?: number; budgetW?: number } | null;
}

/** Each term, scaled to 0..1, and the amount (the largest term). */
export interface StressTerms {
  throttle: number;
  temp: number;
  vrm: number;
  power: number;
  amount: number;
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const scaled = (raw: number): number => Math.min(1, Math.max(0, raw / STRESS_SCALE));

/** The four terms of a snapshot, each 0..1 (`amount` is their max). */
export function stressTerms(s: StressSnap): StressTerms {
  let worst = 1;
  for (const d of s.devices ?? []) {
    if (finite(d.throttle)) {
      worst = Math.min(worst, d.throttle);
    }
  }
  const throttle = scaled(1 - worst);

  const v = s.vrm ?? s.board?.vrm ?? null;
  let temp = 0;
  let vrm = 0;
  if (v) {
    if (finite(v.tempC) && finite(v.throttleC) && finite(v.damageC) && v.damageC > v.throttleC) {
      temp = scaled((v.tempC - v.throttleC) / (v.damageC - v.throttleC));
    }
    if (finite(v.loadRatio)) {
      vrm = scaled(v.loadRatio - 1);
    }
  }

  const p = s.power ?? null;
  const power =
    p && finite(p.totalW) && finite(p.budgetW) && p.budgetW > 0 ? scaled(p.totalW / p.budgetW - POWER_THRESHOLD) : 0;

  return { throttle, temp, vrm, power, amount: Math.max(throttle, temp, vrm, power) };
}

/** The stress amount, 0..1: the largest of the terms. */
export function stressAmount(s: StressSnap): number {
  return stressTerms(s).amount;
}
