import { describe, expect, it } from 'vitest';
import { MeshBasicMaterial, Scene, WebGLRenderTarget } from 'three';
import { disposeTree, fanSides, rectBox, worldUv } from './geometry';

/** The uvs of the box's face toward +z (BoxGeometry's fifth face) at its four corners, by corner position (x, y). */
function front(o: ReturnType<typeof rectBox>): Map<string, [number, number]> {
  const g = o.geometry,
    p = g.getAttribute('position'),
    uv = g.getAttribute('uv'),
    m = new Map<string, [number, number]>();
  for (let i = 16; i < 20; i++)
    m.set(`${p.getX(i) + o.position.x},${p.getY(i) + o.position.y}`, [uv.getX(i), uv.getY(i)]);
  return m;
}

describe('worldUv', () => {
  it('gives a narrow box and a wide one the same texture size, and runs on across boxes that meet', () => {
    const m = new MeshBasicMaterial();
    const narrow = front(worldUv(rectBox({ x: 0, y: 0, w: 1000, h: 8000 }, 0, 100, m), 2000));
    const wide = front(worldUv(rectBox({ x: 1000, y: 0, w: 6000, h: 8000 }, 0, 100, m), 2000));
    // (2D y down: the box's world y runs from 0 down to -8000)
    expect(narrow.get('0,0')).toEqual([0, 0]);
    expect(narrow.get('1000,-8000')).toEqual([0.5, -4]);
    expect(wide.get('1000,0')).toEqual(narrow.get('1000,0'));
    expect(wide.get('7000,-8000')).toEqual([3.5, -4]);
  });
});

describe('disposeTree', () => {
  it('never frees a render target texture, even with textures=true, so a probe kept as envMap survives a rebuild', () => {
    const target = new WebGLRenderTarget(4, 4);
    const tex = target.texture;
    expect(tex.isRenderTargetTexture).toBe(true);
    const scene = new Scene();
    scene.environment = tex;
    const mat = new MeshBasicMaterial();
    mat.envMap = tex;
    let disposed = 0;
    tex.addEventListener('dispose', () => {
      disposed++;
    });
    const mesh = rectBox({ x: 0, y: 0, w: 10, h: 10 }, 0, 10, mat);
    scene.add(mesh);
    disposeTree(scene);
    disposeTree(scene, true);
    // rebuild: the same probe is still the envMap and the environment
    const next = rectBox({ x: 0, y: 0, w: 10, h: 10 }, 0, 10, mat);
    scene.add(next);
    disposeTree(scene);
    expect(disposed).toBe(0);
    target.dispose();
  });
});

describe('fanSides', () => {
  it('sets the sides by diameter: 16 at 40 mm, 24 at 92 mm, 32 at 120 mm, 40 or more at 140 mm', () => {
    expect(fanSides(40)).toBe(16);
    expect(fanSides(80)).toBe(24);
    expect(fanSides(92)).toBe(24);
    expect(fanSides(120)).toBe(32);
    expect(fanSides(140)).toBeGreaterThanOrEqual(40);
  });

  it('stays even and inside 16..48, and never falls as the diameter grows', () => {
    let last = 0;
    for (let mm = 1; mm <= 400; mm++) {
      const s = fanSides(mm);
      expect(s % 2).toBe(0);
      expect(s).toBeGreaterThanOrEqual(16);
      expect(s).toBeLessThanOrEqual(48);
      expect(s).toBeGreaterThanOrEqual(last);
      last = s;
    }
  });
});
