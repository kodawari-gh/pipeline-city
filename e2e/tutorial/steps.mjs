// The player's steps for tutorial.e2e.mjs: read the dialogue, check what the card shows, and use the Shop.
/// <reference path="../browser.d.ts" />
import { succeeds } from '../lib/run.mjs';
import { PlayerBase, log } from './player.mjs';

/**
 * In the page: the step's targets and the highlighted ids. `moved` when the card shows another step now.
 * @param {string} sid
 */
async function stepTargets(sid) {
  const { STEPS } = await import('/src/features/tutorial/ui/tutorial.ts');
  const { snapshot } = await import('/src/app/store.ts');
  const { highlight, dragging } = await import('/src/app/interaction.ts');
  const step = STEPS.find((x) => x.id === sid);
  // A short step can be over before it is checked (the first job takes a few seconds): then there is nothing to compare.
  const shown = document.querySelector('aside.tut');
  if (!(shown instanceof HTMLElement) || shown.dataset.step !== sid) {
    return { moved: true, want: [], have: [] };
  }
  if (!step || !snapshot.value) {
    throw new TypeError(`no step ${sid} or no game`);
  }
  return { moved: false, want: step.targets(snapshot.value, dragging.value), have: highlight.value };
}

/**
 * In the page: each highlighted id is on screen and free to press.
 * @param {string[]} have
 */
async function highlightProblems(have) {
  const { anchorOf } = await import('/src/features/tutorial/ui/anchor.ts');
  /** @type {string[]} */
  const out = [];
  const board = globalThis.__board;
  /** @param {string} h */
  const problemOf = (h) => {
    if (h.startsWith('hud:')) {
      return document.querySelector(`[data-hud="${h.slice(4)}"]`) ? null : `no ${h} element on screen`;
    }
    if (h.startsWith('inv:')) {
      return document.querySelector(`[data-inv~="${h.slice(4)}"]`) ? null : `no tile for ${h}`;
    }
    if (h === 'inventory' || h.startsWith('buy:')) {
      return null;
    }
    const a = anchorOf(h);
    if (!a) {
      return `${h} is not in the world`;
    }
    if (!a.visible) {
      return `${h} is highlighted but not visible`;
    }
    if (!h.startsWith('key:') || board?.idAt === undefined) {
      return null;
    }
    // A key is lifted by a press on it: nothing may stand over its middle (the chair's hoodie hid it once: the press then pans the view), no card either.
    const x = a.x + a.w / 2;
    const y = a.y + a.h / 2;
    const under = board.idAt(x, y);
    const el = document.elementFromPoint(x, y);
    return under !== h || el?.tagName !== 'CANVAS'
      ? `${h} is covered at its middle (${Math.round(x)}, ${Math.round(y)}): a press there meets ${under ?? 'nothing'} under ${String(el?.tagName)}.${String(el?.className)}`
      : null;
  };
  for (const h of have) {
    const problem = problemOf(h);
    if (problem !== null) {
      out.push(problem);
    }
  }
  return out;
}

/**
 * In the page: the card shows the step's title and text, and it is all on screen.
 * @param {string} sid
 */
async function cardProblems(sid) {
  const { STEPS } = await import('/src/features/tutorial/ui/tutorial.ts');
  const step = STEPS.find((x) => x.id === sid);
  if (!step) {
    throw new TypeError(`no step ${sid}`);
  }
  const card = document.querySelector('aside.tut');
  if (!card) {
    return ['no tutorial card'];
  }
  /** @type {string[]} */
  const out = [];
  const title = card.querySelector('.ptitle')?.textContent;
  if (title !== step.title) {
    out.push(`card title "${String(title)}" is not "${step.title}"`);
  }
  const typed = (document.querySelector('.dlg-text')?.textContent ?? '').trim();
  if (!typed || !step.text.includes(typed.slice(0, 40))) {
    out.push(`dialogue "${typed.slice(0, 40)}" is not the step's text`);
  }
  const r = card.getBoundingClientRect();
  if (r.top < 0 || r.bottom > innerHeight + 1 || r.left < 0 || r.right > innerWidth + 1) {
    out.push('the card is partly off screen');
  }
  return out;
}

