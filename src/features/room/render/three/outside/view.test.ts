import { describe, expect, it } from 'vitest';
import { QUAD_FRAG } from './view';

describe('the window quad', () => {
  // drawn in the game scene, its colour takes the tone mapping and the screen's colour space as the finish does (the direct draw at Low)
  it('tone maps and colour-converts its output, as a no-op into a target', () => {
    expect(QUAD_FRAG).toContain('#include <tonemapping_fragment>');
    expect(QUAD_FRAG).toContain('#include <colorspace_fragment>');
    expect(QUAD_FRAG.indexOf('#include <tonemapping_fragment>')).toBeGreaterThan(QUAD_FRAG.indexOf('gl_FragColor = vec4(c, 1.0);'));
  });
});
