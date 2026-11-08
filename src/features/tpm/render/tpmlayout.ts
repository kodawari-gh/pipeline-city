import { specsOfKind } from '../../board/sim/specs';
import { TPM_KEYS_SHOWN } from '../sim/tpm';
import { tpmPlanInput, type TpmBlock, type TpmPlan } from './tpmplan';
import { TPM_DIE, tpmPlan } from './tpmplans';
import type { Rect } from '../../board/render/layout/layout';

// The secure module on its header (docs/PC_PARTS.md "TPM"), in board space. The daughterboard stands on the header; the header's pins come through
// its south end (their solder joints show). North of them, in the band between the board's edge and those pins, its chip: a real TSSOP-28, as on
// the LPC modules of both TPM generations. The die's own plan (`tpm/tpmplans.ts`) is drawn in die units and scaled onto the chip's top. Like
// `gpulayout` for the cards: the tooltip test enumerates the hover ids from here, so a part cannot be drawn without a description.

/**
 * How far the daughterboard reaches round the header's pins: its margin, and how far it runs on past the pins (north): a real module (the ASUS
 * TPM-SPI on its 14-1 header) is 13 mm deep to the 2 x 7 header's 5 mm. Its name runs along that edge.
 */
const PAD = 16, NAME = 140, NAME_ROW = 44;

/** The daughterboard over a header's rectangle `hdr` (board space): what a click hits, and the PCB the 3D model raises. */
export const tpmPcb = (hdr: Rect): Rect => ({ x: hdr.x - PAD, y: hdr.y - PAD - NAME, w: hdr.w + 2 * PAD, h: hdr.h + 2 * PAD + NAME });

/** Board units a millimetre (the case's scale, `MM` in board/render/three/pcbkit3d.ts). */
const MM = 23;
/** The chip's package: a TSSOP-28 (JEDEC MO-153): a 9.7 x 4.4 mm body, 14 legs on each long side on a 0.65 mm pitch. */
export const TSSOP28 = { w: 9.7 * MM, h: 4.4 * MM, legs: 14, pitch: 0.65 * MM } as const;
/** The plain mould the die leaves round it on the chip's top. */
const DIE_INSET = 0.25 * MM;

export interface TpmGeo {
  /** The daughterboard (what a click on the module hits). */
  pcb: Rect;
  /** The band north of the pins (the 2D lid covers it), the chip's body centred in it (`TSSOP28`), and the die on the chip's top (die units scale to board units by `scale`). */
  band: Rect;
  chip: Rect;
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
  const pcb = tpmPcb(hdr);
  const band = { x: pcb.x + 10, y: pcb.y + NAME_ROW, w: pcb.w - 20, h: hdr.y - 10 - (pcb.y + NAME_ROW) };
  const chip = { x: band.x + (band.w - TSSOP28.w) / 2, y: band.y + (band.h - TSSOP28.h) / 2, w: TSSOP28.w, h: TSSOP28.h };
  const scale = Math.min((chip.w - 2 * DIE_INSET) / TPM_DIE.w, (chip.h - 2 * DIE_INSET) / TPM_DIE.h), w = TPM_DIE.w * scale, h = TPM_DIE.h * scale;
  const geo: TpmGeo = { pcb, band, chip, die: { x: chip.x + (chip.w - w) / 2, y: chip.y + (chip.h - h) / 2, w, h }, scale, plan: tpmPlanOf(visual) };
  cache.set(key, geo);
  return geo;
}

/**
 * The module's status LED (board space), by the PCB's east edge beside the chip: the 3D module carries it, and the 3D view (`TpmView` bare) lights it
 * red while protected mode is on, where the 2D lid shows its padlock.
 */
export const tpmLed = (g: Pick<TpmGeo, 'pcb' | 'band'>): { x: number; y: number } => ({ x: g.pcb.x + g.pcb.w - 18, y: g.band.y + g.band.h / 2 });

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
