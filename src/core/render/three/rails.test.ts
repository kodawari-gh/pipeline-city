import { describe, expect, it } from 'vitest';
import { heightAt, type OrbitView } from './camera';
import { LET_GO, NO_PULL, holdOn, keeps, over, pullOn, railUnder, takeZoom, type Rail } from './rails';

// a 1600 x 900 screen; a die 1000 x 800 at depth 2600, a small module beside it, the board under both
const H = 900, A = 16 / 9;
const DIE: Rail = { id: 'cpu', rect: { x: 0, y: 0, w: 1000, h: 800 }, z: 2600, zoom: 0.5 };
const TPM: Rail = { id: 'tpm', rect: { x: 1200, y: 100, w: 200, h: 300 }, z: 2560, zoom: 0.1 };
const CARD: Rail = { id: 'gpu', rect: { x: 0, y: 1500, w: 4000, h: 600 }, z: 2700, zoom: 0.4 };
const RAILS = [DIE, TPM, CARD];
/** A head-on view of the layout point (x, y) at depth z, `height` tall there. */
const at = (x: number, y: number, height: number, z = 5000): OrbitView => ({ x, y: -y, z, yaw: 0, pitch: 0, height, fov: 26 });
/** The view `height` tall on the die's plane, centred on the layout point (x, y), its target in front of the die (head on, the planes differ by a set height). */
const onDie = (x: number, y: number, height: number): OrbitView => { const v = at(x, y, height); return { ...v, height: 2 * height - heightAt(v, DIE.z) }; };

describe('rails', () => {
  it('a part takes the view once it fills about half the screen, and its detail shows', () => {
    // the die framed whole (a few times too far): no rail; closer, over it: the die's
    expect(railUnder(at(500, 400, 8000), RAILS, H, A)).toBeNull();
    const take = takeZoom(DIE, H, A);
    expect(take).toBeGreaterThan(DIE.zoom);
    expect(railUnder(at(500, 400, (H / take) * 0.99, DIE.z), RAILS, H, A)?.id).toBe('cpu');
    expect(railUnder(at(500, 400, (H / take) * 1.1, DIE.z), RAILS, H, A)).toBeNull();
    // over the module, close enough for it: the module's; off both: none
    expect(railUnder(at(1300, 250, 300, TPM.z), RAILS, H, A)?.id).toBe('tpm');
    expect(railUnder(at(1100, 1000, 300, TPM.z), RAILS, H, A)).toBeNull();
  });

  it('reads the zoom on the part\'s own plane, wherever the target is', () => {
    const v = onDie(500, 400, H / takeZoom(DIE, H, A) / 1.01);
    expect(v.z).not.toBe(DIE.z);
    expect(railUnder(v, RAILS, H, A)?.id).toBe('cpu');
  });

  it('skips the part the player pulled off', () => {
    const v = at(500, 400, 600, DIE.z);
    expect(railUnder(v, RAILS, H, A, 'cpu')).toBeNull();
  });

  it('centres a part smaller than the view, on its own plane', () => {
    const h = holdOn(at(800, 700, 1000), DIE, A);
    expect(h.z).toBeCloseTo(DIE.z);
    expect(h.x).toBeCloseTo(500);
    expect(h.y).toBeCloseTo(-400);
  });

  it('pans only over a part bigger than the view, along that side', () => {
    // a long card, about as tall as the view: x keeps to the card (its end a little inside the view's edge), y stays at its middle
    const v = at(3990, 1700, 700, CARD.z), h = holdOn(v, CARD, A), half = (700 * A) / 2;
    expect(h.y).toBeCloseTo(-1800);
    expect(h.x + half).toBeGreaterThan(4000);
    expect(h.x + half).toBeLessThan(4000 + 0.05 * 700);
    expect(holdOn(at(2000, 1800, 700, CARD.z), CARD, A).x).toBeCloseTo(2000);
  });

  it('gives at the edge, then lets go after a firm pull', () => {
    const v = holdOn(at(500, 400, 1000, DIE.z), DIE, A);
    let p = pullOn(v, DIE, A, NO_PULL, 40, 0);
    // a short pull moves the view a little (it gives) and is kept
    expect(p.free).toBe(false);
    expect(p.view.x).toBeGreaterThan(v.x);
    expect(p.view.x).toBeLessThan(v.x + 40);
    // pulling on lets go past a quarter of the screen's height, and the view goes the whole way
    let moved = 40;
    while (!p.free && moved < 1000) { p = pullOn(p.view, DIE, A, p.pull, 40, 0); moved += 40; }
    expect(p.free).toBe(true);
    expect(moved).toBeGreaterThan(0.25 * 1000);
    expect(moved).toBeLessThan(0.25 * 1000 + 80);
    expect(p.view.x).toBeCloseTo(v.x + moved);
  });

  it('lets go as the zoom falls past its band', () => {
    const take = takeZoom(DIE, H, A), v = (k: number) => at(500, 400, H / (take * k), DIE.z);
    expect(keeps(v(LET_GO * 1.05), DIE, H, A)).toBe(true);
    expect(keeps(v(LET_GO * 0.95), DIE, H, A)).toBe(false);
    expect(over(v(1), DIE)).toBe(true);
    expect(over(at(1100, 400, 500, DIE.z), DIE)).toBe(false);
  });
});
