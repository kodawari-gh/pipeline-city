import { ACESFilmicToneMapping, BoxGeometry, Mesh, MeshBasicMaterial, PerspectiveCamera, SRGBColorSpace, Scene, type WebGLRenderer } from 'three';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/graphics', () => ({ pixelRatio: (scale: number) => scale }));
const { Post, steps } = await import('./post');

/** The full-screen passes of a step list: all but the eye's small ones. */
const full = (s: string[]) => s.filter((x) => x !== 'eye').length;
const LOW = { ao: 0, bloom: 0, msaa: 0, scale: 0.6, brightness: 1 };
const HIGH = { ao: 2, bloom: 2, msaa: 4, scale: 1, brightness: 1 };

function stubRenderer(): WebGLRenderer {
  let ratio = 1;
  return {
    toneMapping: ACESFilmicToneMapping, outputColorSpace: SRGBColorSpace, toneMappingExposure: 1,
    getPixelRatio: () => ratio, setPixelRatio: (r: number) => { ratio = r; }, setSize: () => {},
  } as unknown as WebGLRenderer;
}

describe('the post chain', () => {
  it('runs only what is on: at Low with nothing picked, the scene, the eye and the finish', () => {
    expect(steps({ ao: false, outline: false, bloom: false, eye: true })).toEqual(['scene', 'eye', 'finish']);
    expect(full(steps({ ao: false, outline: false, bloom: false, eye: true }))).toBeLessThanOrEqual(3);
    // the board view: no eye, the finish only tone maps
    expect(steps({ ao: false, outline: false, bloom: false, eye: false })).toEqual(['scene', 'finish']);
  });

  it('copies the picture for the outline or the bloom, and the AO copies it as it blends', () => {
    expect(steps({ ao: false, outline: true, bloom: false, eye: true })).toEqual(['scene', 'copy', 'outline', 'eye', 'finish']);
    expect(steps({ ao: false, outline: false, bloom: true, eye: true })).toEqual(['scene', 'copy', 'bloom', 'eye', 'finish']);
    expect(steps({ ao: true, outline: true, bloom: true, eye: true })).toEqual(['scene', 'ao', 'outline', 'bloom', 'eye', 'finish']);
  });

  it('follows the settings, the pick and the view', () => {
    const r = stubRenderer();
    const post = new Post(r, new Scene(), new PerspectiveCamera(), 400, 300);
    post.apply(LOW, r, 400, 300);
    expect(r.getPixelRatio()).toBe(0.6);
    expect(post.steps()).toEqual(['scene', 'eye', 'finish']);
    const pick = new Mesh(new BoxGeometry(), new MeshBasicMaterial());
    post.setOutlined([pick]);
    expect(post.steps()).toEqual(['scene', 'copy', 'outline', 'eye', 'finish']);
    // the first frame after the pick ends drops the outline
    post.setOutlined([]);
    expect(post.steps()).toEqual(['scene', 'eye', 'finish']);
    post.setReach(0);
    expect(post.steps()).toEqual(['scene', 'finish']);
    post.setReach(40000);
    post.apply(HIGH, r, 400, 300);
    expect(post.steps()).toEqual(['scene', 'ao', 'bloom', 'eye', 'finish']);
  });
});
