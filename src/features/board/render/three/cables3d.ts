// Braided sleeves and plugs in 3D, after the 2D cable look (`paintCable`, `cableArt`, docs/render/board.md "Cable look and physics"): a dark
// sleeve woven with strands of the lead's accent, a plug body (a dark moulding, the accent collar where the cable leaves it), the clamps round a
// hose. The power leads, the fans' cords and the loop's hoses use them (wires3d.ts hangs them).
import { CatmullRomCurve3, CylinderGeometry, Group, Mesh, TubeGeometry, Vector3, type MeshStandardMaterial, type Texture } from 'three';
import { mix } from '@/core/render/ink';
import { paint, place, softBox } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';

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

/** A plug's body over a layout rect from depth z0 to z1, the accent collar round it near z1 where the cable leaves, the dark cap over that end. */
export function plugBody(r: { x: number; y: number; w: number; h: number }, z0: number, z1: number, accent: string): Group {
  const g = new Group(), dark = mat(0x1b2230, { roughness: 0.5 }), k = Math.min(14, r.w / 4, r.h / 4);
  g.add(softBox(r, z0, z1 - 34, dark, k));
  g.add(softBox({ x: r.x - 4, y: r.y - 4, w: r.w + 8, h: r.h + 8 }, z1 - 36, z1 - 12, mat(hex(accent), { roughness: 0.45 }), Math.min(8, k)));
  g.add(softBox(r, z1 - 14, z1, dark, Math.min(6, k)));
  return g;
}

/** A plug standing on a socket whose mouth faces the glass (a card's top edge): its body from the mouth at (x, y, z) up to `top`, where the cable leaves. */
export const standingPlug = (at: { x: number; y: number; z: number }, accent: string, top: number): Group => plugBody({ x: at.x - 58, y: at.y - 52, w: 116, h: 104 }, at.z - 4, top, accent);
