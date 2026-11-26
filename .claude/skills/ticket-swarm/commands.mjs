// Swarm CLI commands that need no runner: gc, the parent branch, the machine-wide lock, retry.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { getIssue, run } from '../update-gh-board/board.mjs';
import { sleep, git, gitOk } from './proc.mjs';
import { removeWorktree, gcDeps } from './deps.mjs';

/** Remove the worktrees and branches of closed tickets; keep those of open ones. */
export function gc(cfg) {
  const { root } = cfg;
  const out = [];
  const branches = git(root, 'branch', '--format=%(refname:short)')
    .split(/\r?\n/u)
    .filter((b) => /^ticket\/\d+/u.test(b));
  const nums = [...new Set(branches.map((b) => Number(/^ticket\/(?<n>\d+)/u.exec(b).groups.n)))];
  for (const n of nums) {
    if (getIssue(cfg, n).state === 'OPEN') {
      out.push(`keep #${n} (open)`);
      continue;
    }
    for (const role of ['coder', 'tester', 'merge']) {
      const p = path.join(root, '.claude', 'worktrees', `t${n}-${role}`);
      if (!removeWorktree(root, cfg.swarm?.shareDeps, p)) {
        out.push(`could not remove ${p} (in use)`);
      }
    }
    for (const br of branches.filter((b) => b === `ticket/${n}` || b.startsWith(`ticket/${n}-`))) {
      gitOk(root, 'branch', '-D', br);
    }
    out.push(`removed #${n} worktrees and branches`);
  }
  const wipRefs = git(root, 'for-each-ref', '--format=%(refname)', 'refs/swarm/wip/');
  for (const ref of wipRefs.split(/\r?\n/u).filter(Boolean)) {
    const n = Number(/wip\/(?<n>\d+)-/u.exec(ref)?.groups?.n);
    if (n && getIssue(cfg, n).state !== 'OPEN') {
      gitOk(root, 'update-ref', '-d', ref);
      out.push(`removed ${ref}`);
    }
  }
  gitOk(root, 'worktree', 'prune');
  if (cfg.swarm?.shareDeps) {
    out.push(...gcDeps(cfg));
  }
  return out;
}
/** The parent's base branch parent/<n>, made from `from` when missing. Never checked out. */
export function parentBranch(root, parent, from) {
  const b = `parent/${parent}`;
  if (!gitOk(root, 'rev-parse', '--verify', `refs/heads/${b}`)) {
    git(root, 'branch', b, from);
  }
  return b;
}
export async function lock(name, cmd) {
  const common = path.resolve(run('git', ['rev-parse', '--git-common-dir']));
  const dir = path.join(tmpdir(), `swarm-${createHash('sha1').update(common).digest('hex').slice(0, 10)}-${name}.lock`);
  const staleMs = 30 * 60e3;
  for (let waited = 0; ; waited++) {
    try {
      mkdirSync(dir);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST') {
        throw error;
      }
      let dead = false;
      try {
        const o = JSON.parse(readFileSync(path.join(dir, 'owner.json'), 'utf8'));
        try {
          process.kill(o.pid, 0);
        } catch {
          dead = true;
        }
        if (Date.now() - o.t > staleMs) {
          dead = true;
        }
      } catch {
        dead = Date.now() - statSync(dir).mtimeMs > 60e3;
      }
      if (dead) {
        rmSync(dir, { recursive: true, force: true });
        continue;
      }
      if (waited % 30 === 0) {
        console.error(`[lock ${name}] waiting...`);
      }
      await sleep(2000);
    }
  }
  writeFileSync(path.join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, t: Date.now(), cmd }));
  const release = () => rmSync(dir, { recursive: true, force: true });
  process.on('SIGINT', () => {
    release();
    process.exit(130);
  });
  const code = await new Promise((resolve) => {
    spawn(cmd, { shell: true, stdio: 'inherit' }).on('close', resolve);
  });
  release();
  process.exit(code ?? 1);
}
/** Mark a stopped ticket to resume on the next run, from the branches its stop kept. */
export function retry(cfg, key, n) {
  const f = path.join(cfg.root, '.claude', 'swarm', `${key}.json`);
  const s = existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null;
  const T = s?.tickets[n];
  if (!T || ['done', 'new', 'resume', 'running'].includes(T.phase)) {
    throw new Error(`retry: #${n} in ${key} is not a stopped ticket`);
  }
  T.phase = 'resume';
  delete T.reason;
  writeFileSync(f, JSON.stringify(s, null, 2));
  console.log(`#${n} will resume at round ${T.rounds + 1} on the next run`);
}
