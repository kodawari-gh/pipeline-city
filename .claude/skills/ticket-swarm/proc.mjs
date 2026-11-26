// Process helpers for the swarm runner: child processes, git, a lock file, waits.
import { spawn, spawnSync } from 'node:child_process';
import { writeFileSync, rmSync, statSync } from 'node:fs';
import { run } from '../update-gh-board/board.mjs';
import { StopError } from './errors.mjs';

export const sleep = async (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
export const stamp = () => new Date().toTimeString().slice(0, 5);

/** Wait for every worker before a stop, so none is cut off mid-commit. */
export async function settleWorkers(jobs, blockers) {
  const settled = await Promise.allSettled(jobs);
  const err = settled.find((r) => r.status === 'rejected');
  if (err) {
    throw err.reason;
  }
  if (blockers.length > 0) {
    throw new StopError(blockers.join(' | '), 'blocked');
  }
}

/** Live child processes. The runner kills them on exit, so no agent outlives it in a worktree. */
const live = new Set();
function killTree(p) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/pid', String(p.pid), '/T', '/F'], { windowsHide: true });
  } else {
    p.kill('SIGKILL');
  }
}
process.on('exit', () => {
  for (const p of live) {
    killTree(p);
  }
});

export async function sh(cmd, args, { cwd, input, timeoutMs, shell = false } = {}) {
  return new Promise((resolve) => {
    const p = spawn(cmd, args, { cwd, shell, windowsHide: true });
    live.add(p);
    let out = '',
      err = '',
      timedOut = false;
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.stderr.on('data', (d) => {
      err += d;
    });
    const t = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killTree(p);
        }, timeoutMs)
      : null;
    p.on('error', (e) => {
      err += String(e);
    });
    p.on('close', (code) => {
      live.delete(p);
      if (t) {
        clearTimeout(t);
      }
      resolve({ code: timedOut ? -1 : code, out, err, timedOut });
    });
    if (input === undefined || input === null) {
      p.stdin.end();
    } else {
      p.stdin.end(input);
    }
  });
}
export const git = (cwd, ...args) => run('git', args, { cwd });
export const gitOk = (cwd, ...args) => {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
};
/** Exclusive lock file; a lock older than 30 minutes is stale and taken over. */
export async function takeLock(file) {
  for (;;) {
    try {
      writeFileSync(file, String(process.pid), { flag: 'wx' });
      return;
    } catch {
      try {
        if (Date.now() - statSync(file).mtimeMs > 30 * 60e3) {
          rmSync(file, { force: true });
        }
      } catch {
        // The holder released it between the two calls.
      }
      await sleep(2000);
    }
  }
}
