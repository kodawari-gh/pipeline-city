// The wall plate with the ISP line (docs/render/net.md "Network").

import { Container, FillGradient, Graphics } from 'pixi.js';
import { box, disc, label, mix } from '@/core/render/ink';
import * as layout from '../../board/render/layout/layout';
import type { Theme } from '@/core/render/theme';

const vgrad = (top: string, bot: string) =>
  new FillGradient({
    type: 'linear',
    start: { x: 0, y: 0 },
    end: { x: 0, y: 1 },
    colorStops: [
      { offset: 0, color: top },
      { offset: 1, color: bot },
    ],
    textureSpace: 'local',
  });

/** "50 Mb", "1 Gb". */
const fmtMbps = (m: number) => (m >= 1000 ? `${Number((m / 1000).toFixed(1))} Gb` : `${m} Mb`);

const SOCK_H = 84;

// ---------------------------------------------------------------- wall plate

export function wallArt(T: Theme, isp: { id: string; name: string; downMbps: number } | null): Container {
  const root = new Container(),
    g = new Graphics();
  root.addChild(g);
  // drawn at design size (460 x 420) with its bottom-left corner on the plate's baseline (`WALL_Y`, under the desk), then scaled about that corner
  root.position.set(layout.WALL_PLATE.x, layout.WALL_Y);
  root.scale.set(layout.NET_K);
  const p = { x: 0, y: -420, w: 460, h: 420 },
    cx = p.x + p.w / 2;
  const [hi, lo] = ['#3a4560', '#252d44'];
  const ink = '#dfe7ff';
  box(g, p.x + 10, p.y + 16, p.w, p.h, 36, { fill: '#000000', fa: 0.32 });
  g.roundRect(p.x, p.y, p.w, p.h, 36).fill(vgrad(hi, lo)).stroke({ width: 6, color: T.line, alpha: 0.9 });
  for (const sx of [p.x + 48, p.x + p.w - 48]) {
    disc(g, sx, p.y + 46, 14, { fill: mix(lo, '#000000', 0.25) });
    g.moveTo(sx - 8, p.y + 46)
      .lineTo(sx + 8, p.y + 46)
      .stroke({ width: 3, color: '#000000', alpha: 0.4 });
  }
  const tier = isp ? Number(/\d+$/u.exec(isp.id)?.[0] ?? 0) : 0;
  root.addChild(
    label(isp ? fmtMbps(isp.downMbps) : 'NO LINE', cx, p.y + 130, isp ? 116 : 76, isp ? ink : T.mute, {
      anchor: [0.5, 0.5],
      head: true,
      a: isp ? 1 : 0.8,
    }),
  );
  if (isp) {
    root.addChild(label(isp.name.toUpperCase(), cx, p.y + 206, 38, ink, { anchor: [0.5, 0.5], a: 0.9 }));
  }
  for (let i = 0; i < 5; i++) {
    disc(g, cx - 96 + i * 48, p.y + 258, 12, i < tier ? { fill: T.alu } : { stroke: T.mute, lw: 3, sa: 0.6 });
  }
  // the jack opens at the bottom edge; the ISP line plugs in from below
  const jx = cx;
  box(g, jx - 55, -SOCK_H, 110, SOCK_H + 2, 8, {
    fill: '#05070c',
    stroke: isp ? T.alu : T.line,
    lw: 3,
    sa: isp ? 0.8 : 0.6,
  });
  disc(g, jx, -SOCK_H - 38, 15, { fill: '#05070c', stroke: T.line, lw: 3, sa: 0.7 });
  return root;
}
