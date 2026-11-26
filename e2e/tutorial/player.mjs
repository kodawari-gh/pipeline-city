// The player's hands for tutorial.e2e.mjs: screenshots, reads of the game state, and the mouse drags and clicks a player makes.
/// <reference path="../browser.d.ts" />
import { isSet } from '../lib/run.mjs';

/**
 * @typedef {import('playwright-core').Page} Page
 * @typedef {{ x: number, y: number }} Point
 * @typedef {{ page: Page, width: number, height: number, shots: URL }} PlayerOptions
 */

/** @param {...unknown} a */
export const log = (...a) => {
  console.log(...a);
};

/** @param {{ x: number, y: number, w: number, h: number }} a */
export const center = (a) => ({ x: a.x + a.w / 2, y: a.y + a.h / 2 });

/**
 * True when `v` has the shape of a screen anchor.
 * @param {unknown} v
 * @returns {v is ScreenAnchor}
 */
const isAnchor = (v) => typeof v === 'object' && v !== null && 'x' in v && 'y' in v && 'w' in v && 'h' in v;

/** The cable plug's press points, as fractions of its rectangle: the middle first, then near each side. */
const PRESS_AT = [
  [0.5, 0.5],
  [0.9, 0.5],
  [0.1, 0.5],
  [0.5, 0.2],
  [0.5, 0.9],
];

export class PlayerBase {
  /** @param {PlayerOptions} o */
  constructor({ page, width, height, shots }) {
    this.p = page;
    this.W = width;
    this.H = height;
    this.shots = shots;
    this.shotN = 0;
    /** @type {string[]} */
    this.problems = [];
  }

  /** @param {string} name */
  async shot(name) {
    return this.p.screenshot({
      path: new URL(`${name}.png`, this.shots).pathname.replace(/^\/(?<drive>[A-Za-z]:)/u, '$<drive>'),
    });
  }

  /**
   * @param {string} id
   * @param {string} [tag]
   */
  async stepShot(id, tag = '') {
    this.shotN++;
    return this.shot(`${String(this.shotN).padStart(2, '0')}-${id}${tag}`);
  }

  async snap() {
    return this.p.evaluate(async () => {
      const m = await import('/src/app/store.ts');
      return structuredClone(m.snapshot.value);
    });
  }

  /** @param {string} id */
  async anchor(id) {
    return this.p.evaluate(async (i) => {
      const m = await import('/src/features/tutorial/ui/anchor.ts');
      return m.anchorOf(i);
    }, id);
  }

  async stepId() {
    return this.p.evaluate(() => {
      const card = document.querySelector('aside.tut');
      return card instanceof HTMLElement ? (card.dataset.step ?? null) : null;
    });
  }

  async dragging() {
    return this.p.evaluate(async () => {
      const m = await import('/src/app/interaction.ts');
      return m.dragging.value;
    });
  }

  /** @param {number} n */
  async setSpeed(n) {
    return this.p.evaluate(async (v) => {
      const m = await import('/src/app/store.ts');
      m.setSpeed(v);
    }, n);
  }

