import type { Container } from 'pixi.js';
import { SHOWN, bandAlpha, focusZoom, onBand, type Candidate, type CardLod, type LodRect } from '../lod';
import type { RectCache } from './lodrect';

/** What every accelerator card (GPU, NPU, TPM) needs of the LoD each frame: its text and counter layers, from the zoom and the detail budget. */
export interface CardText { ta: number; da: number; showText: boolean; showDetail: boolean }

/** The cards of `kind` in view that want their counters at this zoom (less the further from the centre), for the shared detail budget (live.ts). */
export function cardCandidates(kind: string, cards: readonly { slot: string; root: Container }[], rects: RectCache, view: LodRect, zoom: number, detailZ: number): Candidate[] {
  const out: Candidate[] = [];
  for (const c of cards) {
    const p = rects.place(c, c.root, view);
    if (p.onScreen && focusZoom(zoom, p.focus) >= detailZ) out.push({ id: `${kind}:${c.slot}`, focus: p.focus });
  }
  return out;
}

/**
 * Names and counters fade in over a short band, at the zoom the card is seen at (`focus`: less the further from the centre; `lod` unset: no view, full zoom).
 * The counters only while the card holds a slot of the budget (`lod` unset: no budget, all show).
 */
export function cardText(zoom: number, lod: CardLod | undefined, id: string, textZ: number, detailZ: number, focus = 1): CardText {
  const z = lod ? focusZoom(zoom, focus) : zoom;
  const ta = bandAlpha(z, onBand(textZ)), da = !lod || lod.top.has(id) ? bandAlpha(z, onBand(detailZ)) : 0;
  return { ta, da, showText: ta > SHOWN, showDetail: da > SHOWN };
}
