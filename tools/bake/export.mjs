// The bake's room export (`bake.mjs`): the game in a headless Chrome on the dev server, and `scene.ts`'s `exportRoom` run in its page.
//   env: PORT (5199), CHROME_PATH
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright-core';

/** @import { BakeScene } from './blender' */

/**
 * An environment variable, or `d` when it is unset or empty.
 * @param {string} name
 * @param {string} d
 */
const env = (name, d) => {
  const v = process.env[name];
  return v === undefined || v === '' ? d : v;
};

/**
 * The dev server at `url`: the one running, or one started in `root` on `port` (null: it was running).
 * @param {string} url
 * @param {{ port: number; root: string }} at
 */
async function devServer(url, { port, root }) {
  const up = async () => {
    try {
      const res = await fetch(url);
      return res.ok;
    } catch {
      return false;
    }
  };
  if (await up()) {
    return null;
  }
  const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort'], {
    stdio: 'ignore',
    cwd: root,
  });
  for (let i = 0; i < 100 && !(await up()); i++) {
    await sleep(300);
  }
  return server;
}

/**
 * Wait for the menu's room and its models in the page.
 * @param {import('playwright-core').Page} p
 */
async function roomReady(p) {
  // The menu's room is the one to bake: the first board in the first case, as a new game has it. There each receiver has its exact hash;
  // with another tier the desk moves and the game finds those meshes by their count of corners (`applyLightmap`, ASSET-09). Do not start
  // a game first: the sandbox builds the largest tier a moment later, and the export would depend on when it ran.
  // (a fresh server first optimizes its dependencies: the menu can take a while)
  await p.waitForFunction(() => Boolean(globalThis.__board?.parts().room), null, { timeout: 120_000 });
  // the loaded models (the mouse, the hoodie) block light too: wait for them
  await p
    .waitForFunction(
      () => {
        const r = globalThis.__board?.parts().room?.root;
        return Boolean(r?.getObjectByName('mouse_1')) && Boolean(r?.getObjectByName('hoodie_1'));
      },
      null,
      { timeout: 60_000 },
    )
    .catch(() => {
      console.log('the models did not load: the bake goes on without them');
    });
  await p.waitForTimeout(1000);
}

/**
 * The room exported in the page (`scene.ts`).
 * @param {import('playwright-core').Page} p
 * @returns {Promise<BakeScene>}
 */
async function exportIn(p) {
  return p.evaluate(async () => {
    const at = '/tools/bake/scene.ts';
    /** @type {(v: unknown) => asserts v is typeof import('./scene').exportRoom} */
    const mustExport = (v) => {
      if (typeof v !== 'function') {
        throw new TypeError(`${at} exports no exportRoom`);
      }
    };
    /** @type {unknown} */
    const loaded = await import(at);
    /** @type {Record<string, unknown>} */
    const mod = typeof loaded === 'object' && loaded !== null ? loaded : {};
    const { exportRoom } = mod;
    mustExport(exportRoom);
    const parts = globalThis.__board?.parts(),
      room = parts?.room,
      machine = parts?.machine;
    if (!room || !machine) {
      throw new Error('the page has no room or no machine');
    }
    return exportRoom(
      {
        root: room.root,
        blinds: room.blinds,
        frame: (f, dt) => {
          room.frame(f, dt);
        },
        lightGroups: () => room.lightGroups(),
      },
      [machine.root],
    );
  });
}

/**
 * The room as the game builds it, from the dev server's page (the dev server in `root`, started when it is not running).
 * @param {string} root
 * @returns {Promise<BakeScene>}
 */
export async function exportScene(root) {
  const PORT = Number(env('PORT', '5199')),
    url = `http://localhost:${PORT}/`;
  const server = await devServer(url, { port: PORT, root });
  const chromePath = env('CHROME_PATH', '');
  const browser = await chromium.launch({
    headless: true,
    ...(chromePath === '' ? { channel: 'chrome' } : { executablePath: chromePath }),
    args: ['--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--enable-gpu-rasterization'],
  });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } }),
      p = await ctx.newPage();
    p.on('pageerror', (e) => {
      console.log('[page]', e.message);
    });
    await p.goto(`${url}?3d&nobaked`); // (`nobaked`: every map is a painted canvas, so `scene.ts` can read its mean colour; a KTX2 map has no pixels to read)
    await roomReady(p);
    return await exportIn(p);
  } finally {
    await browser.close();
    try {
      server?.kill();
    } catch {
      /* gone */
    }
  }
}
