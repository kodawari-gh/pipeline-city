// The outside's materials for the streets, made once per view and shared by every pavement, lamp and tree, so the merged streets draw in
// few calls (the buildings have their own, `towers.ts`; the cars theirs, `cars.ts`). The painted textures are kept between views (`textures.ts` paints each once): a
// view's `dispose` frees their GPU copies, a new view uploads them again.
import { MeshStandardMaterial, type Material, type MeshStandardMaterialParameters, type Texture } from 'three';
import { DECODE_SRGB } from '@/core/render/three/artlod';
import { asphalt, bark, grass, paving, stucco, type Surface } from './textures';

const once = <T>(f: () => T): (() => T) => { let v: T | undefined; return () => (v ??= f()); };
const PAINTED = { stucco: once(stucco), paving: once(paving), asphalt: once(asphalt), grass: once(grass), bark: once(bark) };

export interface Kit {
  stone: MeshStandardMaterial; asphalt: MeshStandardMaterial; paving: MeshStandardMaterial; kerb: MeshStandardMaterial; grass: MeshStandardMaterial;
  soil: MeshStandardMaterial; paint: MeshStandardMaterial; yellow: MeshStandardMaterial; iron: MeshStandardMaterial; post: MeshStandardMaterial;
  lantern: MeshStandardMaterial; trim: MeshStandardMaterial;
  bark: MeshStandardMaterial; leaves: MeshStandardMaterial; land: MeshStandardMaterial;
  /** What glows at night, and how bright at full night (the view sets each one's emissive intensity by the hour). */
  night: { mat: MeshStandardMaterial; k: number }[];
}

/** A material on a painted surface (its map decoded in the shader, its normal map), tinted by `color`. */
function surf(s: Surface, color: number, o: MeshStandardMaterialParameters = {}): MeshStandardMaterial {
  const m = new MeshStandardMaterial({ color, map: s.map, normalMap: s.normal, roughness: 0.9, ...o });
  if (s.map) m.defines = { ...DECODE_SRGB };
  return m;
}

const plain = (color: number, roughness: number, metalness = 0): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness, metalness });
/** A lamp's material: its colour by day, its glow (`emissive`) by night. */
const glowing = (color: number, emissive: number, roughness: number): MeshStandardMaterial => new MeshStandardMaterial({ color, roughness, emissive, emissiveIntensity: 0 });

export function makeKit(): Kit {
  const P = PAINTED, st = P.stucco();
  const lantern = glowing(0xf4f6f8, 0xfff0d8, 0.2);
  const leafMat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.88 });
  return {
    // (the sill under our window, 2 m from the eye in full sun: smooth and no paler than the roofs across the street, no stucco grain)
    stone: plain(0x8e8a83, 0.9),
    asphalt: surf(P.asphalt(), 0xffffff, { roughness: 0.95 }), paving: surf(P.paving(), 0xc9c5bd), kerb: surf(st, 0x8f8c86, { roughness: 0.9 }),
    grass: surf(P.grass(), 0xffffff, { roughness: 1 }), soil: plain(0x3b2e24, 1),
    paint: plain(0xe6e4dc, 0.7), yellow: plain(0xd9a92e, 0.7), iron: plain(0x2b2b2d, 0.55, 0.6), post: plain(0x4a4f55, 0.45, 0.6), lantern,
    trim: plain(0x18191b, 0.6),
    bark: surf(P.bark(), 0xffffff, { roughness: 0.95 }), leaves: leafMat, land: new MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    night: [{ mat: lantern, k: 9 }],
  };
}

/** Free a kit's GPU side: its materials and their textures (the paintings stay, for the next view to upload). */
export function disposeKit(k: Kit): void {
  const seen = new Set<Material>();
  for (const v of Object.values(k)) for (const m of (Array.isArray(v) ? v : [v]) as unknown[]) {
    const mat = (m as { mat?: Material }).mat ?? (m as Material);
    if (!(mat as Material).isMaterial || seen.has(mat)) continue;
    seen.add(mat);
    for (const t of Object.values(mat)) if ((t as Texture | null)?.isTexture) (t as Texture).dispose();
    mat.dispose();
  }
}
