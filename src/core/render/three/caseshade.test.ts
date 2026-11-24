import { describe, expect, it } from 'vitest';
import {
  Box3,
  BoxGeometry,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshStandardMaterial,
  ShaderLib,
  Vector3,
} from 'three';
import { CASE_SHADE, caseShadePatch, caseShaded, setCaseShade, type CasePass } from './caseshade';

/** The GLSL `caseShade` in TypeScript: the share of a light toward `dir` at the world point `at`. */
function shade(at: Vector3, dir: Vector3): number {
  const inv = CASE_SHADE.inv.value,
    p = at.clone().applyMatrix4(inv),
    d = dir.clone().transformDirection(inv);
  if (Math.max(Math.abs(p.x), Math.abs(p.y), Math.abs(p.z)) >= 1) return 1;
  const ax = (['x', 'y', 'z'] as const).map((k) => ({
    t: ((d[k] >= 0 ? 1 : -1) - p[k]) / (Math.abs(d[k]) < 1e-6 ? (d[k] >= 0 ? 1e-6 : -1e-6) : d[k]),
    pass: (d[k] >= 0 ? CASE_SHADE.plus : CASE_SHADE.minus).value[k],
  }));
  return ax.reduce((a, b) => (b.t < a.t ? b : a)).pass;
}

describe('the case shades its inside from the spot lights (Low, no shadow map)', () => {
  const pass: CasePass = { plus: [0, 0.2, 0.75], minus: [0, 0, 0] },
    box = new Box3(new Vector3(0, 0, 0), new Vector3(4, 6, 2));
  setCaseShade(box, new Matrix4().makeTranslation(10, 0, 0), pass);

  it("maps the box in the root's frame to the cube -1..1", () => {
    expect(
      new Vector3(10, 0, 0)
        .applyMatrix4(CASE_SHADE.inv.value)
        .toArray()
        .map((v) => +v.toFixed(6)),
    ).toEqual([-1, -1, -1]);
    expect(
      new Vector3(14, 6, 2)
        .applyMatrix4(CASE_SHADE.inv.value)
        .toArray()
        .map((v) => +v.toFixed(6)),
    ).toEqual([1, 1, 1]);
  });

  it('lets a light in by the face its ray leaves through: the glass side, the top filter, not the steel', () => {
    const mid = new Vector3(12, 3, 1);
    expect(shade(mid, new Vector3(0, 0, 1))).toBe(0.75);
    expect(shade(mid, new Vector3(0, 1, 0))).toBe(0.2);
    expect(shade(mid, new Vector3(0, 0, -1))).toBe(0);
    expect(shade(mid, new Vector3(-1, 0, 0))).toBe(0);
    // (a slanted ray: near the glass it leaves by the glass, near the floor of the box by the back wall)
    expect(shade(new Vector3(12, 3, 1.9), new Vector3(1, 0, 1).normalize())).toBe(0.75);
    expect(shade(new Vector3(13.9, 3, 0.1), new Vector3(1, 0, 1).normalize())).toBe(0);
  });

  it('leaves what is outside the case as it is', () => {
    expect(shade(new Vector3(0, 3, 1), new Vector3(0, 0, -1))).toBe(1);
    expect(shade(new Vector3(12, 7, 1), new Vector3(-1, 0, 0))).toBe(1);
  });

  it('patches the spot light loop of a Lambert and of a standard material, once', () => {
    for (const lib of [ShaderLib.lambert, ShaderLib.standard]) {
      const sh = { fragmentShader: lib.fragmentShader, uniforms: {} as Record<string, unknown> };
      expect(caseShadePatch(sh)).toBe(true);
      expect(sh.fragmentShader).toContain('directLight.color *= caseShade( geometryPosition, directLight.direction );');
      expect(sh.fragmentShader).toContain('float caseShade(');
      expect(sh.fragmentShader).not.toContain('#include <lights_fragment_begin>');
      expect(sh.uniforms['uCaseInv']).toBe(CASE_SHADE.inv);
      expect(caseShadePatch(sh)).toBe(false); // (its loop is replaced already)
    }
  });

  it('shades the lit materials under a root, gives each a program of its own, and undoes it', () => {
    const root = new Group(),
      std = new MeshStandardMaterial(),
      lam = new MeshLambertMaterial(),
      basic = new MeshBasicMaterial();
    root.add(
      new Mesh(new BoxGeometry(), std),
      new Mesh(new BoxGeometry(), [lam, basic]),
      new Mesh(new BoxGeometry(), std),
    );
    const key = std.customProgramCacheKey(),
      before = std.onBeforeCompile,
      basicBefore = basic.onBeforeCompile;
    const s = caseShaded(root);
    expect(std.customProgramCacheKey()).toBe(`${key}|case`);
    expect(lam.customProgramCacheKey()).toContain('|case');
    expect(basic.onBeforeCompile).toBe(basicBefore);
    const sh = { fragmentShader: ShaderLib.standard.fragmentShader, vertexShader: '', uniforms: {} };
    std.onBeforeCompile(sh as never, undefined as never);
    expect(sh.fragmentShader).toContain('caseShade( geometryPosition');
    // a second root with the same material does not patch it twice
    const other = new Group();
    other.add(new Mesh(new BoxGeometry(), std));
    caseShaded(other);
    expect(std.customProgramCacheKey()).toBe(`${key}|case`);
    // a new mesh is picked up by sync
    const late = new MeshStandardMaterial();
    root.add(new Mesh(new BoxGeometry(), late));
    s.sync();
    expect(late.customProgramCacheKey()).toContain('|case');
    s.undo();
    expect(std.customProgramCacheKey()).toBe(key);
    expect(std.onBeforeCompile).toBe(before);
    expect(late.customProgramCacheKey()).not.toContain('|case');
  });
});
