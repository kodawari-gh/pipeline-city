#!/usr/bin/env node
// Ticket swarm runner. Drives coder + tester -> round merge -> reviewer -> squash for tickets on a
// GitHub Projects board, escalating model and effort per reviewer FAIL. Prints one event line per stage.
// Config: <repo>/docs/agents/board.json (see update-gh-board). Run with no args for help.
import { spawn, execFileSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  appendFileSync,
  mkdirSync,
  rmSync,
  readdirSync,
  statSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  loadConfig,
  getIssue,
  setStatus,
  setCost,
  done,
  comment,
  sync,
  run,
  repoRoot,
} from '../update-gh-board/board.mjs';

/**
 * @typedef {{ keys: string[], dirs: string[] }} ShareDeps
 * @typedef {{ slots: number, permissionMode: string, agentTimeoutMin: number, testFile: string, locked: string[],
 *   coAuthor: Record<string, string>, install?: string, shareDeps?: ShareDeps, log?: string, claudeBin?: string }} SwarmConfig
 */

/** A git or tool failure: the ticket stops, its worktrees stay for diagnosis, a rerun resumes it. */
class Critical extends Error {}
/** The ticket cannot go on as written (`blocked`) or every tier failed (`exhausted`). */
class Stop extends Error {
  constructor(msg, kind) {
    super(msg);
    this.kind = kind;
  }
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SELF = join(HERE, 'swarm.mjs');
const MODELS = ['haiku', 'sonnet', 'opus'];
const EFFORTS = ['medium', 'high', 'xhigh'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toTimeString().slice(0, 5);

// ---------- ladder ----------

/** Tier for a ticket after `failures` reviewer FAILs, starting at the planned model. null = exhausted. */
export function tierAt(planned, failures) {
  const m = MODELS.indexOf(String(planned).toLowerCase());
  if (m < 0) {
    throw new Error(`Planned model "${planned}" is not swarmable`);
  }
  const i = m * EFFORTS.length + failures;
  if (i >= MODELS.length * EFFORTS.length) {
    return null;
  }
  return { model: MODELS[Math.floor(i / EFFORTS.length)], effort: EFFORTS[i % EFFORTS.length] };
}
export const tierName = (t) => `${t.model} ${t.effort}`;

// ---------- process helpers ----------

function sh(cmd, args, { cwd, input, timeoutMs, shell = false } = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd, shell, windowsHide: true });
    let out = '',
      err = '',
      timedOut = false;
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          p.kill();
        }, timeoutMs)
      : null;
    p.on('error', (e) => {
      err += String(e);
    });
    p.on('close', (code) => {
      if (t) {
        clearTimeout(t);
      }
      res({ code: timedOut ? -1 : code, out, err, timedOut });
    });
    if (input != null) {
      p.stdin.end(input);
    } else {
      p.stdin.end();
    }
  });
}
const git = (cwd, ...args) => run('git', args, { cwd });
const gitOk = (cwd, ...args) => {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
};

// ---------- shared dependency helpers ----------

/** Short hash of the dependency key files in worktree `p`. */
function depsHash(share, p) {
  const h = createHash('sha256');
  for (const k of share.keys) {
    const f = join(p, k);
    h.update(`${k}\0`);
    if (existsSync(f)) {
      h.update(readFileSync(f));
    }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}
const depsDir = (root, h) => join(root, '.claude', 'worktrees', `deps-${h}`);
/** Marker in the worktree's own git dir: `shared <hash>` or `private <hash>`. */
const depsMarker = (p) => join(git(p, 'rev-parse', '--absolute-git-dir'), 'swarm-deps');
function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
/** Remove a dir, or only the link when it is a symlink or junction (never its target). */
function removeDir(p) {
  if (isLink(p)) {
    try {
      unlinkSync(p);
    } catch {
      rmdirSync(p);
    }
  } else if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
  }
}
/** Remove only the dependency links in worktree `p`, so no later recursive delete can reach the shared install. */
function unlinkDeps(share, p) {
  for (const d of share?.dirs ?? []) {
    if (isLink(join(p, d))) {
      removeDir(join(p, d));
    }
  }
}
/** Remove a worktree (dependency links first). False when it is still there, e.g. a process holds it open. */
function removeWorktree(root, share, p) {
  if (!existsSync(p)) {
    return true;
  }
  unlinkDeps(share, p);
  if (!gitOk(root, 'worktree', 'remove', '--force', p)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // In use: the caller reports it and gc retries.
    }
  }
  return !existsSync(p);
}
/** Exclusive lock file; a lock older than 30 minutes is stale and taken over. */
async function takeLock(file) {
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

function findClaude(cfg) {
  const cands = [process.env.CLAUDE_BIN, cfg.swarm?.claudeBin].filter(Boolean);
  try {
    cands.push(run(process.platform === 'win32' ? 'where' : 'which', ['claude']).split(/\r?\n/)[0]);
  } catch {}
  const ext = join(homedir(), '.vscode', 'extensions');
  if (existsSync(ext)) {
    const dirs = readdirSync(ext)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .sort()
      .reverse();
    for (const d of dirs) {
      cands.push(join(ext, d, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude'));
    }
  }
  cands.push(join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  const hit = cands.find((c) => c && existsSync(c));
  if (!hit) {
    throw new Error('claude CLI not found. Set CLAUDE_BIN or swarm.claudeBin in board.json.');
  }
  return hit;
}

// ---------- agents ----------

const WORK_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: 'string', description: 'hash of your one commit this round, or empty' },
    summary: { type: 'string', description: 'what changed, at most 3 lines' },
    unmet: { type: 'array', items: { type: 'string' }, description: 'acceptance items not met, and why' },
    blocker: { type: 'string', description: 'empty, or why the ticket cannot be done as written' },
  },
  required: ['commit', 'summary', 'unmet', 'blocker'],
};
const REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    commands: { type: 'array', items: { type: 'string' }, description: 'each check you ran and its result' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          role: { type: 'string', enum: ['coder', 'tester'], description: 'whose branch must fix it' },
          file: { type: 'string' },
          line: { type: 'integer' },
          problem: { type: 'string' },
          acceptance: { type: 'string' },
        },
        required: ['role', 'file', 'problem'],
      },
    },
  },
  required: ['verdict', 'commands', 'findings'],
};
const MERGE_SCHEMA = {
  type: 'object',
  properties: { resolved: { type: 'boolean' }, summary: { type: 'string' } },
  required: ['resolved', 'summary'],
};

