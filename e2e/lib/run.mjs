// Shared parts of the e2e scripts: environment options, the PASS/FAIL tally, the dev server and the Chrome to launch.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout as delay } from 'node:timers/promises';
import path from 'node:path';

/**
 * True when an environment variable's value (`process.env.NAME`) is set and not empty.
 * @param {string | undefined} v
 */
export function isSet(v) {
  return v !== undefined && v !== '';
}

/**
 * An environment variable's value (`process.env.NAME`), or `def` when it is unset or empty.
 * @param {string | undefined} v
 * @param {string} def
 */
export function stringOr(v, def) {
  return v === undefined || v === '' ? def : v;
}

/**
 * An environment variable's value (`process.env.NAME`) as a number, or `def` when it is unset or empty.
 * @param {string | undefined} v
 * @param {number} def
 */
export function numberOr(v, def) {
  return v === undefined || v === '' ? def : Number(v);
}

/** Chrome for `chromium.launch`: CHROME_PATH when set, else the installed Chrome. */
export const chrome = () => {
  const exe = process.env.CHROME_PATH;
  return exe === undefined || exe === '' ? { channel: 'chrome' } : { executablePath: exe };
};

/** @param {number} ms */
export const sleep = async (ms) => delay(ms);

/**
 * True when `action` settles without an error: a step that may fail without failing the run.
 * @param {Promise<unknown>} action
 */
export async function succeeds(action) {
  try {
    await action;
    return true;
  } catch {
    return false;
  }
}

let failures = 0;
/**
 * Print one PASS or FAIL line; a FAIL counts.
 * @param {boolean} ok
 * @param {string} what
 */
export function check(ok, what) {
  if (!ok) {
    failures++;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${what}`);
}
/** Count a failure that has no check line of its own. */
export function fail() {
  failures++;
}
export const failureCount = () => failures;

// vite is found through node's module lookup, so a script also runs from a worktree whose node_modules is not installed.
export const viteBin = path.join(
  path.dirname(createRequire(import.meta.url).resolve('vite/package.json')),
  'bin',
  'vite.js',
);

/** @param {string} url */
async function answers(url) {
  try {
    const r = await fetch(url);
    return r.ok;
  } catch {
    return false;
  }
}

const noop = () => {
  /* a reused server is left running */
};

/**
 * Start a dev server on `port` (--strictPort) and wait until it answers. With `reuse`, a server that already answers on
 * `port` is used and left running. With `exitOnSignal`, Ctrl+C or a kill stops the server and exits with 130.
 * Returns the function that stops the server; it also stops when the process exits.
 * @param {{ port: number, reuse?: boolean, bin?: string, stdio: import('node:child_process').StdioOptions, exitOnSignal?: boolean }} o
 */
export async function startDevServer({ port, reuse = false, bin = viteBin, stdio, exitOnSignal = false }) {
  const url = `http://localhost:${port}/`;
  if (reuse && (await answers(url))) {
    return noop;
  }
  const server = spawn(process.execPath, [bin, '--port', String(port), '--strictPort'], { stdio });
  const stop = () => {
    try {
      server.kill();
    } catch {
      /* already gone */
    }
  };
  process.on('exit', stop);
  if (exitOnSignal) {
    for (const sig of ['SIGINT', 'SIGTERM']) {
      process.on(sig, () => {
        stop();
        process.exit(130);
      });
    }
  }
  /** @type {{ code: number | null }} */
  const exit = { code: null };
  server.on('exit', (c) => {
    exit.code = c;
  });
  for (let i = 0; ; i++) {
    if (exit.code !== null) {
      throw new Error(`the dev server exited with ${exit.code}`);
    }
    if (i > 100) {
      throw new Error('the dev server did not start');
    }
    if (await answers(url)) {
      return stop;
    }
    await sleep(300);
  }
}
