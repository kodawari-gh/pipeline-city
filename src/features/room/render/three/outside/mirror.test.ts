import { describe, expect, it } from 'vitest';
import { BoxGeometry, Color, Group, Mesh, MeshBasicMaterial, MeshLambertMaterial, MeshStandardMaterial, Scene } from 'three';
import { cheapMaterials } from '@/core/render/three/cheapmaterials';
import { glowOnly } from './mirror';

describe('glowOnly on a cheap mesh', () => {
  it('caps the glow through the Lambert, on the source; the undo gives it back', () => {
    const src = new MeshStandardMaterial({ emissive: new Color(0xff0000), emissiveIntensity: 2 });
    const mesh = new Mesh(new BoxGeometry(), src), scene = new Scene().add(new Group().add(mesh));
    const h = cheapMaterials(scene), l = mesh.material as unknown as MeshLambertMaterial;
    const back = glowOnly(scene, [new MeshBasicMaterial()]);
    expect(l.emissiveIntensity).toBeCloseTo(0.08, 6);
    expect(src.emissiveIntensity).toBeCloseTo(0.08, 6);
    back();
    expect(l.emissiveIntensity).toBe(2);
    expect(src.emissiveIntensity).toBe(2);
    h.undo();
  });
});
