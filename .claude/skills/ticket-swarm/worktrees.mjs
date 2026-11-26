// Swarm worktrees: one per ticket role, their dependency installs, cleanup, saved work and the repo gates.
import { existsSync, readFileSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import path from 'node:path';
import { run } from '../update-gh-board/board.mjs';
import { StopError } from './errors.mjs';
import { sh, git, gitOk, takeLock } from './proc.mjs';
import { depsHash, depsDir, depsMarker, isLink, removeDir, removeWorktree } from './deps.mjs';
import { SELF } from './agents.mjs';
import { SwarmBase, ticketBranch } from './base.mjs';

/** Abort a merge in progress and drop uncommitted changes in worktree `p`. */
export function cleanWorktree(p) {
  if (existsSync(path.join(p, '.git')) && gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
    gitOk(p, 'merge', '--abort');
  }
  git(p, 'reset', '--hard', 'HEAD');
}

export class SwarmWorktrees extends SwarmBase {
  async ensureWorktrees(n) {
    const fresh = [];
    for (const role of this.roles(n)) {
      const p = this.wt(n, role),
        b = ticketBranch(n, role);
      if (existsSync(path.join(p, '.git'))) {
        continue;
      }
      // A folder without .git is a leftover of a failed removal: git there would act on the main checkout.
      if (!removeWorktree(this.root, this.sw.shareDeps, p)) {
        throw new StopError(`${p} is a leftover folder in use`, 'critical');
      }
      gitOk(this.root, 'worktree', 'prune');
      if (gitOk(this.root, 'rev-parse', '--verify', `refs/heads/${b}`)) {
        git(this.root, 'worktree', 'add', p, b);
      } else {
        git(this.root, 'worktree', 'add', p, '-b', b, this.base);
      }
      fresh.push(p);
    }
    if (!this.sw.install) {
      return;
    }
    if (this.sw.shareDeps) {
      for (const role of this.roles(n)) {
        await this.ensureDeps(n, this.wt(n, role));
      }
      return;
    }
    if (fresh.length > 0) {
      this.emit(`#${n} install in ${fresh.length} worktree(s)`);
      const rs = await Promise.all(
        fresh.map(async (p) => sh(this.sw.install, [], { cwd: p, shell: true, timeoutMs: 20 * 60e3 })),
      );
      const bad = rs.findIndex((r) => r.code !== 0);
      if (bad !== -1) {
        throw new StopError(`install failed in ${fresh[bad]}: ${rs[bad].err.slice(-300)}`, 'critical');
      }
    }
  }

  // ---------- shared dependencies (swarm.shareDeps: { keys, dirs }) ----------

  /**
   * Link the worktree's dependency dirs to one install per hash of its key files.
   * The install runs once in a detached worktree at `.claude/worktrees/deps-<hash>`.
   * A worktree that holds a private install (`swarm.mjs deps`) keeps it while its key files are unchanged.
   */
  async ensureDeps(n, p) {
    if (!existsSync(path.join(p, '.git'))) {
      throw new StopError(`${p} is not a worktree`, 'critical');
    }
    const h = depsHash(this.sw.shareDeps, p);
    const mark = depsMarker(p);
    const now = existsSync(mark) ? readFileSync(mark, 'utf8') : '';
    if (now === `private ${h}`) {
      return;
    }
    const cache = depsDir(this.root, h);
    if (
      now === `shared ${h}` &&
      this.sw.shareDeps.dirs.every((d) => !existsSync(path.join(cache, d)) || isLink(path.join(p, d)))
    ) {
      return;
    }
    if (git(p, 'status', '--porcelain', '--', ...this.sw.shareDeps.keys)) {
      throw new StopError(`${p}: dependency key files have uncommitted changes`, 'critical');
    }
    await this.depsCache(n, h, git(p, 'rev-parse', 'HEAD'));
    for (const d of this.sw.shareDeps.dirs) {
      const target = path.join(cache, d);
      if (!existsSync(target)) {
        continue;
      }
      removeDir(path.join(p, d));
      symlinkSync(target, path.join(p, d), 'junction');
    }
    writeFileSync(mark, `shared ${h}`);
  }

  /** Build the shared install for hash `h` from commit `rev`, once. Concurrent callers wait on the same build. */
  depsCache(n, h, rev) {
    this.depsJobs ??= new Map();
    const cache = depsDir(this.root, h);
    if (existsSync(path.join(cache, '.swarm-deps-ok'))) {
      return Promise.resolve();
    }
    if (!this.depsJobs.has(h)) {
      const job = (async () => {
        const lockFile = `${cache}.lock`;
        await takeLock(lockFile);
        try {
          if (existsSync(path.join(cache, '.swarm-deps-ok'))) {
            return;
          }
          if (!removeWorktree(this.root, null, cache)) {
            throw new StopError(`${cache} is incomplete and in use`, 'critical');
          }
          gitOk(this.root, 'worktree', 'prune');
          git(this.root, 'worktree', 'add', '--detach', cache, rev);
          this.emit(`#${n} install shared deps ${h}`);
          const r = await sh(this.sw.install, [], { cwd: cache, shell: true, timeoutMs: 20 * 60e3 });
          if (r.code !== 0) {
            throw new StopError(`install failed in ${cache}: ${r.err.slice(-300)}`, 'critical');
          }
          writeFileSync(path.join(cache, '.swarm-deps-ok'), rev);
        } finally {
          rmSync(lockFile, { force: true });
          this.depsJobs.delete(h);
        }
      })();
      this.depsJobs.set(h, job);
    }
    return this.depsJobs.get(h);
  }
  removeWorktrees(n, { branches }) {
    for (const role of ['coder', 'tester', 'merge']) {
      const p = this.wt(n, role);
      if (!removeWorktree(this.root, this.sw.shareDeps, p)) {
        this.emit(`#${n} could not remove ${p} (in use); gc retries`);
      }
      if (branches) {
        gitOk(this.root, 'branch', '-D', ticketBranch(n, role));
      }
    }
    gitOk(this.root, 'worktree', 'prune');
  }
  /** After a reset or merge: relink shared dependencies when the key files changed. */
  async relinkDeps(n, p) {
    if (this.sw.install && this.sw.shareDeps) {
      await this.ensureDeps(n, p);
    }
  }
  /** Run `swarm.checks` in worktree `p`, in order. Returns the first failure, or null when all pass. */
  async runChecks(n, p) {
    for (const cmd of this.sw.checks ?? []) {
      const shared = this.sw.locked.some((l) => cmd.startsWith(l));
      const line = shared ? `node "${SELF}" lock -- ${cmd}` : cmd;
      const t0 = Date.now();
      const opts = { cwd: p, shell: true, timeoutMs: this.sw.agentTimeoutMin * 60e3 };
      let r = await sh(line, [], opts);
      if (r.code !== 0 && !shared && (this.sw.rerun ?? []).includes(cmd)) {
        // `swarm.rerun` gates time out when parallel tickets load the machine: rerun once alone before a round is spent.
        this.emit(`#${n} check failed, rerun alone: ${cmd}`);
        r = await sh(`node "${SELF}" lock --name gates -- ${cmd}`, [], opts);
      }
      const secs = Math.round((Date.now() - t0) / 1000);
      if (r.code !== 0) {
        this.emit(`#${n} check failed (${secs}s): ${cmd}`);
        return { cmd, tail: `${r.out}${r.err}`.trim().slice(-2500) };
      }
      this.emit(`#${n} check ok (${secs}s): ${cmd}`);
    }
    return null;
  }

  /**
   * Keep each worktree's uncommitted work as a commit under refs/swarm/wip/<n>-<role> before a stop drops it.
   * Uses a private index and commit-tree: no hooks run and the worktree and branch stay as they are.
   */
  saveWip(n) {
    const kept = [];
    for (const role of ['coder', 'tester', 'merge']) {
      const p = this.wt(n, role);
      if (!existsSync(path.join(p, '.git')) || !git(p, 'status', '--porcelain')) {
        continue;
      }
      const env = { ...process.env, GIT_INDEX_FILE: path.join(this.dir, `wip-${n}-${role}.index`) };
      try {
        run('git', ['read-tree', 'HEAD'], { cwd: p, env });
        run('git', ['add', '-A'], { cwd: p, env });
        const tree = run('git', ['write-tree'], { cwd: p, env });
        const sha = run('git', ['commit-tree', tree, '-p', 'HEAD', '-m', `swarm wip #${n} ${role}`], { cwd: p, env });
        const ref = `refs/swarm/wip/${n}-${role}`;
        git(this.root, 'update-ref', ref, sha);
        kept.push(ref);
      } catch (error) {
        this.emit(
          `#${n} could not save uncommitted ${role} work: ${String(error.stderr || error.message).slice(0, 200)}`,
        );
      } finally {
        rmSync(env.GIT_INDEX_FILE, { force: true });
      }
    }
    return kept;
  }

  /**
   * Prepare a role worktree for a round: drop leftovers and, from round 2, move it to `tip`.
   * After a cut-off run (`T.cut`), uncommitted work stays for the agent when `tip` fast-forwards over it.
   * Returns the prompt note about the work that stays.
   */
  prepare(n, p, tip) {
    const T = this.t(n);
    const keep =
      T.cut &&
      !gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD') &&
      Boolean(git(p, 'status', '--porcelain')) &&
      (T.rounds === 1 || gitOk(p, 'merge', '--ff-only', tip));
    if (keep) {
      return 'An earlier run was cut off. Its uncommitted work is in your worktree: check it, finish it, and commit after each few files.\n';
    }
    cleanWorktree(p);
    if (T.rounds > 1) {
      git(p, 'reset', '--hard', tip);
    }
    return '';
  }
}
