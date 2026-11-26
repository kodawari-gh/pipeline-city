// The error states at the main menu, for errors.e2e.mjs: a corrupt file, offline, and the boot failure.
/// <reference path="../browser.d.ts" />
import { check } from '../lib/run.mjs';
import { NO_WEBGL, fileIn, judge, menuCovered, menuShown, noticeBox, shot } from './page.mjs';

/**
 * @typedef {import('./page.mjs').Session} Session
 * @typedef {import('./page.mjs').Size} Size
 * @typedef {import('./page.mjs').Open} Open
 */

/**
 * A file that is not JSON, at the main menu; on desktop also JSON that is no save of this version.
 * @param {Open} open
 * @param {string} tag
 * @param {Size} vp
 */
export async function corruptFile(open, tag, vp) {
  const s = await open(`corrupt ${tag}`, vp);
  await fileIn(s, 'not-a-save.json', 'this is not json {');
  await s.page.waitForSelector('.notice');
  await judge(s, {
    sel: '.notice > span',
    label: `corrupt file (${tag})`,
    words: ['not a Pipeline City save', 'Pick another file', 'menu'],
  });
  const box = await noticeBox(s);
  check(box !== null && box.l >= 0 && box.r <= box.w, `corrupt file (${tag}): the notice is inside the window`);
  check(
    await s.page.locator('.notice button[aria-label="Dismiss"]').isVisible(),
    `corrupt file (${tag}): the notice can be dismissed`,
  );
  check(await menuShown(s), `corrupt file (${tag}): the main menu is still there`);
  await shot(s, `corrupt-file-${tag}`);
  if (tag === 'desktop') {
    await s.page.click('.notice button[aria-label="Dismiss"]');
    await fileIn(s, 'old.json', '{"version":99}');
    await s.page.waitForSelector('.notice');
    await judge(s, {
      sel: '.notice > span',
      label: 'incompatible save',
      words: ['cannot be loaded', 'another version', 'Your save is unchanged', 'go back to the menu'],
    });
    check(await menuShown(s), 'incompatible save: the main menu is still there');
  }
  check(s.errors.length === 0, `corrupt file (${tag}): no page error (${s.errors.join(' | ')})`);
  await s.ctx.close();
}

/** @param {Open} open */
export async function offline(open) {
  const s = await open('offline', { width: 1920, height: 1080 });
  // (offline from the start, the page's own 3D world would fail to load: that is the boot failure screen. Here the world is up first.)
  await s.page.evaluate(
    `(async () => { const { booted } = await import('/src/app/boot.ts'); while (!booted.value) await new Promise((r) => setTimeout(r, 200)); })()`,
  );
  await s.ctx.setOffline(true);
  await s.page.waitForSelector('.notice');
  await judge(s, {
    sel: '.notice > span',
    label: 'offline',
    words: ['You are offline', 'still runs', 'Reconnect', 'reload the page'],
  });
  check(await menuShown(s), 'offline: the main menu is still there');
  await shot(s, 'offline');
  await s.ctx.setOffline(false);
  await s.page.waitForSelector('.notice', { state: 'detached' });
  check(true, 'offline: back online, the notice goes');
  await s.ctx.close();
}

/**
 * The words of the boot failure screen: what they say, their size and contrast, and that they fit the window.
 * @param {Session} s
 * @param {string} what
 */
async function judgeBootScreen(s, what) {
  await judge(s, {
    sel: '#boot .boot-stage',
    label: `${what}: the reason`,
    words: ['WebGL is not available'],
    overPicture: true,
  });
  await judge(s, {
    sel: '#boot .boot-help',
    label: `${what}: what to try`,
    words: ['Turn on hardware acceleration', 'try another browser'],
    overPicture: true,
  });
  await judge(s, { sel: '#boot .boot-retry', label: `${what}: the button`, words: ['Try again'] });
  check(await s.page.locator('#boot .boot-retry').isVisible(), `${what}: "Try again" is shown`);
  check(await menuCovered(s), `${what}: the boot screen covers the menu, so no game can start without a world`);
  const inside = await s.page.evaluate(() => ({
    sideways: document.documentElement.scrollWidth > innerWidth,
    out: ['.boot-stage', '.boot-help', '.boot-retry'].filter((q) => {
      const el = document.querySelector(`#boot ${q}`);
      if (!el) {
        throw new TypeError(`no element #boot ${q}`);
      }
      const r = el.getBoundingClientRect();
      return r.left < 0 || r.right > innerWidth;
    }),
  }));
  check(
    !inside.sideways && inside.out.length === 0,
    `${what}: the words are inside the window and nothing scrolls sideways (out: ${inside.out.join(', ') || 'none'})`,
  );
}

/**
 * A browser with no WebGL: the boot screen stays, says why and what to try; "Try again" reloads.
 * @param {Open} open
 * @param {string} tag
 * @param {Size} vp
 */
export async function bootFailure(open, tag, vp) {
  const s = await open(`boot failure ${tag}`, vp, { init: NO_WEBGL, until: '#boot.fail' });
  const what = `boot failure, no WebGL (${tag})`;
  // (the still fades in over 1.2 s: the contrast is read when it is all there)
  await s.page.waitForFunction(() => {
    const i = document.querySelector('.boot-still');
    return !i || (i.classList.contains('on') && getComputedStyle(i).opacity === '1');
  });
  check(
    (await s.page.locator('.boot-still.on').count()) === 1,
    `${what}: the picture is behind the text, so the contrast is read over it`,
  );
  await judgeBootScreen(s, what);
  await shot(s, `boot-failure-${tag}`);
  // "Try again" is a real way forward: it loads the page anew (here the browser still has no WebGL, so the screen comes back)
  await s.page.evaluate(() => {
    globalThis.__loadedBefore = true;
  });
  await s.page.click('#boot .boot-retry');
  await s.page.waitForFunction(
    () => globalThis.__loadedBefore !== true && document.querySelector('#boot.fail') !== null,
  );
  check(true, `${what}: "Try again" reloads the page`);
  check(
    s.errors.length > 0 && s.errors.every((e) => /webgl/iu.test(e)),
    `${what}: the only page errors are the renderer's own (${s.errors.join(' | ')})`,
  );
  await s.ctx.close();
}
