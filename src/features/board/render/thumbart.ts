import { Container, Graphics, Rectangle, type ICanvas, type Renderer } from 'pixi.js';
import { BOARD_TIERS, CASE_TIERS, getSpec, type CoolerSpec, type CpuSpec, type PsuSpec, type RamSpec } from '../sim/specs';
import { getIspSpec, getRouterSpec } from '../../network/sim/specs';
import { buildBoard } from './boardArt';
import { cpuArt, monitorArt, psuBoxArt, ramArt, vrmSinkArt } from './devices';
import { coolerKitArt, radiatorKitArt } from './cooler';
import { driveArt, drawDriveLive, driveKindOf } from '../../storage/render/drives';
import { exteriorArt, exteriorFrame } from '../../room/render/shell/exterior';
import { LAYOUT_CASE, LAYOUT_TIER, setLayoutTier, BD } from './layout/layout';
import { nicArt, routerArt, wallArt } from '../../network/render/net';
import { cardArt, tpmArt, tpmHeader } from '@/core/render/accelart';
import type { Theme } from '@/core/render/theme';

// The drawing behind `thumbs.ts`: one part's art, framed on a studio backdrop and rendered to a small canvas. It runs in the thumbnail
// worker (`thumbs.worker.ts`), and on the main thread only when that worker cannot start. It reads no DOM: the theme comes in.

/** The aspect every picture is fitted to (the UI's art box is 120 x 84). */
const ASPECT = 120 / 84;
/** Longest side of the rendered image, in pixels (a tile shows it at about 100 to 160 CSS px on a 2x screen). */
const PX = 360;

/** The ids a picture is made for job by job: the key the result is cached under, and the theme it is drawn in. */
export interface ThumbJob { key: string; id: string; theme: Theme; epoch: number }
/** A worker's answer: the PNG of a job (null: no picture for it), or `dead` when the worker has no renderer. */
export type ThumbReply = { key: string; epoch: number; png: Blob | null } | { dead: true };

/** Fit a frame to the picture's aspect with a margin, around the bounds of what was drawn. */
function frameOf(b: { x: number; y: number; width: number; height: number }) {
  const m = 0.07;
  let w = b.width * (1 + 2 * m), h = b.height * (1 + 2 * m);
  if (w / h < ASPECT) w = h * ASPECT; else h = w / ASPECT;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

function render(r: Renderer, art: Container, T: Theme, frame?: { x: number; y: number; w: number; h: number }): ICanvas {
  // wrapped first: the art may carry its own position, scale and pivot, which only a parent's local bounds include
  const stage = new Container();
  stage.addChild(art);
  const f = frame ?? frameOf(stage.getLocalBounds());
  // a soft studio backdrop, so a dark part on a dark tile still reads
  const back = new Graphics();
  back.roundRect(f.x, f.y, f.w, f.h, f.h * 0.07).fill({ color: T.dark ? '#1d2650' : '#e3e9f5', alpha: T.dark ? 0.55 : 0.8 });
  back.roundRect(f.x, f.y + f.h * 0.62, f.w, f.h * 0.38, f.h * 0.07).fill({ color: '#000000', alpha: T.dark ? 0.12 : 0.05 });
  stage.addChildAt(back, 0);
  const scale = PX / Math.max(f.w, f.h * ASPECT);
  const canvas = r.extract.canvas({ target: stage, frame: new Rectangle(f.x, f.y, f.w, f.h), resolution: scale, antialias: true, clearColor: [0, 0, 0, 0] });
  stage.destroy({ children: true });
  return canvas;
}

/** Draw the picture of one id, or null when it has none. The art reads the live layout, so the layout is pointed at a tier that has the
 *  part, then put back. */
export function drawThumb(r: Renderer, id: string, T: Theme): ICanvas | null {
  const prev = [LAYOUT_TIER, LAYOUT_CASE] as const;
  const bm = /^board(\d+)$/.exec(id), cm = /^case(\d+)$/.exec(id);
  try {
    if (bm) {
      const tier = Number(bm[1]);
      if (!BOARD_TIERS[tier]) return null;
      setLayoutTier(tier, tier);
      const a = buildBoard(T, tier, undefined, true);
      a.labels.visible = false;
      return render(r, a.root, T, frameOf({ x: BD.x, y: BD.y, width: BD.w, height: BD.h }));
    }
    if (cm) {
      const tier = Number(cm[1]), c = CASE_TIERS[tier];
      if (!c) return null;
      setLayoutTier(tier, tier);
      const art = exteriorArt(T, { nSata: 2, drives: [], features: BOARD_TIERS[tier]!.features });
      const f = exteriorFrame();
      return render(r, art, T, frameOf({ x: f.x, y: f.y, width: f.w, height: f.h }));
    }
    const router = getRouterSpec(id);
    if (router) return render(r, routerArt(T, router.visual, router.name), T);
    const isp = getIspSpec(id);
    if (isp) {
      setLayoutTier(2, 2);
      return render(r, wallArt(T, { id: isp.id, name: isp.name, downMbps: isp.downMbps }), T);
    }
    const spec = getSpec(id);
    if (!spec) return null;
    setLayoutTier(3, 3);
    const holder = new Container();
    switch (spec.kind) {
      case 'cpu': holder.addChild(cpuArt(T, spec as CpuSpec).root); break;
      case 'ram': {
        // a stick lies on its side: that is how it is pictured, and it fits the tile (its width drawn 3.3 times over, so the picture has a real
        // stick's proportion, 133 by 31 mm, and not the board's narrow footprint)
        const p = ramArt(T, spec as RamSpec);
        p.root.scale.set(3.3, 1);
        p.root.rotation = -Math.PI / 2;
        holder.addChild(p.root);
        break;
      }
      case 'cooler': holder.addChild(coolerKitArt(T, spec as CoolerSpec)); break;
      case 'radiator': holder.addChild(radiatorKitArt(T, spec.visual)); break;
      case 'psu': holder.addChild(psuBoxArt(T, spec as PsuSpec)); break;
      case 'display': holder.addChild(monitorArt(T, true, spec.visual === 'monitor-gfx').root); break;
      case 'vrm-sink': case 'ram-sink': {
        // a compact block (the one on the board is a long strip): the fins, the heat pipe, the fan
        const p = vrmSinkArt(T, spec.visual, { x: 0, y: 0, w: spec.kind === 'ram-sink' ? 1100 : 1300, h: 640 });
        holder.addChild(p.root);
        if (p.fan) holder.addChild(p.fan);
        if (p.over) holder.addChild(p.over);
        break;
      }
      case 'nic': holder.addChild(nicArt(T, spec.visual, 0)); break;
      case 'gpu': case 'npu': holder.addChild(cardArt(T, spec.visual, 0)); break;
      case 'tpm': { const h = tpmHeader(3); if (h) holder.addChild(tpmArt(T, spec.visual, h)); break; }
      case 'storage': {
        const kind = driveKindOf(spec.visual), slot = kind === 'ssd-nvme' ? 'm20' : 'sata0';
        holder.addChild(driveArt(T, kind, slot, spec.name, `${Math.round(spec.capacityBytes / 1024)}K`));
        const live = new Graphics();
        drawDriveLive(live, T, kind, slot, { spin: 0.4, head: 0.35, led: 0, burnt: false });
        holder.addChild(live);
        break;
      }
      default: holder.destroy(); return null;
    }
    return render(r, holder, T);
  } finally {
    setLayoutTier(prev[0], prev[1]);
  }
}
