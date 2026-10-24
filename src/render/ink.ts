import { Container, Graphics, Text, type TextStyleOptions } from 'pixi.js';

import { currentTextResolution } from './camera';

// Small drawing helpers shared by the art builders.

export const MONO = '"JetBrains Mono", ui-monospace, Consolas, "Courier New", monospace';
export const HEAD = '"Chakra Petch", system-ui, sans-serif';

export interface BoxOpts { fill?: string | null; stroke?: string | null; lw?: number; fa?: number; sa?: number }

export function box(g: Graphics, x: number, y: number, w: number, h: number, r: number, o: BoxOpts): Graphics {
  g.roundRect(x, y, w, h, r);
  if (o.fill) g.fill({ color: o.fill, alpha: o.fa ?? 1 });
  if (o.stroke) g.stroke({ width: o.lw ?? 6, color: o.stroke, alpha: o.sa ?? 1 });
  return g;
}

export function disc(g: Graphics, x: number, y: number, r: number, o: BoxOpts): Graphics {
  g.circle(x, y, r);
  if (o.fill) g.fill({ color: o.fill, alpha: o.fa ?? 1 });
  if (o.stroke) g.stroke({ width: o.lw ?? 6, color: o.stroke, alpha: o.sa ?? 1 });
  return g;
}

/** A dashed polyline (Pixi Graphics has no line dash). Caller strokes afterwards. */
export function dashed(g: Graphics, pts: [number, number][], dash: number, gap: number, offset = 0): void {
  let carry = -offset;
  for (let i = 1; i < pts.length; i++) {
    const [x0, y0] = pts[i - 1]!, [x1, y1] = pts[i]!;
    const len = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / len, uy = (y1 - y0) / len;
    let s = 0;
    while (s < len) {
      const phase = ((carry + s) % (dash + gap) + dash + gap) % (dash + gap);
      if (phase < dash) {
        const e = Math.min(len, s + (dash - phase));
        g.moveTo(x0 + ux * s, y0 + uy * s).lineTo(x0 + ux * e, y0 + uy * e);
        s = e;
      } else s += dash + gap - phase;
    }
    carry += len;
  }
}

export function label(
  str: string, x: number, y: number, size: number, color: string, o: { a?: number; head?: boolean; anchor?: [number, number]; weight?: string; align?: 'left' | 'center' | 'right' } = {},
): Text {
  const style: TextStyleOptions = {
    fontFamily: o.head ? HEAD : MONO, fontSize: size, fill: color, fontWeight: (o.weight ?? (o.head ? '700' : '500')) as TextStyleOptions['fontWeight'],
    align: o.align ?? 'left',
  };
  const t = new Text({ text: str, style, resolution: currentTextResolution() });
  t.anchor.set(...(o.anchor ?? [0, 0.5]));
  t.position.set(x, y);
  t.alpha = o.a ?? 1;
  return t;
}

export function clear(c: Container): void {
  for (const ch of c.removeChildren()) ch.destroy({ children: true });
}

/** Linear blend of two #rrggbb colours (other CSS colour forms fall back to `a`). */
export function mix(a: string, b: string, t: number): string {
  const pa = hex(a), pb = hex(b);
  if (!pa || !pb) return a;
  const k = Math.max(0, Math.min(1, t));
  const c = pa.map((v, i) => Math.round(v + (pb[i]! - v) * k));
  return '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
}

function hex(s: string): number[] | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim());
  if (!m) return null;
  let h = m[1]!;
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