  /**
   * @param {Point} from
   * @param {Point} to
   */
  async dragTo(from, to) {
    const { mouse } = this.p;
    await mouse.move(from.x, from.y);
    await mouse.down();
    await mouse.move(from.x + 12, from.y + 6, { steps: 4 });
    await mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 8 });
    await mouse.move(to.x, to.y, { steps: 8 });
    await this.p.waitForTimeout(150);
    await mouse.up();
    await this.p.waitForTimeout(400);
  }

  /**
   * @param {string} invId
   * @param {string} slotId
   */
  async dragPart(invId, slotId) {
    const tile = await this.p.$(`[data-inv="${invId}"]`);
    const a = await this.anchor(slotId);
    if (!tile || !a) {
      log('  cannot drag', invId, slotId, tile !== null, a !== null);
      return false;
    }
    const bb = await tile.boundingBox();
    if (!bb) {
      throw new Error(`the tile of ${invId} is not shown`);
    }
    // A big target (the heatsink's fan spot fills the view) can have its centre off screen: drop on the part of it in view, above the shelf.
    const x0 = Math.max(a.x, 0);
    const x1 = Math.min(a.x + a.w, this.W);
    const y0 = Math.max(a.y, 60);
    const y1 = Math.min(a.y + a.h, this.H - 320);
    await this.dragTo(
      { x: bb.x + bb.width / 2, y: bb.y + bb.height / 2 },
      x1 > x0 && y1 > y0 ? { x: (x0 + x1) / 2, y: (y0 + y1) / 2 } : center(a),
    );
    return true;
  }

  /**
   * DEBUG_DRAG: what is under a press on the plug.
   * @param {string} kind
   * @param {{ a: ScreenAnchor, t: ScreenAnchor, from: Point }} at
   */
  async logPress(kind, { a, t, from }) {
    const xy = [from.x, from.y];
    const idUnder = await this.p.evaluate(([x, y]) => globalThis.__board?.idAt?.(x, y, true) ?? null, xy);
    const element = await this.p.evaluate(([x, y]) => {
      const e = document.elementFromPoint(x, y);
      return e ? `${e.tagName}.${e.className}` : null;
    }, xy);
    log(
      '  cable',
      kind,
      'plug',
      JSON.stringify(a),
      'socket',
      JSON.stringify(t),
      'id under press',
      idUnder,
      'element',
      element,
    );
  }

  /** DEBUG_DRAG: the label and the ghost while the plug is held near its socket. */
  async logHeld() {
    const label = await this.p.evaluate(
      () =>
        /(?:Plug into|Let go to plug|Pull it out|No card)[^\n]*/u.exec(document.body.textContent ?? '')?.[0] ?? null,
    );
    const ghost = await this.p.evaluate(() =>
      [...document.querySelectorAll('div')]
        .filter((d) => d.style.position === 'fixed' && d.style.zIndex === '60')
        .map((d) => d.textContent),
    );
    log('  held label near socket:', JSON.stringify(label), 'ghost:', JSON.stringify(ghost));
  }

  /**
   * Drag a cable's plug onto its own socket (the second rect of the cable id), not onto the device it sits on.
   * @param {string} kind
   */
  async dragCable(kind) {
    const a = await this.anchor(`cable.${kind}`);
    // (anchor.ts does not export anchorsOf since #93, so this call throws today and the step logs "action interrupted": see #119)
    /** @type {unknown} */
    const t = await this.p.evaluate(
      `(async () => (await import('/src/features/tutorial/ui/anchor.ts')).anchorsOf(${JSON.stringify(`cable.${kind}`)})[1] ?? null)()`,
    );
    if (!a || !isAnchor(t)) {
      log('  cable anchors missing', kind, a !== null, t !== null);
      return false;
    }
    const debug = isSet(process.env.DEBUG_DRAG);
    const { mouse } = this.p;
    for (const [fx, fy] of PRESS_AT) {
      const from = { x: a.x + a.w * fx, y: a.y + a.h * fy };
      if (debug) {
        await this.logPress(kind, { a, t, from });
      }
      await mouse.move(from.x, from.y);
      await mouse.down();
      await mouse.move(from.x + 14, from.y + 8, { steps: 4 });
      if ((await this.dragging()) !== null) {
        await mouse.move(center(t).x, center(t).y, { steps: 14 });
        await this.p.waitForTimeout(200);
        if (debug) {
          await this.logHeld();
        }
        await mouse.up();
        await this.p.waitForTimeout(400);
        if (debug) {
          await this.p.waitForTimeout(1500);
          const s = await this.snap();
          log('  after drop connected:', JSON.stringify(s?.cables.map((c) => `${c.id}:${c.connected}`)));
        }
        return true;
      }
      await mouse.up();
      await this.p.waitForTimeout(150);
    }
    return false;
  }

  /** @param {string} id */
  async clickAnchor(id) {
    const a = await this.anchor(id);
    if (!a) {
      return false;
    }
    await this.p.mouse.click(center(a).x, center(a).y);
    await this.p.waitForTimeout(500);
    return true;
  }

  /**
   * Plug the next runnable key into the port: what a player does while a step waits.
   * @param {GameSnapshot} s
   */
  async serve(s) {
    if (s.plugged) {
      return false;
    }
    const k = s.tray.find((x) => x.runnable);
    if (!k) {
      return false;
    }
    const a = await this.anchor(`key:${k.id}`);
    const u = await this.anchor('usb');
    if (!a || !u) {
      return false;
    }
    await this.dragTo(center(a), center(u));
    return true;
  }
}
