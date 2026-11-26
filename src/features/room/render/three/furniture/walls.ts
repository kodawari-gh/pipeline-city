// The lights and the art on the walls: the ceiling light (`ceilingLight`), the print over the bed (`print`) and its picture light (`pictureLight`).
import { Color, Group, Mesh, PlaneGeometry, RectAreaLight } from 'three';
import { SEG, paint, place, post, rectBox, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { OPAL, kelvin } from '../palette';
import { rnd } from './seed';
import type { MeshStandardMaterial, Texture } from './types';

/**
 * A slim round LED ceiling light (y: the ceiling, 2D y down): a dark body off the ceiling on a short shadow line, its opal face; the face
 * glows when lit.
 */
export function ceilingLight(x: number, y: number, z: number): { root: Group; glow: MeshStandardMaterial } {
  const g = new Group(),
    r = 5000;
  const line = mat(0x13_15_18, { roughness: 0.9 });
  g.add(place(post(x, y + 250, z, r - 300, 250, line, SEG.fineDisc), false));
  const body = mat(0x2a_2d_32, { roughness: 0.5 });
  g.add(place(post(x, y + 900, z, r, 650, body, SEG.fineDisc), false));

  const glow = mat(OPAL, { roughness: 0.5, emissive: new Color(0xff_e6_c4), emissiveIntensity: 0 });
  g.add(place(post(x, y + 940, z, r - 250, 40, glow, SEG.fineDisc), false));
  return { root: g, glow };
}

/** A framed print over the bed: a thin black frame, an ink-wash scene on warm paper (misty ridges, a small vermilion sun, a red seal). */
export function print(r: { x: number; y: number; w: number; h: number }, z: number): Group {
  const g = new Group();
  g.add(softBox(r, z, z + 380, mat(0x13_15_18, { roughness: 0.45 }), 30));
  const art = inkWash();
  const face = new Mesh(new PlaneGeometry(r.w - 500, r.h - 500), mat(0xff_ff_ff, { map: art, roughness: 0.85 }));
  face.position.set(r.x + r.w / 2, -(r.y + r.h / 2), z + 392);
  g.add(face);
  return g;
}

/** The print's ink-wash scene on warm paper: misty ridges, a small vermilion sun, a red seal. */
function inkWash(): Texture | null {
  return paint(512, 360, (c, w, h) => {
    c.fillStyle = '#bdb5a3';
    c.fillRect(0, 0, w, h);
    for (let k = 0; k < 500; k++) {
      c.fillStyle = `rgba(255,255,255,${0.03 + rnd() * 0.05})`;
      c.fillRect(rnd() * w, rnd() * h, 1, 3 + rnd() * 8);
    }
    c.fillStyle = '#b8432c';
    c.beginPath();
    c.arc(w * 0.7, h * 0.27, h * 0.065, 0, Math.PI * 2);
    c.fill();
    // the ridges, far to near: each darker, its peaks sharp, its foot fading into mist
    for (const [tone, base, amp, f, ph] of [
      ['118,114,106', 0.5, 0.2, 1.7, 0.4],
      ['82,80,76', 0.66, 0.17, 2.3, 2.1],
      ['40,39,38', 0.82, 0.13, 1.3, 4.2],
    ] as const) {
      const fog = c.createLinearGradient(0, h * (base - amp), 0, h * (base + 0.2));
      fog.addColorStop(0, `rgba(${tone},0.95)`);
      fog.addColorStop(1, `rgba(${tone},0)`);
      c.fillStyle = fog;
      c.beginPath();
      c.moveTo(0, h);
      for (let i = 0; i <= 96; i++) {
        const u = i / 96,
          peak =
            0.6 * Math.abs(Math.sin(u * Math.PI * f + ph)) +
            0.3 * Math.abs(Math.sin(u * Math.PI * f * 2.7 + ph * 1.7)) +
            0.1 * Math.sin(u * 47 + ph);
        c.lineTo(u * w, h * (base - amp * peak));
      }
      c.lineTo(w, h);
      c.closePath();
      c.fill();
    }
    c.fillStyle = '#a8352a';
    c.fillRect(w * 0.08, h * 0.8, 12, 16);
  });
}

/**
 * A picture light over a framed print (`r` the frame, `z` the wall): a slim black bar on a short arm from a wall plate over the frame, a warm
 * slot under it; its area light (3000 K) shines down and back onto the print.
 */
export function pictureLight(
  r: { x: number; y: number; w: number; h: number },
  z: number,
): { root: Group; glow: MeshStandardMaterial; light: RectAreaLight } {
  const g = new Group(),
    black = mat(0x1d_1e_22, { metalness: 0.4, roughness: 0.4 }),
    cx = r.x + r.w / 2,
    len = r.w * 0.6,
    by = r.y - 900,
    bz = z + 2600;
  // the wall plate, the arm out from it and down to the bar, the bar (`by` its underside)
  g.add(softBox({ x: cx - 900, y: by - 1300, w: 1800, h: 900 }, z, z + 120, black, 30));
  g.add(
    rectBox({ x: cx - 90, y: by - 940, w: 180, h: 180 }, z + 120, bz, black),
    rectBox({ x: cx - 90, y: by - 940, w: 180, h: 500 }, bz - 90, bz + 90, black),
  );
  g.add(softBox({ x: cx - len / 2, y: by - 450, w: len, h: 450 }, bz - 260, bz + 260, black, 60));
  const glow = mat(0x13_15_18, { roughness: 0.6, emissive: new Color(kelvin(3000)), emissiveIntensity: 0 });
  g.add(rectBox({ x: cx - len / 2 + 200, y: by, w: len - 400, h: 70 }, bz - 150, bz + 150, glow));
  // (tilted back toward the wall, onto the print's middle)
  const light = new RectAreaLight(kelvin(3000), 0, len - 400, 300);
  light.position.set(cx, -by - 80, bz);
  light.rotation.x = -Math.PI / 2 + 0.45;
  g.add(light);
  return { root: g, glow, light };
}