/** Agent definitions read from the main checkout, so worktrees on older bases still get current rules. */
function agentsJson(root) {
  const defs = {};
  const dir = join(root, '.claude', 'agents');
  for (const f of readdirSync(dir).filter((f) => /^swarm-.*\.md$/.test(f))) {
    const txt = readFileSync(join(dir, f), 'utf8');
    const m = txt.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
    const desc = m?.[1].match(/^description:\s*(.*)$/m)?.[1] ?? f;
    defs[f.replace(/\.md$/, '')] = { description: desc, prompt: (m?.[2] ?? txt).trim() };
  }
  return JSON.stringify(defs);
}

// ---------- state ----------

class Swarm {
  constructor(cfg, key, base) {
    this.cfg = cfg;
    /** @type {string} */
    this.root = cfg.root;
    /** @type {SwarmConfig} */
    this.sw = {
      slots: 2,
      permissionMode: 'auto',
      agentTimeoutMin: 60,
      testFile: '\\.(test|spec)\\.[cm]?[jt]sx?$',
      locked: [],
      coAuthor: {},
      ...cfg.swarm,
    };
    this.dir = join(this.root, '.claude', 'swarm');
    mkdirSync(this.dir, { recursive: true });
    this.statePath = join(this.dir, `${key}.json`);
    this.logPath = join(this.dir, `${key}.log`);
    this.state = existsSync(this.statePath)
      ? JSON.parse(readFileSync(this.statePath, 'utf8'))
      : { key, base, tickets: {} };
    if (base && this.state.base && base !== this.state.base) {
      throw new Error(`State ${this.statePath} uses base ${this.state.base}, not ${base}. Delete it to change base.`);
    }
    this.state.base ||= base;
    this.base = this.state.base;
    this.claude = findClaude(cfg);
    this.agents = agentsJson(this.root);
    this.testRe = new RegExp(this.sw.testFile);
  }
  save() {
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }
  emit(line) {
    const l = `${stamp()} ${line}`;
    console.log(l);
    appendFileSync(this.logPath, l + '\n');
  }
  t(n) {
    return (this.state.tickets[n] ||= { phase: 'new', failures: 0, rounds: 0, rows: [], findings: [] });
  }
  wt(n, role) {
    return join(this.root, '.claude', 'worktrees', `t${n}-${role}`);
  }
  br(n, role) {
    return role === 'merge' ? `ticket/${n}` : `ticket/${n}-${role}`;
  }
  coAuthor(model) {
    const name = this.sw.coAuthor[model] ?? `Claude ${model[0].toUpperCase()}${model.slice(1)}`;
    return `Co-Authored-By: ${name} <noreply@anthropic.com>`;
  }

