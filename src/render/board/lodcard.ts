import type { Container } from 'pixi.js';
import { SHOWN, bandAlpha, onBand, type Candidate, type CardLod, type LodRect } from '../lod';
import type { RectCache } from './lodrect';

/** What every accelerator card (GPU, NPU, TPM) needs of the LoD each frame: its text and counter layers, from the zoom and the detail budget. */
export interface CardText { ta: number; da: number; showText: boolean; showDetail: boolean }

/** The cards of `kind` in view that want their counters at this zoom, for the shared detail budget (live.ts). */
export function cardCandidates(kind: string, cards: readonly { slot: string; root: Container }[], rects: RectCache, view: LodRect, zoom: number, detailZ: number): Candidate[] {
  if (zoom < detailZ) return [];
  const out: Candidate[] = [];
  for (const c of cards) { const p = rects.place(c, c.root, view); if (p.onScreen) out.push({ id: `${kind}:${c.slot}`, focus: p.focus }); }
  return out;
}

/** Names and counters fade in over a short band; the counters only while the card holds a slot of the budget (`lod` unset: no budget, all show). */
export function cardText(zoom: number, lod: CardLod | undefined, id: string, textZ: number, detailZ: number): CardText {
  const ta = bandAlpha(zoom, onBand(textZ)), da = !lod || lod.top.has(id) ? bandAlpha(zoom, onBand(detailZ)) : 0;
  return { ta, da, showText: ta > SHOWN, showDetail: da > SHOWN };
}
