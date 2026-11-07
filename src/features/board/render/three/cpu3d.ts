// The processor in 3D (docs/render/board.md "CPU"): one model for the case, Build my PC and the gallery. The package stands on its socket: the
// substrate wears the 2D package art (`cpuArt`: the pad rows, the capacitor ring, the die's far floorplan) and its capacitors stand up where the
// art draws them; the die is a block of silicon whose top wears the die view's floorplan with every name, in its own frame drawn at `CPU_S`.
// The heat spreader over it is satin nickel, laser-etched with the part's name; it fades away over the die view's band (`lod`) and the die shows,
// as the 2D lid does. The first two tiers wear a plain flat lid, the later ones a stepped one: a flange glued to the substrate, a plateau on it.
import { BoxGeometry, Group, Mesh, MeshStandardMaterial, Object3D, PlaneGeometry, type Texture } from 'three';
import { Container, Graphics } from 'pixi.js';
import { box } from '@/core/render/ink';
import { DEVICE_LOD, smooth } from '@/core/render/lod/lod';
import type { Theme } from '@/core/render/theme';
import { FINISH, fadeTree } from '@/core/render/three/artlod';
import { instanced, softBox, type RectLike } from '@/core/render/three/geometry';
import { mat } from '@/core/render/three/materials';
import { dieFar, dieNear, planOf } from '@/features/cpu/render/die/dieart';
import type { CpuSpec } from '@/features/board/sim/specs';
import { BOARD_Z } from '@/features/room/render/three/roomplan';
import { CPU_S, DIE, DIE_PLAN, PKG } from '../layout/layout';
import { cpuArt, cpuCaps } from '../devices';
import { LV_DIE, LV_PART, type ArtSet } from './artset3d';
import { brushed, outlinePts, shapeOf, slab, tex, tiled } from './casekit3d';

/** The package's depths off the board: the substrate's top, the die's top, the lid's flange and its top (the cooler's plate rests there, cooler3d.ts). */
export const CPU_Z = { base: BOARD_Z + 70, sub: BOARD_Z + 118, die: BOARD_Z + 134, flange: BOARD_Z + 152, top: BOARD_Z + 260 } as const;

export interface Cpu3D {
  root: Group;
  /** The heat spreader with its etching: it fades as the die view comes in (`lod`). */
  lid: Group;
  /** The materials that follow the part's state (`PartSkin`). */
  skin: MeshStandardMaterial[];
  /** The die's face and the depth over it, in its frame, where the live die runs (`Chips3D.face`). */
  die: { root: Object3D; z: number };
  /** A point over the die's middle: where the zoom that drives `lod` is read. */
  centre: Object3D;
  /** The zoom seen over the die (screen pixels per unit): the lid fades over the die view's band and the die's face shows. */
  lod: (zoom: number) => void;
}

const grow = (r: RectLike, e: number): RectLike => ({ x: r.x - e, y: r.y - e, w: r.w + 2 * e, h: r.h + 2 * e });

/** A small hash of a part's id: its lot number and its matrix code stay the same from build to build. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The lid's laser etching for a `w` x `h` face: the maker, the model, its cores and threads, a lot line and a matrix code, and the pin 1 mark at
 * the bottom left corner (where the substrate's gold triangle is). Dark on clear: it lies over the nickel.
 */
function etching(spec: CpuSpec, w: number, h: number): Texture | null {
  const W = 1024, H = Math.round((W * h) / w);
  return tex(`cpu-etch-${spec.id}-${W}x${H}`, W, H, (c) => {
    c.clearRect(0, 0, W, H);
    const ink = 'rgba(38,42,50,0.78)', m = W * 0.07, model = spec.name.split(' (')[0]!.toUpperCase(), cores = spec.cores ?? 1, n = hash(spec.id);
    c.fillStyle = ink;
    c.textBaseline = 'alphabetic';
    c.font = `700 ${Math.round(W * 0.09)}px sans-serif`;
    c.fillText('PIPELINE', m, m + W * 0.08);
    c.font = `600 ${Math.round(W * 0.062)}px sans-serif`;
    c.fillText(model, m, m + W * 0.17);
    c.font = `500 ${Math.round(W * 0.036)}px monospace`;
    c.fillText(`${cores}C / ${cores * (spec.threads ?? 1)}T   TIER ${spec.tier}   ${spec.id.toUpperCase()}`, m, m + W * 0.235);
    c.fillText(`L${n.toString(16).toUpperCase().padStart(8, '0')}   PIPELINE CITY`, m + W * 0.06, H - m);
    // pin 1
    c.beginPath(); c.moveTo(m * 0.55, H - m * 0.55); c.lineTo(m * 0.55 + W * 0.04, H - m * 0.55); c.lineTo(m * 0.55, H - m * 0.55 - W * 0.04); c.fill();
    // the matrix code: its solid L on the left and the bottom, its clock marks on the top and the right, the cells from the id
    const N = 14, s = Math.round(W * 0.011), x0 = W - m - N * s, y0 = H - m - N * s;
    let r = n || 1;
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      r = (Math.imul(r, 1103515245) + 12345) >>> 0;
      const on = i === 0 || j === N - 1 || (j === 0 ? i % 2 === 0 : i === N - 1 ? j % 2 === 1 : (r >>> 16) % 2 === 0);
      if (on) c.fillRect(x0 + i * s, y0 + j * s, s, s);
    }
  });
}