  async agent(role, n, cwd, tier, prompt, schema) {
    const args = [
      '-p',
      '--agents',
      this.agents,
      '--agent',
      role,
      '--model',
      tier.model,
      '--effort',
      tier.effort,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(schema),
      '--permission-mode',
      this.sw.permissionMode,
      '--permission-prompts',
      'none',
    ];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await sh(this.claude, args, { cwd, input: prompt, timeoutMs: this.sw.agentTimeoutMin * 60e3 });
      let j = null;
      try {
        j = JSON.parse(r.out);
      } catch {}
      const so = j?.structured_output;
      const denials = j?.permission_denials?.length ?? 0;
      if (j?.total_cost_usd) {
        const T = this.t(n);
        T.cost = (T.cost || 0) + j.total_cost_usd;
        this.save();
      }
      if (r.code === 0 && so && !j.is_error) {
        if (denials) {
          this.emit(
            `#${n} ${role}: ${denials} permission denial(s): ${j.permission_denials.map((d) => d.tool_name).join(', ')}`,
          );
        }
        return so;
      }
      const why = r.timedOut
        ? 'timed out'
        : (j?.result || r.err || r.out).toString().trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300);
      this.emit(`#${n} ${role} attempt ${attempt} failed: ${why}`);
    }
    throw new Critical(`${role} agent failed twice`);
  }

  facts(n, issue, role, tier, extra = '') {
    const lockLine = this.sw.locked.length
      ? `Shared-resource lock: run any command starting with ${this.sw.locked.map((c) => `"${c}"`).join(', ')} as: node "${SELF}" lock -- <command>\n`
      : '';
    const depsLine = this.sw.shareDeps
      ? `Dependencies: ${this.sw.shareDeps.dirs.join(', ')} link to an install other worktrees share. Never run "${this.sw.install}" or a package add/remove command there. To change dependencies, first run: node "${SELF}" deps (it makes a private install in your worktree).\n`
      : '';
    const locked = lockLine + depsLine;
    return `Ticket #${n} in ${this.cfg.repo}: "${issue.title}". Read it with: gh issue view ${n} --repo ${this.cfg.repo} --json title,body
Your worktree (cwd): ${this.wt(n, role === 'reviewer' ? 'merge' : role)}
Your branch: ${this.br(n, role === 'reviewer' ? 'merge' : role)}
Base branch: ${this.base}
Round ${this.t(n).rounds}, tier ${tierName(tier)}.
Co-author line for commits: ${this.coAuthor(tier.model)}
${locked}${extra}`;
  }

  // ---------- worktrees ----------

  /** Worktree roles a ticket needs: no tester when its body says `Tests: none`. */
  roles(n) {
    return this.t(n).noTests ? ['coder', 'merge'] : ['coder', 'tester', 'merge'];
  }

  async ensureWorktrees(n) {
    const fresh = [];
    for (const role of this.roles(n)) {
      const p = this.wt(n, role),
        b = this.br(n, role);
      if (existsSync(join(p, '.git'))) {
        continue;
      }
      // A folder without .git is a leftover of a failed removal: git there would act on the main checkout.
      if (!removeWorktree(this.root, this.sw.shareDeps, p)) {
        throw new Critical(`${p} is a leftover folder in use`);
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
    if (fresh.length) {
      this.emit(`#${n} install in ${fresh.length} worktree(s)`);
      const rs = await Promise.all(
        fresh.map((p) => sh(this.sw.install, [], { cwd: p, shell: true, timeoutMs: 20 * 60e3 })),
      );
      const bad = rs.findIndex((r) => r.code !== 0);
      if (bad >= 0) {
        throw new Critical(`install failed in ${fresh[bad]}: ${rs[bad].err.slice(-300)}`);
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
    if (!existsSync(join(p, '.git'))) {
      throw new Critical(`${p} is not a worktree`);
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
      this.sw.shareDeps.dirs.every((d) => !existsSync(join(cache, d)) || isLink(join(p, d)))
    ) {
      return;
    }
    if (git(p, 'status', '--porcelain', '--', ...this.sw.shareDeps.keys)) {
      throw new Critical(`${p}: dependency key files have uncommitted changes`);
    }
    await this.depsCache(n, h, git(p, 'rev-parse', 'HEAD'));
    for (const d of this.sw.shareDeps.dirs) {
      const target = join(cache, d);
      if (!existsSync(target)) {
        continue;
      }
      removeDir(join(p, d));
      symlinkSync(target, join(p, d), 'junction');
    }
    writeFileSync(mark, `shared ${h}`);
  }

  /** Build the shared install for hash `h` from commit `rev`, once. Concurrent callers wait on the same build. */
  depsCache(n, h, rev) {
    this.depsJobs ??= new Map();
    const cache = depsDir(this.root, h);
    if (existsSync(join(cache, '.swarm-deps-ok'))) {
      return Promise.resolve();
    }
    if (!this.depsJobs.has(h)) {
      const job = (async () => {
        const lockFile = `${cache}.lock`;
        await takeLock(lockFile);
        try {
          if (existsSync(join(cache, '.swarm-deps-ok'))) {
            return;
          }
          if (!removeWorktree(this.root, null, cache)) {
            throw new Critical(`${cache} is incomplete and in use`);
          }
          gitOk(this.root, 'worktree', 'prune');
          git(this.root, 'worktree', 'add', '--detach', cache, rev);
          this.emit(`#${n} install shared deps ${h}`);
          const r = await sh(this.sw.install, [], { cwd: cache, shell: true, timeoutMs: 20 * 60e3 });
          if (r.code !== 0) {
            throw new Critical(`install failed in ${cache}: ${r.err.slice(-300)}`);
          }
          writeFileSync(join(cache, '.swarm-deps-ok'), rev);
        } finally {
          rmSync(lockFile, { force: true });
          this.depsJobs.delete(h);
        }
      })();
      this.depsJobs.set(h, job);
    }
    return this.depsJobs.get(h);
  }
  clean(p) {
    if (existsSync(join(p, '.git')) && gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
      gitOk(p, 'merge', '--abort');
    }
    git(p, 'reset', '--hard', 'HEAD');
  }
  removeWorktrees(n, { branches }) {
    for (const role of ['coder', 'tester', 'merge']) {
      const p = this.wt(n, role);
      if (!removeWorktree(this.root, this.sw.shareDeps, p)) {
        this.emit(`#${n} could not remove ${p} (in use); gc retries`);
      }
      if (branches) {
        gitOk(this.root, 'branch', '-D', this.br(n, role));
      }
    }
    gitOk(this.root, 'worktree', 'prune');
  }

  // ---------- round merge ----------

  async mergeBranch(n, tier, issue, ref, side) {
    const p = this.wt(n, 'merge');
    if (gitOk(p, 'merge', '--no-ff', '--no-edit', ref)) {
      return;
    }
    if (!gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
      this.clean(p);
      throw new Critical(`merge of ${ref} did not start`);
    }
    const files = git(p, 'diff', '--name-only', '--diff-filter=U').split(/\r?\n/).filter(Boolean);
    let why = `stopped on conflicts in: ${files.join(', ')}`;
    // Role branches: coder wins source files, tester wins test files.
    if (side !== 'base' && files.every((f) => this.takeSide(p, f, side))) {
      try {
        git(p, 'commit', '--no-edit');
        return;
      } catch (error) {
        why = `was refused by the commit hook:\n${`${error.stdout ?? ''}${error.stderr ?? ''}`.slice(-1500)}`;
      }
    }
    // Base conflicts, a file the rule cannot settle, or a hook refusal: a merger agent settles it once, else stop.
    const out = await this.agent(
      'swarm-merger',
      n,
      p,
      tier,
      this.facts(
        n,
        issue,
        'merge',
        tier,
        `Task: the merge of ${ref} into ${this.br(n, 'merge')} is in progress and ${why}
Finish it: keep the ticket's intent and the other side's changes, make the repo's commit hooks pass, stage the paths, and commit with git commit --no-edit. If you cannot, run git merge --abort and report resolved=false.`,
      ),
      MERGE_SCHEMA,
    );
    if (out.resolved && !gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) return;
    this.clean(p);
    throw new Critical(`merge of ${ref} ${why.split('\n')[0]}: ${out.summary}`);
  }

  /** Settle one conflicted file by the role rule. False when git cannot. */
  takeSide(p, f, side) {
    const theirs = this.testRe.test(f) ? side === 'tester' : side === 'coder';
    if (!gitOk(p, 'checkout', theirs ? '--theirs' : '--ours', '--', f)) return false;
    git(p, 'add', '--', f);
    return true;
  }

  // ---------- one ticket ----------

  async runTicket(n) {
    const T = this.t(n);
    const issue = getIssue(this.cfg, n);
    const planned = issue.item?.planned;
    T.phase = 'running';
    T.noTests = /^Tests:\s*none\b/imu.test(issue.body ?? '');
    this.save();
    setStatus(this.cfg, n, 'In progress');
    await this.ensureWorktrees(n);
    const workers = this.roles(n).filter((r) => r !== 'merge');
    if (T.noTests) {
      this.emit(`#${n} Tests: none, no tester`);
    }
    const routed = (findings) => {
      const r = [...new Set(findings.map((f) => (T.noTests ? 'coder' : f.role)))];
      return r.length ? r : workers;
    };
    let relaunch = T.findings.length ? routed(T.findings) : workers;
    for (;;) {
      const tier = tierAt(planned, T.failures);
      if (!tier) {
        throw new Stop('ladder exhausted', 'exhausted');
      }
      T.rounds++;
      this.save();
      this.emit(`#${n} round ${T.rounds} ${tierName(tier)}: ${relaunch.join(' + ')}`);
      const findingsText = T.findings.length
        ? `Reviewer findings to fix on your branch:\n${T.findings
            .filter((f) => T.noTests || relaunch.includes(f.role))
            .map(
              (f, i) =>
                `${i + 1}. ${f.file}${f.line ? ':' + f.line : ''} ${f.problem}${f.acceptance ? ` (acceptance: ${f.acceptance})` : ''}${f.repeat ? ' [REPEATED: add a test that proves the fix]' : ''}`,
            )
            .join('\n')}\n`
        : '';
      const merge = this.wt(n, 'merge');
      const tip = git(merge, 'rev-parse', 'HEAD');
      const jobs = relaunch.map(async (role) => {
        const p = this.wt(n, role);
        this.clean(p);
        if (T.rounds > 1) {
          git(p, 'reset', '--hard', tip);
        }
        if (this.sw.install && this.sw.shareDeps) {
          await this.ensureDeps(n, p);
        }
        const out = await this.agent(
          `swarm-${role}`,
          n,
          p,
          tier,
          this.facts(n, issue, role, tier, findingsText),
          WORK_SCHEMA,
        );
        if (out.blocker) {
          throw new Stop(`${role} blocker: ${out.blocker}`, 'blocked');
        }
        const dirty = git(p, 'status', '--porcelain', '--untracked-files=no');
        this.emit(
          `#${n} ${role} ${git(p, 'rev-parse', '--short', 'HEAD')}: ${out.summary.split(/\r?\n/)[0].slice(0, 160)}${out.unmet.length ? ` | unmet: ${out.unmet.length}` : ''}${dirty ? ' | WARNING: uncommitted changes dropped' : ''}`,
        );
      });
      await Promise.all(jobs);

      // Round merge: base first (keeps the review honest), then coder, then tester.
      this.clean(merge);
      await this.mergeBranch(n, tier, issue, this.base, 'base');
      // Merge every role branch the integration branch does not hold yet (covers commits from an earlier, interrupted run).
      for (const role of workers) {
        if (!gitOk(merge, 'merge-base', '--is-ancestor', this.br(n, role), 'HEAD')) {
          await this.mergeBranch(n, tier, issue, this.br(n, role), role);
        }
      }
      if (this.sw.install && this.sw.shareDeps) {
        await this.ensureDeps(n, merge);
      }

      const head = git(merge, 'rev-parse', 'HEAD');
      const rv = await this.agent(
        'swarm-reviewer',
        n,
        merge,
        tier,
        this.facts(
          n,
          issue,
          'reviewer',
          tier,
          `Review: git diff ${this.base}...HEAD in your worktree. Do not edit, stage or commit.\n${T.noTests ? 'The ticket says Tests: none. Tag every finding coder.' : 'Tag each finding with the role whose branch must fix it: tester for test files, coder for everything else.'}\n`,
        ),
        REVIEW_SCHEMA,
      );
      if (git(merge, 'rev-parse', 'HEAD') !== head || git(merge, 'status', '--porcelain', '--untracked-files=no')) {
        this.emit(`#${n} reviewer changed the worktree; reset`);
        git(merge, 'reset', '--hard', head);
      }
      const note =
        rv.verdict === 'PASS'
          ? rv.commands.join('; ').slice(0, 200)
          : rv.findings
              .map((f) => `${f.file}: ${f.problem}`)
              .join('; ')
              .slice(0, 300);
      T.rows.push(
        `| #${n} | ${T.rounds} | ${tierName(tier)} | ${rv.verdict} | ${note.replace(/\|/g, '/').replace(/\r?\n/g, ' ')} |`,
      );
      this.emit(`#${n} reviewer ${rv.verdict}${rv.verdict === 'FAIL' ? `: ${rv.findings.length} finding(s)` : ''}`);
      if (rv.verdict === 'PASS') {
        T.commands = rv.commands;
        this.save();
        return this.land(n, issue, tier);
      }
      const prev = new Set(T.findings.map((f) => `${f.file}|${f.problem}`));
      T.findings = rv.findings.map((f) => ({ ...f, repeat: prev.has(`${f.file}|${f.problem}`) }));
      T.failures++;
      this.save();
      relaunch = routed(T.findings);
    }
  }

  async land(n, issue, tier) {
    const T = this.t(n);
    setStatus(this.cfg, n, 'In review');
    const merge = this.wt(n, 'merge');
    await this.mergeBranch(n, tier, issue, this.base, 'base');
    // Swarm log rows land with the squash.
    if (this.sw.log) {
      const lp = join(merge, this.sw.log);
      if (!existsSync(lp)) {
        mkdirSync(dirname(lp), { recursive: true });
        writeFileSync(
          lp,
          '# Swarm log\n\n| Ticket | Round | Tier | Result | Notes |\n| --- | --- | --- | --- | --- |\n',
        );
      }
      appendFileSync(lp, T.rows.join('\n') + '\n');
      git(merge, 'add', '--', this.sw.log);
      git(merge, 'commit', '-m', `Swarm log for #${n}`);
    }
    const subject = `#${n} ${issue.title}`.slice(0, 72);
    const msg = `${subject}\n\nSwarm: ${T.rounds} round(s), final tier ${tierName(tier)}.\n\n${this.coAuthor(tier.model)}`;
    const sha = await this.squash(n, msg);
    this.emit(`#${n} squashed as ${sha.slice(0, 8)} on ${this.base}`);
    const cost = T.cost || 0;
    done(
      this.cfg,
      n,
      T.rounds,
      `Squashed as ${sha} on \`${this.base}\` after ${T.rounds} round(s), API cost $${cost.toFixed(2)}.\n\nReviewer checks:\n${(T.commands || []).map((c) => `- ${c}`).join('\n')}`,
      cost,
    );
    this.removeWorktrees(n, { branches: true });
    T.phase = 'done';
    T.commit = sha;
    this.save();
    this.emit(`#${n} DONE rounds=${T.rounds} cost=$${cost.toFixed(2)}`);
  }

  /** Squash ticket/<n> onto base as one commit, without touching unrelated staged work. */
  async squash(n, msg) {
    const ref = this.br(n, 'merge');
    const wl = git(this.root, 'worktree', 'list', '--porcelain');
    const block = wl.split(/\r?\n\r?\n/).find((b) => b.includes(`branch refs/heads/${this.base}`));
    const msgFile = join(this.dir, `msg-${n}.txt`);
    writeFileSync(msgFile, msg);
    if (!block) {
      const tree = git(this.root, 'rev-parse', `${ref}^{tree}`);
      const old = git(this.root, 'rev-parse', this.base);
      const sha = git(this.root, 'commit-tree', tree, '-p', old, '-F', msgFile);
      git(this.root, 'update-ref', `refs/heads/${this.base}`, sha, old);
      return sha;
    }
    const [, p] = block.match(/^worktree (.*)$/m);
    for (let i = 0; i < 30 && !gitOk(p, 'diff', '--cached', '--quiet'); i++) {
      if (i === 0) {
        this.emit(`#${n} waiting: ${p} has staged changes from another session`);
      }
      await sleep(10e3);
    }
    if (!gitOk(p, 'diff', '--cached', '--quiet')) {
      throw new Critical(`${p} index busy; squash not done`);
    }
    try {
      git(p, 'merge', '--squash', ref);
    } catch (error) {
      gitOk(p, 'reset', '--merge');
      throw new Critical(`merge --squash refused in ${p}: ${String(error.stderr || error.message).slice(0, 300)}`);
    }
    try {
      git(p, 'commit', '-F', msgFile);
    } catch (error) {
      // Leave the checkout as it was: unstage the squash and restore the files.
      gitOk(p, 'reset', '--merge');
      throw new Critical(`squash commit refused in ${p}: ${`${error.stdout ?? ''}${error.stderr ?? ''}`.slice(-300)}`);
    }
    return git(p, 'rev-parse', 'HEAD');
  }

  async stop(n, err) {
    const T = this.t(n);
    T.phase = err instanceof Stop ? err.kind : 'critical';
    T.reason = err.message;
    this.save();
    this.emit(`#${n} STOP ${T.phase}: ${err.message}`);
    try {
      setStatus(this.cfg, n, 'Backlog');
      if (T.cost) {
        setCost(this.cfg, n, T.cost);
      }
      const open = T.findings
        .map((f, i) => `${i + 1}. [${f.role}] ${f.file}${f.line ? ':' + f.line : ''} ${f.problem}`)
        .join('\n');
      comment(
        this.cfg,
        n,
        `Swarm stopped (${T.phase}): ${err.message}\n\nRounds: ${T.rounds}. Work kept on branch \`${this.br(n, 'merge')}\`.\n\n${open ? `Open findings:\n${open}\n\n` : ''}| Ticket | Round | Tier | Result | Notes |\n| --- | --- | --- | --- | --- |\n${T.rows.join('\n')}`,
      );
    } catch (error) {
      this.emit(`#${n} board/comment write failed: ${error.message}`);
    }
    if (T.phase !== 'critical') {
      this.removeWorktrees(n, { branches: false });
    }
  }

  // ---------- loop ----------

  async loop({ parent, only }) {
    const running = new Map();
    const warned = new Set();
    for (const [n, T] of Object.entries(this.state.tickets)) {
      // A critical stop keeps its worktrees for diagnosis; a rerun resumes it once the cause is fixed.
      if (T.phase === 'running' || T.phase === 'critical') {
        T.phase = 'resume';
        delete T.reason;
        this.emit(`#${n} resuming at round ${T.rounds + 1}`);
      }
    }
    this.save();
    const start = (n) => {
      const p = this.runTicket(n)
        .catch((e) => this.stop(n, e))
        .finally(() => running.delete(n));
      running.set(n, p);
    };
    for (;;) {
      let ready = [];
      if (parent) {
        const r = sync(this.cfg, parent);
        for (const m of r.moves) {
          this.emit(`board ${m}`);
        }
        ({ ready } = r);
      }
      if (only) {
        ready = only.filter((n) => getIssue(this.cfg, n).state === 'OPEN');
      }
      const resume = Object.entries(this.state.tickets)
        .filter(([, T]) => T.phase === 'resume')
        .map(([n]) => Number(n));
      const queue = [...new Set([...resume, ...ready])].filter((n) => {
        if (running.has(n)) {
          return false;
        }
        const T = this.state.tickets[n];
        if (T && !['new', 'resume'].includes(T.phase)) {
          return false;
        }
        const planned = getIssue(this.cfg, n).item?.planned;
        if (!planned || !MODELS.includes(planned.toLowerCase())) {
          if (!warned.has(n)) {
            warned.add(n);
            this.emit(`#${n} NEED planned model (board.mjs planned ${n} <Haiku|Sonnet|Opus>)`);
          }
          return false;
        }
        return true;
      });
      while (running.size < this.sw.slots && queue.length) {
        start(queue.shift());
      }
      if (!running.size) {
        break;
      }
      await Promise.race([...running.values(), sleep(120e3)]);
    }
    const ts = Object.entries(this.state.tickets);
    this.emit(
      `FINISHED: ${ts.map(([n, T]) => `#${n} ${T.phase}${T.phase === 'done' ? ` ${T.commit?.slice(0, 8)} r${T.rounds}` : ''}`).join(', ') || 'nothing to run'}`,
    );
    if (warned.size) {
      this.emit(`waiting on planned model: ${[...warned].map((n) => '#' + n).join(' ')}`);
    }
    for (const line of gc(this.cfg)) {
      this.emit(`gc: ${line}`);
    }
  }
}

/** Remove the worktrees and branches of closed tickets; keep those of open ones. */
function gc(cfg) {
  const { root } = cfg;
  const out = [];
  const branches = git(root, 'branch', '--format=%(refname:short)')
    .split(/\r?\n/)
    .filter((b) => /^ticket\/\d+/.test(b));
  const nums = [...new Set(branches.map((b) => Number(b.match(/^ticket\/(\d+)/)[1])))];
  for (const n of nums) {
    if (getIssue(cfg, n).state === 'OPEN') {
      out.push(`keep #${n} (open)`);
      continue;
    }
    for (const role of ['coder', 'tester', 'merge']) {
      const p = join(root, '.claude', 'worktrees', `t${n}-${role}`);
      if (!removeWorktree(root, cfg.swarm?.shareDeps, p)) {
        out.push(`could not remove ${p} (in use)`);
      }
    }
    for (const br of branches.filter((b) => b === `ticket/${n}` || b.startsWith(`ticket/${n}-`))) {
      gitOk(root, 'branch', '-D', br);
    }
    out.push(`removed #${n} worktrees and branches`);
  }
  gitOk(root, 'worktree', 'prune');
  if (cfg.swarm?.shareDeps) {
    out.push(...gcDeps(cfg));
  }
  return out;
}

/** Remove shared installs no ticket worktree links to, except the one for the main checkout's key files. */
function gcDeps(cfg) {
  const { root } = cfg;
  const wtDir = join(root, '.claude', 'worktrees');
  if (!existsSync(wtDir)) {
    return [];
  }
  const keep = new Set([depsHash(cfg.swarm.shareDeps, root)]);
  const names = readdirSync(wtDir);
  for (const d of names.filter((x) => !x.startsWith('deps-'))) {
    try {
      const m = readFileSync(depsMarker(join(wtDir, d)), 'utf8').split(' ');
      if (m[0] === 'shared') {
        keep.add(m[1]);
      }
    } catch {
      // Not a worktree or no marker: it links nothing.
    }
  }
  const out = [];
  for (const d of names.filter((x) => /^deps-[0-9a-f]+$/u.test(x))) {
    if (keep.has(d.slice(5)) || existsSync(join(wtDir, `${d}.lock`))) {
      continue;
    }
    const p = join(wtDir, d);
    out.push(removeWorktree(root, null, p) ? `removed shared deps ${d.slice(5)}` : `could not remove ${p} (in use)`);
  }
  gitOk(root, 'worktree', 'prune');
  return out;
}

/** `swarm.mjs deps`: replace the dependency links in the current worktree with a private install. */
async function privateDeps(cfg) {
  const share = cfg.swarm?.shareDeps;
  if (!share || !cfg.swarm.install) {
    return console.log('shareDeps is off: run the install command yourself.');
  }
  const p = resolve(git(process.cwd(), 'rev-parse', '--show-toplevel'));
  if (p === resolve(cfg.root)) {
    throw new Error('deps runs only in a swarm worktree');
  }
  unlinkDeps(share, p);
  const r = await sh(cfg.swarm.install, [], { cwd: p, shell: true, timeoutMs: 20 * 60e3 });
  process.stdout.write(r.out.slice(-2000));
  if (r.code !== 0) {
    throw new Error(`install failed: ${r.err.slice(-500)}`);
  }
  writeFileSync(depsMarker(p), `private ${depsHash(share, p)}`);
  console.log('private install done');
}

/** The parent's base branch parent/<n>, made from `from` when missing. Never checked out. */
function parentBranch(root, parent, from) {
  const b = `parent/${parent}`;
  if (!gitOk(root, 'rev-parse', '--verify', `refs/heads/${b}`)) {
    git(root, 'branch', b, from);
  }
  return b;
}
// ---------- lock ----------

async function lock(name, cmd) {
  const common = resolve(run('git', ['rev-parse', '--git-common-dir']));
  const dir = join(tmpdir(), `swarm-${createHash('sha1').update(common).digest('hex').slice(0, 10)}-${name}.lock`);
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
        const o = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
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
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, t: Date.now(), cmd }));
  const release = () => rmSync(dir, { recursive: true, force: true });
  process.on('SIGINT', () => {
    release();
    process.exit(130);
  });
  const code = await new Promise((res) => spawn(cmd, { shell: true, stdio: 'inherit' }).on('close', res));
  release();
  process.exit(code ?? 1);
}