export class Player extends PlayerBase {
  /**
   * Click through the dialogue like an impatient player (a click finishes typing, the next turns the page) until its last page is complete.
   * @param {number} [ms]
   */
  async waitTyped(ms = 4000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (await this.p.$('.dlg-arrow.end')) {
        return true;
      }
      await succeeds(this.p.click('.dlg', { timeout: 1500 }));
      await this.p.waitForTimeout(90);
    }
    return false;
  }

  /**
   * Held the way the game holds itself for a popup (not a player pause), so the screenshots show what a player sees: no "Paused" pill.
   * @param {boolean} open
   */
  async hold(open) {
    return this.p.evaluate(async (o) => {
      const m = await import('/src/core/ui/state.ts');
      m.pauseForTutorialPopup(o);
    }, open);
  }

  /**
   * What the player sees for this step must be this step's: card, text, highlights, no stacked popups.
   * @param {string} id
   */
  async validateStep(id) {
    // Hold the game: the state under test must not move while the text types and the camera flies. A step that already holds it (an explain-only step) stays held.
    const was = await this.p.evaluate(async () => {
      const m = await import('/src/app/store.ts');
      return m.speed.value;
    });
    if (was !== 0) {
      await this.hold(true);
    }
    try {
      await this.validateHeld(id);
    } finally {
      if (was !== 0) {
        await this.hold(false);
      }
    }
  }

  /** @param {string} id */
  async validateHeld(id) {
    await this.waitTyped();
    await this.p.waitForTimeout(1200); // the camera flight to the target
    if (await this.p.$('.lvl-card')) {
      return; // a level-up popup is read first; the card waits behind it
    }
    const targets = await this.p.evaluate(stepTargets, id);
    if (targets.moved) {
      log(`  (${id} had already moved on: not checked)`);
      return;
    }
    const { want, have } = targets;
    const out =
      JSON.stringify(want) === JSON.stringify(have)
        ? []
        : [`highlight ${JSON.stringify(have)} is not the step's targets ${JSON.stringify(want)}`];
    out.push(...(await this.p.evaluate(highlightProblems, have)), ...(await this.p.evaluate(cardProblems, id)));
    for (const o of out) {
      this.problems.push(`${id}: ${o}`);
      log(`  PROBLEM ${id}: ${o}`);
    }
    await this.stepShot(id);
  }

  /** Read the dialogue to its end (click through its pages), then press the primary button that appears. */
  async finishDialogue() {
    const t0 = Date.now();
    while (Date.now() - t0 < 8000 && !(await this.p.$('.dlg-actions.on'))) {
      await succeeds(this.p.click('.dlg', { timeout: 800 }));
      await this.p.waitForTimeout(100);
    }
    if (!(await succeeds(this.p.click('.dlg-actions.on button.primary', { timeout: 1500 })))) {
      log('  the dialogue never showed its button');
    }
    await this.p.waitForTimeout(400);
  }

  /** The welcome card: read its text (a click finishes the typing), then press its Next button (aside.tut, not a dialogue). */
  async nextWelcome() {
    await this.p.waitForSelector('aside.tut[data-step="welcome"] .pactions button.primary', { timeout: 20_000 });
    await this.waitTyped();
    try {
      await this.p.click('aside.tut[data-step="welcome"] .pactions button.primary', {
        timeout: 3000,
      });
    } catch (error) {
      log('  the welcome card never showed its Next button', String(error).slice(0, 700));
    }
  }

  /** Esc closes the Shop only while it is open: with nothing open it opens the Paused menu, and that hides the dock (and the Shop button) behind it. */
  async closeShop() {
    for (let i = 0; i < 3; i++) {
      let open = null;
      try {
        open = await this.p.$('.shop, .pl-menu.paused');
      } catch {
        open = null;
      }
      if (!open) {
        break;
      }
      await succeeds(this.p.keyboard.press('Escape'));
      await this.p.waitForTimeout(250);
    }
  }

  /** Open the Shop and press the glowing Buy tile in it. */
  async buyInShop() {
    // (a shop left open by an interrupted round covers its own button: close it first, and always close it again)
    await this.closeShop();
    try {
      await this.p.click('[data-hud=shop]', { timeout: 1500 });
      await this.p.waitForTimeout(700);
      const btn = await this.p.$('.shop .rung.pulse button.buy');
      if (btn) {
        await btn.evaluate((b) => {
          if (b instanceof HTMLElement) {
            b.click();
          }
        });
        await this.p.waitForTimeout(500);
      } else {
        log('  no glowing buy tile in the shop');
      }
    } finally {
      await this.closeShop();
      await this.p.waitForTimeout(150);
    }
  }
}
