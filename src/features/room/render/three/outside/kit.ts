// The outside's materials, made once per view and shared by every house, car, lamp and tree, so the merged street draws in few calls. The
// painted textures are kept between views (`textures.ts` paints each once): a view's `dispose` frees their GPU copies, a new view uploads them again.
import { DoubleSide, MeshPhysicalMaterial, MeshStandardMaterial, type Material, type MeshStandardMaterialParameters, type Texture } from 'three';
import { DECODE_SRGB } from '@/core/render/three/artlod';
import { CAR_COLOURS } from './plan';
import { asphalt, bark, birch, bricks, grass, hedge, leaves, paving, rooms, stucco, tiles, towerFace, type Surface } from './textures';

const once = <T>(f: () => T): (() => T) => { let v: T | undefined; return () => (v ??= f()); };
const PAINTED = {
  red: once(() => bricks('red')), buff: once(() => bricks('buff')), stucco: once(stucco), paving: once(paving), asphalt: once(asphalt), grass: once(grass), hedge: once(hedge),
  clay: once(() => tiles('clay')), slate: once(() => tiles('slate')), brown: once(() => tiles('brown')), bark: once(bark), birch: once(birch), leaves: once(leaves),
  rooms: once(() => rooms(false)), roomsLit: once(() => rooms(true)), tower: once(() => towerFace(false)), towerLit: once(() => towerFace(true)),
};

export interface Kit {
  walls: MeshStandardMaterial[]; tiles: MeshStandardMaterial[]; trims: MeshStandardMaterial[]; doors: MeshStandardMaterial[];
  stone: MeshStandardMaterial; plinth: MeshStandardMaterial; gutter: MeshStandardMaterial; pots: MeshStandardMaterial; lead: MeshStandardMaterial;
  chimney: MeshStandardMaterial; ridge: MeshStandardMaterial; brass: MeshStandardMaterial; glass: MeshStandardMaterial; lit: MeshStandardMaterial;
  asphalt: MeshStandardMaterial; paving: MeshStandardMaterial; kerb: MeshStandardMaterial; grass: MeshStandardMaterial; hedge: MeshStandardMaterial;
  soil: MeshStandardMaterial; paint: MeshStandardMaterial; iron: MeshStandardMaterial; post: MeshStandardMaterial; lantern: MeshStandardMaterial;
  car: MeshPhysicalMaterial[]; carGlass: MeshStandardMaterial; tyre: MeshStandardMaterial; rim: MeshStandardMaterial; tail: MeshStandardMaterial;
  head: MeshStandardMaterial; plate: MeshStandardMaterial; trim: MeshStandardMaterial;
  bark: MeshStandardMaterial; birch: MeshStandardMaterial; leaves: MeshStandardMaterial;
  towers: MeshStandardMaterial[]; town: MeshStandardMaterial; land: MeshStandardMaterial;
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

/** A pane's material: the room behind it (a quarter of `rooms`), a glassy face that takes the sky; `glow`: its lights for the night. */
function pane(glow: Texture | null): MeshStandardMaterial {
  const map = PAINTED.rooms();
  const m = new MeshStandardMaterial({ color: 0xffffff, map, roughness: 0.04, metalness: 0.15, envMapIntensity: 1.8, emissiveMap: glow, emissive: glow ? 0xffffff : 0x000000, emissiveIntensity: 0 });
  if (map) m.defines = { ...DECODE_SRGB };
  return m;
}

export function makeKit(): Kit {
  const P = PAINTED, st = P.stucco();
  const lit = pane(P.roomsLit());
  const lantern = new MeshStandardMaterial({ color: 0xfff4e0, roughness: 0.2, emissive: 0xffd49a, emissiveIntensity: 0 });
  const tower = P.tower(), towerLit = P.towerLit();
  const towers = [0xa9b6c4, 0xd9d2c3, 0x767c86].map((c) => {
    const m = new MeshStandardMaterial({ color: c, map: tower.map, roughness: 0.55, metalness: 0.2, emissiveMap: towerLit.map, emissive: 0xffffff, emissiveIntensity: 0 });
    if (tower.map) m.defines = { ...DECODE_SRGB };
    return m;
  });
  const leafMap = P.leaves();
  const leafMat = new MeshStandardMaterial({ map: leafMap, alphaTest: 0.42, alphaToCoverage: true, side: DoubleSide, vertexColors: true, roughness: 0.92 });
  if (leafMap) leafMat.defines = { ...DECODE_SRGB };
  return {
    walls: [surf(P.red(), 0xffffff, { roughness: 0.92 }), surf(P.buff(), 0xffffff, { roughness: 0.92 }), ...[0xefe2c4, 0xf3f1ea, 0xcdd8c2, 0xecd0bf, 0xc8d2dc].map((c) => surf(st, c))],
    tiles: [surf(P.clay(), 0xffffff, { roughness: 0.78 }), surf(P.slate(), 0xffffff, { roughness: 0.55, metalness: 0.05 }), surf(P.brown(), 0xffffff, { roughness: 0.8 })],
    trims: [plain(0xf2f0ea, 0.5), plain(0xe6dbc3, 0.55), plain(0x3a3e44, 0.5)],
    doors: [0x2f4a3c, 0x24324a, 0x7a2424, 0x1e1f22, 0x6b4a32].map((c) => plain(c, 0.42)),
    stone: surf(st, 0xd2cbbb, { roughness: 0.85 }), plinth: surf(st, 0x77726b), gutter: plain(0x2c2f33, 0.45, 0.3), pots: plain(0xa65b3c, 0.8),
    lead: plain(0x5c6166, 0.55, 0.2), chimney: surf(P.red(), 0xffffff), ridge: plain(0x5a3c32, 0.75), brass: plain(0xb59a52, 0.35, 0.9),
    glass: pane(null), lit,
    asphalt: surf(P.asphalt(), 0xffffff, { roughness: 0.95 }), paving: surf(P.paving(), 0xc9c5bd), kerb: surf(st, 0x9f9c95, { roughness: 0.85 }),
    grass: surf(P.grass(), 0xffffff, { roughness: 1 }), hedge: surf(P.hedge(), 0xffffff, { roughness: 1 }), soil: plain(0x3b2e24, 1),
    paint: plain(0xe6e4dc, 0.7), iron: plain(0x2b2b2d, 0.55, 0.6), post: plain(0x26302d, 0.45, 0.45), lantern,
    car: CAR_COLOURS.map((c) => new MeshPhysicalMaterial({ color: c, metalness: 0.35, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3 })),
    carGlass: new MeshStandardMaterial({ color: 0x161c23, roughness: 0.24, metalness: 0.3, envMapIntensity: 1.6 }), tyre: plain(0x1b1b1c, 0.9),
    rim: plain(0xb8bcc2, 0.3, 0.85), tail: plain(0x8a1414, 0.3), head: plain(0xe2e8ec, 0.15, 0.6), plate: plain(0xf0efe8, 0.5), trim: plain(0x18191b, 0.6),
    bark: surf(P.bark(), 0xffffff, { roughness: 0.95 }), birch: surf(P.birch(), 0xffffff, { roughness: 0.8 }), leaves: leafMat,
    towers, town: new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), land: new MeshStandardMaterial({ vertexColors: true, roughness: 1 }),
    night: [{ mat: lit, k: 1.5 }, { mat: lantern, k: 7 }, ...towers.map((mat) => ({ mat, k: 1.4 }))],
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
