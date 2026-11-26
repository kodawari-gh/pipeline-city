import { BigPool, Container, Graphics, GraphicsContext, GraphicsContextRenderData, Texture } from 'pixi.js';
import { describe, expect, it, vi } from 'vitest';
import { ArtBaker, freeBakePools } from './bake';

function assert_destroys_each_Graphics_own_context_the_baker_s_r(): void {
  const outer = new Graphics().rect(0, 0, 10, 10).fill(0xff_00_00),
    inner = new Graphics().circle(5, 5, 3).fill(0x00_ff_00);
  const ctxs = [outer.context, inner.context];
  const art = new ArtBaker(() => {
    const c = new Container();
    c.addChild(outer, new Container().addChild(inner));
    return c;
  });
  expect(ctxs.every((c) => c instanceof GraphicsContext && !c.destroyed)).toBe(true);
  art.dispose();
  expect(outer.destroyed && inner.destroyed).toBe(true);
  expect(ctxs.map((c) => c.destroyed)).toStrictEqual([true, true]);
  art.dispose(); // (twice is safe)
}

describe('ArtBaker.dispose (PERF12)', () => {
  it("destroys each Graphics' own context: the baker's renderer keeps every context it drew until then", () => {
    expect.hasAssertions();
    assert_destroys_each_Graphics_own_context_the_baker_s_r();
  });

  it("frees Pixi's free pooled render data (each with its own batcher and buffers), not what is in use", () => {
    // (made bare: a batcher needs a WebGL test context, which the tests do not have)
    const pool = BigPool.getPool(GraphicsContextRenderData),
      used = new GraphicsContextRenderData(),
      free = new GraphicsContextRenderData();
    pool.return(free);
    expect(pool.totalFree).toBeGreaterThan(0);
    const freed = vi.spyOn(free, 'destroy').mockImplementation(() => {
        /* no-op */
      }),
      kept = vi.spyOn(used, 'destroy').mockImplementation(() => {
        /* no-op */
      });
    freeBakePools();
    expect(pool.totalFree).toBe(0);
    expect(freed).toHaveBeenCalledOnce();
    expect(kept).not.toHaveBeenCalled();
  });

  it('keeps the textures: the art may share them', () => {
    const tex = Texture.WHITE,
      g = new Graphics().rect(0, 0, 4, 4).fill({ texture: tex });
    const art = new ArtBaker(() => g);
    art.dispose();
    expect(tex.destroyed).toBe(false);
    expect(art.bake({ x: 0, y: 0, w: 4, h: 4 }, 1)).toBeNull();
  });
});
