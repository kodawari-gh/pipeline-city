import { describe, expect, it } from 'vitest';
import { Sight, type QueryGL } from './sight';

/** A query that answers `samples`, `delay` frames after it ended. */
function fakeGl(samples: () => boolean, delay = 0) {
  const q = {} as WebGLQuery;
  let left = -1, answer = false, begun = 0;
  const gl = {
    ANY_SAMPLES_PASSED_CONSERVATIVE: 1, QUERY_RESULT: 2, QUERY_RESULT_AVAILABLE: 3,
    createQuery: () => q,
    beginQuery: () => { begun++; }, endQuery: () => { left = delay; answer = samples(); },
    getQueryParameter: (_q: WebGLQuery, p: number) => (p === 3 ? left-- <= 0 : answer),
  } as unknown as QueryGL;
  return { gl, begun: () => begun };
}

/** A frame: hear the answer, then draw the quad. */
const frame = (s: Sight, gl: QueryGL, moved = false) => { s.frame(gl, moved); s.begin(gl); s.end(gl); };

describe('Sight', () => {
  it('says hidden once a query finds no samples', () => {
    const { gl } = fakeGl(() => false), s = new Sight();
    frame(s, gl);
    expect(s.hidden).toBe(false);
    s.frame(gl, false);
    expect(s.hidden).toBe(true);
  });

  it('stays clear while samples pass', () => {
    const { gl } = fakeGl(() => true), s = new Sight();
    for (let i = 0; i < 4; i++) frame(s, gl);
    expect(s.hidden).toBe(false);
  });

  it('clears at once when the eye moves, and drops the answer about the old eye', () => {
    const { gl } = fakeGl(() => false, 1), s = new Sight();
    frame(s, gl); frame(s, gl); frame(s, gl);
    expect(s.hidden).toBe(true);
    s.frame(gl, true);
    expect(s.hidden).toBe(false);
    frame(s, gl);
    expect(s.hidden).toBe(false);
  });

  it('clears when a thing moves off the window, the eye still', () => {
    let seen = false;
    const { gl } = fakeGl(() => seen), s = new Sight();
    frame(s, gl); frame(s, gl);
    expect(s.hidden).toBe(true);
    seen = true;
    frame(s, gl); s.frame(gl, false);
    expect(s.hidden).toBe(false);
  });

  it('asks one query at a time', () => {
    const { gl, begun } = fakeGl(() => true, 2), s = new Sight();
    frame(s, gl); frame(s, gl);
    expect(begun()).toBe(1);
    frame(s, gl); frame(s, gl);
    expect(begun()).toBe(2);
  });
});