// ---------- CLI ----------

const HELP = `swarm.mjs: ticket swarm runner (config docs/agents/board.json)
  run <parent> [--base <branch>] [--from <ref>] [--slots <k>]   swarm every ready child until none is left
  ticket <n>[,<n>...] [--base <branch>]          swarm the named tickets only
  status [<key>]                                 phase, rounds and tier of each ticket in a run
  gc                                             remove worktrees and branches of closed tickets, and unused shared installs
  deps                                           in a swarm worktree: replace shared dependency links with a private install
  lock [--name <name>] -- <command...>           run a command under a machine-wide mutex (default name: browser)
run: base defaults to parent/<parent>, made from --from (default: the current branch) when missing; gc runs at the end.
ticket: base defaults to the current branch.
--no-install skips the install command in new worktrees. State and event log: .claude/swarm/<key>.{json,log}.`;

function opt(a, name, def) {
  const i = a.indexOf(name);
  return i >= 0 ? a[i + 1] : def;
}

async function main(argv) {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    return console.log(HELP);
  }
  if (cmd === 'lock') {
    const i = a.indexOf('--');
    if (i < 0) {
      throw new Error('lock needs -- <command>');
    }
    return lock(opt(a.slice(0, i), '--name', 'browser'), a.slice(i + 1).join(' '));
  }
  const root = repoRoot();
  const cfg = loadConfig(root);
  if (cmd === 'status') {
    const dir = join(cfg.root, '.claude', 'swarm');
    const files = existsSync(dir)
      ? readdirSync(dir).filter((f) => f.endsWith('.json') && (!a[0] || f === `${a[0]}.json`))
      : [];
    for (const f of files) {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      console.log(`${s.key} (base ${s.base})`);
      for (const [n, T] of Object.entries(s.tickets)) {
        console.log(
          `  #${n} ${T.phase} rounds=${T.rounds} failures=${T.failures} cost=$${(T.cost || 0).toFixed(2)}${T.reason ? ` (${T.reason})` : ''}`,
        );
      }
    }
    return;
  }
  if (cmd === 'gc') {
    for (const line of gc(cfg)) {
      console.log(line);
    }
    return;
  }
  if (cmd === 'deps') {
    return privateDeps(cfg);
  }
  if (a.includes('--no-install')) {
    cfg.swarm = { ...cfg.swarm, install: '' };
  }
  /** @type {string} */
  const current = git(root, 'branch', '--show-current');
  if (cmd === 'run') {
    const parent = Number(a[0]);
    if (!parent) {
      throw new Error('run needs a parent issue number');
    }
    const s = new Swarm(
      cfg,
      `p${parent}`,
      opt(a, '--base') ?? parentBranch(root, parent, opt(a, '--from', current === '' ? 'HEAD' : current)),
    );
    if (a.includes('--slots')) {
      s.sw.slots = Number(opt(a, '--slots'));
    }
    s.emit(`START parent #${parent} base ${s.base} slots ${s.sw.slots}`);
    return s.loop({ parent });
  }
  if (cmd === 'ticket') {
    const base = opt(a, '--base', current);
    if (!base) {
      throw new Error('No base branch: pass --base');
    }
    const only = String(a[0]).split(',').map(Number).filter(Boolean);
    const s = new Swarm(cfg, `t${only.join('-')}`, base);
    s.sw.slots = Math.max(s.sw.slots, only.length);
    s.emit(`START tickets ${only.map((n) => '#' + n).join(' ')} base ${s.base}`);
    return s.loop({ only });
  }
  throw new Error(`Unknown command "${cmd}".\n${HELP}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(String(e.stderr || e.message || e).trim());
    process.exit(1);
  });
}