/** The processor `spec`, its faces from `art`. */
export function cpuModel(art: ArtSet, T: Theme, spec: CpuSpec): Cpu3D {
  const g = new Group(), lid = new Group(), plan = planOf(spec);
  // the substrate: the package's rounded rect (as the art's), its top the package art
  const sub = mat(0x111a33, { roughness: 0.6 });
  g.add(slab(shapeOf(outlinePts(PKG, 70)), CPU_Z.base, CPU_Z.sub, sub, 3));
  art.surface(g, art.baker(() => cpuArt(T, spec).root).bake, PKG, CPU_Z.sub, LV_PART);
  // the capacitors where the art draws them: a ceramic body between two tinned ends
  const body: { x: number; y: number; z: number; sx: number; sy: number; sz: number }[] = [], ends: typeof body = [];
  for (const c of cpuCaps()) {
    const along = c.w > c.h, cx = c.x + c.w / 2, cy = c.y + c.h / 2, L = Math.max(c.w, c.h), W = Math.min(c.w, c.h);
    body.push({ x: cx, y: -cy, z: CPU_Z.sub + 5, sx: along ? L - 8 : W, sy: along ? W : L - 8, sz: 10 });
    for (const k of [-1, 1]) {
      const o = k * (L / 2 - 2.5);
      ends.push({ x: cx + (along ? o : 0), y: -(cy + (along ? 0 : o)), z: CPU_Z.sub + 5.5, sx: along ? 5 : W, sy: along ? W : 5, sz: 11 });
    }
  }
  const cube = new BoxGeometry(1, 1, 1);
  g.add(instanced(cube, mat(0x9c7e55, { roughness: 0.6 }), body), instanced(cube, mat(0xc9ccd2, { metalness: 0.8, roughness: 0.35 }), ends));
  // the die: a block of silicon; its top, in the die's own frame drawn at `CPU_S`, wears the die view's floorplan with every name
  g.add(softBox(DIE, CPU_Z.sub, CPU_Z.die, mat(0x1d2433, { metalness: 0.35, roughness: 0.3 }), 2));
  const dieArt = art.baker(() => {
    const c = new Container(), gg = new Graphics();
    box(gg, DIE_PLAN.x, DIE_PLAN.y, DIE_PLAN.w, DIE_PLAN.h, 14, { fill: T.die });
    dieFar(gg, T, plan);
    c.addChild(gg, dieNear(T, plan).root);
    return c;
  });
  const frame = new Group();
  frame.position.z = CPU_Z.die;
  frame.scale.setScalar(CPU_S);
  g.add(frame);
  const face = art.surface(frame, dieArt.bake, DIE_PLAN, 1 / CPU_S, LV_DIE, FINISH.die);
  // the lid: satin nickel, a black bead of sealant where it meets the substrate; plain and flat, or a flange under a plateau
  const nickel = mat(0xc3c8ce, { metalness: 0.78, roughness: 0.36, map: tiled(brushed(), 1, 1) }), rim = grow(DIE, 26);
  lid.add(slab(shapeOf(outlinePts(grow(rim, 3), 32)), CPU_Z.sub, CPU_Z.sub + 5, mat(0x0b0c0f, { roughness: 0.7 })));
  const plain = spec.tier <= 1, top = plain ? grow(rim, -20) : grow(DIE, -24);
  if (plain) lid.add(softBox(rim, CPU_Z.sub + 2, CPU_Z.top, nickel, 22));
  else {
    lid.add(slab(shapeOf(outlinePts(rim, 30)), CPU_Z.sub + 2, CPU_Z.flange, nickel, 5));
    lid.add(softBox(top, CPU_Z.flange - 2, CPU_Z.top, nickel, 18));
  }
  const etch = etching(spec, top.w - 60, top.h - 60);
  if (etch) {
    const e = new Mesh(new PlaneGeometry(top.w - 60, top.h - 60), new MeshStandardMaterial({ map: etch, transparent: true, depthWrite: false, metalness: 0.5, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -2 }));
    e.position.set(top.x + top.w / 2, -(top.y + top.h / 2), CPU_Z.top + 0.5);
    lid.add(e);
  }
  g.add(lid);
  const centre = new Object3D();
  centre.position.set(DIE.x + DIE.w / 2, -(DIE.y + DIE.h / 2), CPU_Z.top);
  g.add(centre);
  return {
    root: g, lid, skin: [nickel], centre,
    die: { root: face.root, z: 3 / CPU_S },
    lod: (zoom) => {
      const a = smooth(DEVICE_LOD.die.fade[0], DEVICE_LOD.die.fade[1], zoom * CPU_S);
      fadeTree(lid, 1 - a);
      face.root.visible = a > 0.01;
    },
  };
}
