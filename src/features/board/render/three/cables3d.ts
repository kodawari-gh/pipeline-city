// Braided sleeves and plugs in 3D, after the 2D cable look (`paintCable`, `cableArt`, docs/render/board.md "Cable look and physics"): a dark
// sleeve woven with strands of the lead's accent, a plug at each end (a dark moulded body, the accent band where the cable leaves it), the ties
// round the leads in the gutter. The PSU leads and the loop's tubes both use them.
import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, TubeGeometry, Vector3, type MeshStandardMaterial, type Texture } from 'three';
import { mix } from '@/core/render/ink';
import { paint, place, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { plugRect } from '../devices';
import type { Plug } from '../wiring/routes';

const hex = (c: string): number => parseInt(c.slice(1), 16);
const braids = new Map<string, Texture | null>();

/** A woven sleeve's tile: the sleeve colour crossed by two sets of strands toward the accent, a fine lit edge on one set. */
function braid(base: string, tint: string): Texture | null {
  const key = base + tint;
  if (!braids.has(key)) braids.set(key, paint(64, 64, (c, w, h) => {
    c.fillStyle = base; c.fillRect(0, 0, w, h);
    c.lineWidth = 9;
    for (let k = -2; k < 4; k++) {
      c.strokeStyle = mix(base, tint, 0.38); c.beginPath(); c.moveTo(k * 32 - 32, 0); c.lineTo(k * 32 + 32, h); c.stroke();
      c.strokeStyle = mix(base, tint, 0.16); c.beginPath(); c.moveTo(k * 32 + 32, 0); c.lineTo(k * 32 - 32, h); c.stroke();
    }
    c.lineWidth = 1.5; c.strokeStyle = 'rgba(255,255,255,0.14)';
    for (let k = -2; k < 4; k++) { c.beginPath(); c.moveTo(k * 32 - 34, 0); c.lineTo(k * 32 + 30, h); c.stroke(); }
  }, [1, 1]));
  return braids.get(key) ?? null;
}

/** A braided tube through world points, `r` thick: the sleeve `base` woven toward `tint`. Its curve is returned for what sits along it. */
export function braidedTube(pts: readonly Vector3[], r: number, base: string, tint: string): { mesh: Mesh; curve: CatmullRomCurve3 } {
  const curve = new CatmullRomCurve3(pts.map((p) => p.clone()), false, 'centripetal'), L = curve.getLength();
  const tex = braid(base, tint)?.clone() ?? null;
  // a weave about as long as the sleeve is thick, three tiles round it
  if (tex) { tex.needsUpdate = true; tex.repeat.set(L / (r * 1.75), 3); }
  const m = mat(0xffffff, { map: tex, bumpMap: tex, bumpScale: 1.2, roughness: 0.6 });
  return { mesh: place(new Mesh(new TubeGeometry(curve, Math.max(24, pts.length * 2), r, 14, false), m)), curve };
}

/** A band round a tube at `s` along its curve (a hose clamp, a cable tie), `len` long. */
export function band(curve: CatmullRomCurve3, s: number, r: number, len: number, m: MeshStandardMaterial): Mesh {
  const u = Math.max(0, Math.min(1, s / curve.getLength())), o = place(new Mesh(new CylinderGeometry(r, r, len, 20), m));
  o.position.copy(curve.getPointAt(u));
  o.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), curve.getTangentAt(u));
  return o;
}

/** A power plug from depth `z0` to `z1` over its 2D footprint (`plugRect`): the moulded body, and the accent band at the end the cable leaves. */
export function plug3d(p: Plug, accent: string, z0: number, z1: number): Group {
  const g = new Group(), r = plugRect(p), b = 26;
  g.add(softBox(r, z0, z1, mat(0x1b2230, { roughness: 0.5 }), 14));
  const end = p.dx > 0 ? { x: r.x + r.w - b, y: r.y, w: b, h: r.h } : p.dx < 0 ? { x: r.x, y: r.y, w: b, h: r.h } : p.dy > 0 ? { x: r.x, y: r.y + r.h - b, w: r.w, h: b } : { x: r.x, y: r.y, w: r.w, h: b };
  g.add(softBox({ x: end.x - 4, y: end.y - 4, w: end.w + 8, h: end.h + 8 }, z0 - 4, z1 + 4, mat(hex(accent), { roughness: 0.45 }), 10));
  return g;
}
