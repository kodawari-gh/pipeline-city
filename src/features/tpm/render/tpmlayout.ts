import { specsOfKind } from '../../board/sim/specs';
import { TPM_KEYS_SHOWN } from '../sim/tpm';
import { tpmPlanInput, type TpmBlock, type TpmPlan } from './tpmplan';
import { TPM_DIE, tpmPlan } from './tpmplans';
import type { Rect } from '../../board/render/layout/layout';

// The secure module on its header (docs/ACCEL.md "TPM"), in board space. The daughterboard stands on the header; its die lies under a lid and fills
// the band between the module's name and its pins. The die's own plan (`tpm/tpmplans.ts`) is drawn in die units and scaled into the band. Like
// `gpulayout` for the cards: the tooltip test enumerates the hover ids from here, so a part cannot be drawn without a description.

/** How far the daughterboard reaches round the header's pins: the board's margin, and the room above for the module's name. */
const PAD = 16, NAME = 30;

export interface TpmGeo {
  /** The daughterboard (what a click on the module hits). */
  pcb: Rect;
  /** The band the die and its lid fill, and the die inside it (die units scale to board units by `scale`). */
  band: Rect;
  die: Rect;
  scale: number;
  /** The module's plan. */
  plan: TpmPlan;
}

/** The module's plan from its spec's `visual` key (`tpm-1`, `tpm-2`). */
export function tpmPlanOf(visual: string): TpmPlan {
  const s = specsOfKind('tpm').find((x) => x.visual === visual);
  return tpmPlan(s?.tpm ? tpmPlanInput(s.tpm, TPM_KEYS_SHOWN) : { hashStages: 4, quoteRounds: 3, keys: TPM_KEYS_SHOWN });
}

const cache = new Map<string, TpmGeo>();

/** The geometry of a module standing on the header whose rectangle is `hdr` (board space). */
export function tpmGeo(visual: string, hdr: Rect): TpmGeo {
  const key = `${visual}|${hdr.x}|${hdr.y}|${hdr.w}|${hdr.h}`, hit = cache.get(key);
  if (hit) return hit;
  const pcb = { x: hdr.x - PAD, y: hdr.y - PAD - NAME, w: hdr.w + 2 * PAD, h: hdr.h + 2 * PAD + NAME };
  const band = { x: pcb.x + 10, y: pcb.y + NAME - 2, w: pcb.w - 20, h: hdr.y + hdr.h - 24 - (pcb.y + NAME - 2) };
  const scale = Math.min(band.w / TPM_DIE.w, band.h / TPM_DIE.h), w = TPM_DIE.w * scale, h = TPM_DIE.h * scale;
  const geo: TpmGeo = { pcb, band, die: { x: band.x + (band.w - w) / 2, y: band.y + (band.h - h) / 2, w, h }, scale, plan: tpmPlanOf(visual) };
  cache.set(key, geo);
  return geo;
}

/** A block's rectangle in board space. */
export const blockRect = (g: Pick<TpmGeo, 'die' | 'scale'>, b: Pick<TpmBlock, 'rect'>): Rect => ({ x: g.die.x + b.rect.x * g.scale, y: g.die.y + b.rect.y * g.scale, w: b.rect.w * g.scale, h: b.rect.h * g.scale });

/** A hoverable part: the id without its slot (`regs`; the full id is `tpm0.regs`), its board rectangle, and whether it is a part of the zoomed-in view (the lid is seen from afar). */
export interface TpmPart { id: string; rect: Rect; inner: boolean }

/** Every part with an id, most specific first (the first hit wins): each block of the die by its plan id, then the lid over them. */
export function tpmParts(g: TpmGeo): TpmPart[] {
  return [...g.plan.blocks.map((b) => ({ id: b.id, rect: blockRect(g, b), inner: true })), { id: 'lid', rect: g.band, inner: false }];
}

/** The ids of every part of a module in header slot `slot`, for the hover table and its test. */
export const tpmIds = (visual: string, slot: string, hdr: Rect): string[] => tpmParts(tpmGeo(visual, hdr)).map((p) => `${slot}.${p.id}`);
