// The spec sheet of a built PC (Build my PC, docs/PC_PARTS.md): what it costs and what it draws. Pure: it reads the part list and the spec tables.
import { BOARD_TIERS, CASE_TIERS, getSpec } from './specs';

/** A ready-made build (see `BuildStage.buildPreset`): `level` 0..1 picks how high a tier of each part; the counts say how many of each to fit. */
export interface BuildPreset {
  name: string;
  level: number;
  ram: number;
  storage: number;
  gpus: number;
  npus: number;
}
/** The ready-made machines. Each lists what its case holds, no more: the row says it and the picture shows it (`buildpreset.test.ts` builds each and counts). */
export const BUILD_PRESETS: BuildPreset[] = [
  { name: 'Budget', level: 0.3, ram: 1, storage: 1, gpus: 0, npus: 0 },
  { name: 'Gaming', level: 0.65, ram: 2, storage: 1, gpus: 1, npus: 0 },
  { name: 'Workstation', level: 1, ram: 8, storage: 3, gpus: 1, npus: 1 },
];

/** A machine as saved: its case and board tier and each fitted part's spec and socket. */
export interface BuildLayout {
  caseTier: number;
  boardTier: number;
  parts: { spec: string; slot: string }[];
  os?: number;
  router?: number;
  isp?: number;
}
/** A saved build: its name, its layout and (when the stage could take one) a picture of the machine as a data URL. */
export interface SavedBuild {
  name: string;
  layout: BuildLayout;
  thumb?: string;
}

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

/**
 * What stands on Build my PC's stage: the machine (a case with its board), a bare case with no board in it, or nothing at all. The empty start is nothing:
 * the player brings a case in from the shelf, then a board, then the parts. The sim game always holds a case and a board; the stage holds them aside.
 */
export type Shown = 'machine' | 'case' | 'nothing';

/**
 * The sheet of a machine: its board and case tier and its fitted part specs (a part with no spec is skipped). `shown`: a bare case counts its case and no board;
 * with nothing on the stage there is no case to count either. `drawW`: the full-load draw the machine itself works out (`fullDrawW`: it counts what the
 * regulators waste, which the parts' own watts do not); the sheet sums the parts' watts when it is not given.
 */
export function specSheet(m: {
  boardTier: number;
  caseTier: number;
  specs: readonly string[];
  shown?: Shown;
  drawW?: number | undefined;
}): SpecSheet {
  const shown = m.shown ?? 'machine';
  let budget = shown === 'machine' ? (BOARD_TIERS[m.boardTier]?.price ?? 0) : 0,
    idleW = 0,
    loadW = 0,
    psuW = 0,
    parts = shown === 'machine' ? 1 : 0;
  if (shown !== 'nothing') {
    budget += CASE_TIERS[m.caseTier]?.price ?? 0;
    parts += 1;
  }
  for (const id of m.specs) {
    const s = getSpec(id);
    if (!s) {
      continue;
    }
    parts++;
    budget += s.price;
    idleW += s.idleW;
    loadW += s.loadW;
    if (s.kind === 'psu') {
      psuW = Math.max(psuW, s.watts);
    }
  }
  if (m.drawW !== undefined) {
    loadW = m.drawW;
  }
  return {
    parts,
    budget,
    idleW: Math.round(idleW),
    loadW: Math.round(loadW),
    psuW,
    headroom: psuW > 0 ? loadW / psuW : null,
  };
}
