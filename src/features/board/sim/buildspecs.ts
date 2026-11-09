// The spec sheet of a built PC (Build my PC, docs/PC_PARTS.md): what it costs and what it draws. Pure: it reads the part list and the spec tables.
import { BOARD_TIERS, CASE_TIERS, getSpec } from './specs';

/** A ready-made build (see `BuildStage.buildPreset`): `level` 0..1 picks how high a tier of each part; the counts say how many of each to fit. */
export interface BuildPreset { name: string; level: number; ram: number; storage: number; gpus: number; npus: number }
export const BUILD_PRESETS: BuildPreset[] = [
  { name: 'Budget', level: 0.25, ram: 1, storage: 1, gpus: 0, npus: 0 },
  { name: 'Gaming', level: 0.65, ram: 2, storage: 1, gpus: 1, npus: 0 },
  { name: 'Workstation', level: 1, ram: 8, storage: 4, gpus: 2, npus: 1 },
];

/** A machine as saved: its case and board tier and each fitted part's spec and socket. */
export interface BuildLayout { caseTier: number; boardTier: number; parts: { spec: string; slot: string }[]; os?: number; router?: number; isp?: number }
export interface SavedBuild { name: string; layout: BuildLayout }

export interface SpecSheet {
  /** Parts counted (the case and the board count as one each). */
  parts: number;
  /** Sum of the list prices of the case, the board and every fitted part. */
  budget: number;
  /** Draw with everything idle and with everything at full load, in watts. */
  idleW: number;
  loadW: number;
  /** The supply's rating in watts (0 with no supply). */
  psuW: number;
  /** Full-load draw over the supply's rating: above 1 the supply trips. Null with no supply. */
  headroom: number | null;
}

/** The sheet of a machine: its board and case tier and its fitted part specs (a part with no spec is skipped). */
export function specSheet(m: { boardTier: number; caseTier: number; specs: readonly string[] }): SpecSheet {
  let budget = BOARD_TIERS[m.boardTier]?.price ?? 0, idleW = 0, loadW = 0, psuW = 0, parts = 1;
  budget += CASE_TIERS[m.caseTier]?.price ?? 0;
  parts += 1;
  for (const id of m.specs) {
    const s = getSpec(id);
    if (!s) continue;
    parts++;
    budget += s.price;
    idleW += s.idleW;
    loadW += s.loadW;
    if (s.kind === 'psu') psuW = Math.max(psuW, s.watts);
  }
  idleW = Math.round(idleW);
  loadW = Math.round(loadW);
  return { parts, budget, idleW, loadW, psuW, headroom: psuW > 0 ? loadW / psuW : null };
}
