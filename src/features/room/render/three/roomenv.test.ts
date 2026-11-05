import { describe, expect, it } from 'vitest';
import { Group, Mesh, MeshStandardMaterial, PlaneGeometry, Texture } from 'three';
import { boxEnv } from '@/core/render/three/boxenv';
import { RoomEnv } from './roomenv';

const studio = new Texture(), probe = new Texture();
const room = (...ms: MeshStandardMaterial[]) => { const g = new Group(); for (const m of ms) g.add(new Mesh(new PlaneGeometry(), m)); return g; };
const fresh = () => new RoomEnv(studio, boxEnv([0, 0, 0], [1, 1, 1], [0.5, 0.5, 0.5]));

describe('the room\'s reflections', () => {
  it('a material that comes late takes the map, the strength and the box of the rest', () => {
    const e = fresh(), early = new MeshStandardMaterial();
    e.adopt(room(early));
    e.setStrength(0.2);
    e.setMap(probe);
    const late = new MeshStandardMaterial();
    e.adopt(room(late));
    expect(late.envMap).toBe(probe);
    expect(late.envMapIntensity).toBe(0.2);
    expect(late.customProgramCacheKey()).toContain('|box');
  });

  it('a clone of a room material keeps a stale map; it joins the room and takes the probe', () => {
    const e = fresh(), shell = new MeshStandardMaterial();
    e.adopt(room(shell));
    const skin = shell.clone();
    e.setMap(probe);
    expect(skin.envMap).toBe(studio);
    e.adopt(room(skin));
    expect(skin.envMap).toBe(probe);
    expect(e.mats.has(skin)).toBe(true);
  });

  it('a map of its own stays; a material is patched once however often it is adopted', () => {
    const e = fresh(), own = new Texture(), mirror = new MeshStandardMaterial({ envMap: own }), plain = new MeshStandardMaterial();
    const g = room(mirror, plain);
    e.adopt(g);
    e.adopt(g);
    expect(mirror.envMap).toBe(own);
    expect(e.mats.has(mirror)).toBe(false);
    expect(plain.customProgramCacheKey().split('|box').length).toBe(2);
  });
});
