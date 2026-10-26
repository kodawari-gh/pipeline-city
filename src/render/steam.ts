import { Container, Sprite, Texture } from 'pixi.js';

// The steam over the coffee: a few dozen soft puffs that rise, widen and fade, each on its own phase and sway, drawn from the game clock (so it freezes with
// the pause). Very faint on purpose: it is a hint of warmth, not a plume.

export const STEAM = { puffs: 18, life: 6400, rise: 2100, peak: 0.14 };

/** Where puff `i` is at game time `gt` (ms): `t` its age 0 to 1, the offset from the source, its size and its opacity. */
export function puffAt(i: number, gt: number): { t: number; dx: number; dy: number; size: number; alpha: number } {
  const t = (((gt / STEAM.life + i / STEAM.puffs) % 1) + 1) % 1;
  const seed = (Math.sin(i * 91.7 + 3.3) * 43758.5453) % 1, src = (Math.abs(seed) - 0.5) * 520;
  const amp = 70 + 520 * t, sway = 0.6 * Math.sin(gt / 1150 + i * 1.7 + t * 4.5) + 0.4 * Math.sin(gt / 540 + i * 3.1 + t * 9);
  const wind = 140 * Math.sin(gt / 6500 + 1) * t * t;
  return { t, dx: src + amp * sway + wind, dy: -STEAM.rise * Math.pow(t, 0.85), size: 190 + 560 * t, alpha: STEAM.peak * Math.pow(Math.sin(Math.PI * t), 1.6) };
}

let puff: Texture | null = null;
/** One soft, uneven puff: a few overlapping soft discs, white on clear. */
function puffTexture(): Texture {
  if (puff) return puff;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d')!;
  const discs: [number, number, number, number][] = [[64, 64, 50, 0.55], [46, 58, 34, 0.45], [84, 70, 36, 0.45], [60, 44, 30, 0.4], [70, 86, 30, 0.35], [40, 82, 24, 0.3]];
  for (const [px, py, r, a] of discs) {
    const g = x.createRadialGradient(px, py, 0, px, py, r);
    g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  }
  return (puff = Texture.from(c));
}

/** The steam: `frame(gt)` moves the puffs. Without a canvas (tests) there are none. */
export class Steam extends Container {
  private readonly sprites: Sprite[] = [];
  constructor(private readonly sx: number, private readonly sy: number, dark: boolean) {
    super();
    if (typeof document === 'undefined') return;
    for (let i = 0; i < STEAM.puffs; i++) {
      const s = new Sprite(puffTexture());
      s.anchor.set(0.5); s.tint = dark ? '#f6efe6' : '#ffffff';
      this.sprites.push(s); this.addChild(s);
    }
  }
  frame(gt: number) {
    this.sprites.forEach((s, i) => {
      const p = puffAt(i, gt);
      s.position.set(this.sx + p.dx, this.sy + p.dy);
      s.width = p.size; s.height = p.size * (1.15 + 0.5 * p.t); // it stretches as it rises
      s.alpha = p.alpha;
    });
  }
}
