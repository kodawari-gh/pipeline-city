// The coolers' materials and painted details (cooler3d.ts): the 2D heatsinks' metal ramp, the copper and the accent, the brushed and the satin
// aluminium, the screw heads, the pump cap's brushed face and maker's mark, and a radiator fin's ladder.
import type { MeshStandardMaterial, Texture } from 'three';
import { drawLockup, drawMark } from '@/core/render/brands';
import { bakedTex } from '@/core/render/three/baked';
import { paint, shareTex } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { tex } from '../casekit3d';
import { CPU_Z } from '../cpu3d';

/** The 2D heatsinks' metal ramp (dark theme `metals`), the heat pipes' copper and the tower's accent (`coolerArt`). */
export const METAL = { metal: 0x3b_46_63, hi: 0x56_62_8a, lo: 0x22_2a_41 };
const COPPER = 0xc0_79_3a;
export const ACCENT = { tower: 0x3b_e3_ff } as const;

export const alu = (c: number, rough = 0.34): MeshStandardMaterial => mat(c, { metalness: 0.75, roughness: rough });
/** The radiator's satin aluminium: half as metallic, so it keeps its grey in the case's shade. */
export const radAlu = (c: number, rough: number): MeshStandardMaterial => mat(c, { metalness: 0.45, roughness: rough });

// ------------------------------------------------------------------ painted details
let screwTex: Texture | null = null,
  brushedTex: Texture | null = null;

/** A screw head seen from above: a lit dome and its slot. */
export const screwHead = (): Texture | null =>
  (screwTex ??= shareTex(
    paint(64, 64, (c, w, h) => {
      const g = c.createRadialGradient(w * 0.38, h * 0.35, 2, w / 2, h / 2, w / 2);
      g.addColorStop(0, '#9aa6c8');
      g.addColorStop(1, '#2a3248');
      c.fillStyle = g;
      c.fillRect(0, 0, w, h);
      c.strokeStyle = 'rgba(0,0,0,0.6)';
      c.lineWidth = 7;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(w * 0.2, h * 0.44);
      c.lineTo(w * 0.8, h * 0.56);
      c.stroke();
    }),
  ));

/** The pump cap's face: neutral aluminium brushed in rings, lit toward the north-west as in 2D, a turned groove round the polished boss. */
const brushed = () =>
  (brushedTex ??= shareTex(
    bakedTex('cooler-brushed') ??
      paint(512, 512, (c, w, h) => {
        const g = c.createRadialGradient(w * 0.38, h * 0.32, 10, w / 2, h / 2, w / 2);
        g.addColorStop(0, '#a3a8b1');
        g.addColorStop(1, '#4e535c');
        c.fillStyle = g;
        c.fillRect(0, 0, w, h);
        let seed = 7;
        const rnd = () => (seed = (seed * 16_807) % 2_147_483_647) / 2_147_483_647;
        for (let r = 4; r < w / 2; r += 1.5) {
          c.strokeStyle = rnd() < 0.5 ? `rgba(255,255,255,${rnd() * 0.08})` : `rgba(0,0,0,${rnd() * 0.12})`;
          c.lineWidth = 1;
          c.beginPath();
          c.arc(w / 2, h / 2, r, 0, Math.PI * 2);
          c.stroke();
        }
      }),
  ));
/** The maker's mark under the pump cap's glass (`brands/fujin.ts`): the cooling maker's crest over its name, pale silver on clear. */
export const capMark = (): Texture | null =>
  tex('pump-cap-mark', 512, 512, (c, w, h) => {
    c.clearRect(0, 0, w, h);
    const ink = '#c3c8d0',
      m = h * 0.34;
    drawMark(c, 'fujin', (w - m) / 2, h * 0.2, m, ink, null);
    drawLockup(c, 'fujin', w / 2, h * 0.72, 64, ink, { mark: false, cap: 0.75, align: 'center' });
  });
/** The pump cap's metal: the brushed face, polished (the same at Low, which keeps the machine's materials). */
export const capMat = (): MeshStandardMaterial => mat(0xff_ff_ff, { map: brushed(), metalness: 0.8, roughness: 0.3 });

/** One fin of a radiator's core seen edge-on, with the dark gap to the next, stacking along the sheet's `u` or `v`. */
export const finLadder = (along: 'u' | 'v'): Texture | null =>
  tex(`radiator-fin-${along}`, 64, 64, (c, w, h) => {
    c.fillStyle = '#0b0f1c';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#7f8bb3';
    if (along === 'u') {
      c.fillRect(0, 0, w * 0.34, h);
    } else {
      c.fillRect(0, 0, w, h * 0.34);
    }
  });

/** Every cooler sits on the CPU's lid. */
export const L = CPU_Z.top;
export const steel = (flat = false): MeshStandardMaterial =>
  mat(0x95_9a_a3, { metalness: 0.8, roughness: 0.3, flatShading: flat });
export const plastic = (): MeshStandardMaterial => mat(0x13_15_18, { roughness: 0.5 });
export const copper = (): MeshStandardMaterial => mat(COPPER, { metalness: 0.9, roughness: 0.28 });
