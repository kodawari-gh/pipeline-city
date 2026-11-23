#!/usr/bin/env node
// Ticket swarm runner. Drives coder + tester -> round merge -> reviewer -> squash for tickets on a
// GitHub Projects board, escalating model and effort per reviewer FAIL. Prints one event line per stage.
// Config: <repo>/docs/agents/board.json (see update-gh-board). Run with no args for help.
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, rmSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadConfig, getIssue, setStatus, setCost, done, comment, sync, run, repoRoot } from '../update-gh-board/board.mjs';

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
  if (m < 0) throw new Error(`Planned model "${planned}" is not swarmable`);
  const i = m * EFFORTS.length + failures;
  if (i >= MODELS.length * EFFORTS.length) return null;
  return { model: MODELS[Math.floor(i / EFFORTS.length)], effort: EFFORTS[i % EFFORTS.length] };
}
export const tierName = (t) => `${t.model} ${t.effort}`;

// ---------- process helpers ----------

function sh(cmd, args, { cwd, input, timeoutMs, shell = false } = {}) {
  return new Promise((res) => {
    const p = spawn(cmd, args, { cwd, shell, windowsHide: true });
    let out = '', err = '', timedOut = false;
    p.stdout.on('data', (d) => (out += d));
    p.stderr.on('data', (d) => (err += d));
    const t = timeoutMs ? setTimeout(() => { timedOut = true; p.kill(); }, timeoutMs) : null;
    p.on('error', (e) => { err += String(e); });
    p.on('close', (code) => { if (t) clearTimeout(t); res({ code: timedOut ? -1 : code, out, err, timedOut }); });
    if (input != null) p.stdin.end(input); else p.stdin.end();
  });
}
const git = (cwd, ...args) => run('git', args, { cwd });
const gitOk = (cwd, ...args) => { try { git(cwd, ...args); return true; } catch { return false; } };

function findClaude(cfg) {
  const cands = [process.env.CLAUDE_BIN, cfg.swarm?.claudeBin].filter(Boolean);
  try { cands.push(run(process.platform === 'win32' ? 'where' : 'which', ['claude']).split(/\r?\n/)[0]); } catch {}
  const ext = join(homedir(), '.vscode', 'extensions');
  if (existsSync(ext)) {
    const dirs = readdirSync(ext).filter((d) => d.startsWith('anthropic.claude-code-')).sort().reverse();
    for (const d of dirs) cands.push(join(ext, d, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  }
  cands.push(join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  const hit = cands.find((c) => c && existsSync(c));
  if (!hit) throw new Error('claude CLI not found. Set CLAUDE_BIN or swarm.claudeBin in board.json.');
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
          file: { type: 'string' }, line: { type: 'integer' },
          problem: { type: 'string' }, acceptance: { type: 'string' },
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
    this.root = cfg.root;
    this.sw = { slots: 2, permissionMode: 'auto', agentTimeoutMin: 60, testFile: '\\.(test|spec)\\.[cm]?[jt]sx?$', locked: [], coAuthor: {}, ...cfg.swarm };
    this.dir = join(this.root, '.claude', 'swarm');
    mkdirSync(this.dir, { recursive: true });
    this.statePath = join(this.dir, `${key}.json`);
    this.logPath = join(this.dir, `${key}.log`);
    this.state = existsSync(this.statePath) ? JSON.parse(readFileSync(this.statePath, 'utf8')) : { key, base, tickets: {} };
    if (base && this.state.base && base !== this.state.base) throw new Error(`State ${this.statePath} uses base ${this.state.base}, not ${base}. Delete it to change base.`);
    this.state.base ||= base;
    this.base = this.state.base;
    this.claude = findClaude(cfg);
    this.agents = agentsJson(this.root);
    this.testRe = new RegExp(this.sw.testFile);
  }
  save() { writeFileSync(this.statePath, JSON.stringify(this.state, null, 2)); }
  emit(line) {
    const l = `${stamp()} ${line}`;
    console.log(l);
    appendFileSync(this.logPath, l + '\n');
  }
  t(n) { return (this.state.tickets[n] ||= { phase: 'new', failures: 0, rounds: 0, rows: [], findings: [] }); }
  wt(n, role) { return join(this.root, '.claude', 'worktrees', `t${n}-${role}`); }
  br(n, role) { return role === 'merge' ? `ticket/${n}` : `ticket/${n}-${role}`; }
  coAuthor(model) {
    const name = this.sw.coAuthor[model] ?? `Claude ${model[0].toUpperCase()}${model.slice(1)}`;
    return `Co-Authored-By: ${name} <noreply@anthropic.com>`;
  }

  async agent(role, n, cwd, tier, prompt, schema) {
    const args = ['-p', '--agents', this.agents, '--agent', role, '--model', tier.model, '--effort', tier.effort,
      '--output-format', 'json', '--json-schema', JSON.stringify(schema),
      '--permission-mode', this.sw.permissionMode, '--permission-prompts', 'none'];
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await sh(this.claude, args, { cwd, input: prompt, timeoutMs: this.sw.agentTimeoutMin * 60e3 });
      let j = null;
      try { j = JSON.parse(r.out); } catch {}
      const so = j?.structured_output;
      const denials = j?.permission_denials?.length ?? 0;
      if (j?.total_cost_usd) { const T = this.t(n); T.cost = (T.cost || 0) + j.total_cost_usd; this.save(); }
      if (r.code === 0 && so && !j.is_error) {
        if (denials) this.emit(`#${n} ${role}: ${denials} permission denial(s): ${j.permission_denials.map((d) => d.tool_name).join(', ')}`);
        return so;
      }
      const why = r.timedOut ? 'timed out' : (j?.result || r.err || r.out).toString().trim().split(/\r?\n/).slice(-3).join(' | ').slice(0, 300);
      this.emit(`#${n} ${role} attempt ${attempt} failed: ${why}`);
    }
    throw new Critical(`${role} agent failed twice`);
  }

  facts(n, issue, role, tier, extra = '') {
    const locked = this.sw.locked.length
      ? `Shared-resource lock: run any command starting with ${this.sw.locked.map((c) => `"${c}"`).join(', ')} as: node "${SELF}" lock -- <command>\n`
      : '';
    return `Ticket #${n} in ${this.cfg.repo}: "${issue.title}". Read it with: gh issue view ${n} --repo ${this.cfg.repo} --json title,body
Your worktree (cwd): ${this.wt(n, role === 'reviewer' ? 'merge' : role)}
Your branch: ${this.br(n, role === 'reviewer' ? 'merge' : role)}
Base branch: ${this.base}
Round ${this.t(n).rounds}, tier ${tierName(tier)}.
Co-author line for commits: ${this.coAuthor(tier.model)}
${locked}${extra}`;
  }

  // ---------- worktrees ----------

  async ensureWorktrees(n) {
    const fresh = [];
    for (const role of ['coder', 'tester', 'merge']) {
      const p = this.wt(n, role), b = this.br(n, role);
      if (existsSync(p)) continue;
      if (gitOk(this.root, 'rev-parse', '--verify', `refs/heads/${b}`)) git(this.root, 'worktree', 'add', p, b);
      else git(this.root, 'worktree', 'add', p, '-b', b, this.base);
      fresh.push(p);
    }
    if (fresh.length && this.sw.install) {
      this.emit(`#${n} install in ${fresh.length} worktree(s)`);
      const rs = await Promise.all(fresh.map((p) => sh(this.sw.install, [], { cwd: p, shell: true, timeoutMs: 20 * 60e3 })));
      const bad = rs.findIndex((r) => r.code !== 0);
      if (bad >= 0) throw new Critical(`install failed in ${fresh[bad]}: ${rs[bad].err.slice(-300)}`);
    }
  }
  clean(p) {
    if (existsSync(join(p, '.git')) && gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) gitOk(p, 'merge', '--abort');
    git(p, 'reset', '--hard', 'HEAD');
  }
  removeWorktrees(n, { branches }) {
    for (const role of ['coder', 'tester', 'merge']) {
      const p = this.wt(n, role);
      if (existsSync(p)) { gitOk(this.root, 'worktree', 'remove', '--force', p) || rmSync(p, { recursive: true, force: true }); }
      if (branches) gitOk(this.root, 'branch', '-D', this.br(n, role));
    }
    gitOk(this.root, 'worktree', 'prune');
  }

  // ---------- round merge ----------

  async mergeBranch(n, tier, issue, ref, side) {
    const p = this.wt(n, 'merge');
    if (gitOk(p, 'merge', '--no-ff', '--no-edit', ref)) return;
    const files = git(p, 'diff', '--name-only', '--diff-filter=U').split(/\r?\n/).filter(Boolean);
    if (side === 'base') {
      // Base moved under the ticket: let a merger agent settle it once, else stop.
      const out = await this.agent('swarm-merger', n, p, tier, this.facts(n, issue, 'merge', tier,
        `Task: a merge of ${ref} into ${this.br(n, 'merge')} stopped on conflicts in: ${files.join(', ')}.
Resolve them keeping both the ticket's intent and the base's changes, stage the paths, and commit with git commit --no-edit. If you cannot, run git merge --abort and report resolved=false.`), MERGE_SCHEMA);
      if (out.resolved && !gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) return;
      this.clean(p);
      throw new Critical(`conflict with ${ref} in ${files.join(', ')}: ${out.summary}`);
    }
    // Coder wins source files, tester wins test files.
    for (const f of files) {
      const theirs = this.testRe.test(f) ? side === 'tester' : side === 'coder';
      if (!gitOk(p, 'checkout', theirs ? '--theirs' : '--ours', '--', f)) { this.clean(p); throw new Critical(`conflict the rule cannot settle: ${f}`); }
      git(p, 'add', '--', f);
    }
    git(p, 'commit', '--no-edit');
  }

  // ---------- one ticket ----------

  async runTicket(n) {
    const T = this.t(n);
    const issue = getIssue(this.cfg, n);
    const planned = issue.item?.planned;
    T.phase = 'running'; this.save();
    setStatus(this.cfg, n, 'In progress');
    await this.ensureWorktrees(n);
    let relaunch = T.findings.length ? [...new Set(T.findings.map((f) => f.role))] : ['coder', 'tester'];
    for (;;) {
      const tier = tierAt(planned, T.failures);
      if (!tier) throw new Stop('ladder exhausted', 'exhausted');
      T.rounds++; this.save();
      this.emit(`#${n} round ${T.rounds} ${tierName(tier)}: ${relaunch.join(' + ')}`);
      const findingsText = T.findings.length
        ? `Reviewer findings to fix on your branch:\n${T.findings.filter((f) => relaunch.includes(f.role)).map((f, i) => `${i + 1}. ${f.file}${f.line ? ':' + f.line : ''} ${f.problem}${f.acceptance ? ` (acceptance: ${f.acceptance})` : ''}${f.repeat ? ' [REPEATED: add a test that proves the fix]' : ''}`).join('\n')}\n`
        : '';
      const merge = this.wt(n, 'merge');
      const tip = git(merge, 'rev-parse', 'HEAD');
      const jobs = relaunch.map(async (role) => {
        const p = this.wt(n, role);
        this.clean(p);
        if (T.rounds > 1) git(p, 'reset', '--hard', tip);
        const out = await this.agent(`swarm-${role}`, n, p, tier, this.facts(n, issue, role, tier, findingsText), WORK_SCHEMA);
        if (out.blocker) throw new Stop(`${role} blocker: ${out.blocker}`, 'blocked');
        const dirty = git(p, 'status', '--porcelain', '--untracked-files=no');
        this.emit(`#${n} ${role} ${git(p, 'rev-parse', '--short', 'HEAD')}: ${out.summary.split(/\r?\n/)[0].slice(0, 160)}${out.unmet.length ? ` | unmet: ${out.unmet.length}` : ''}${dirty ? ' | WARNING: uncommitted changes dropped' : ''}`);
      });
      await Promise.all(jobs);

      // Round merge: base first (keeps the review honest), then coder, then tester.
      this.clean(merge);
      await this.mergeBranch(n, tier, issue, this.base, 'base');
      // Merge every role branch the integration branch does not hold yet (covers commits from an earlier, interrupted run).
      for (const role of ['coder', 'tester']) {
        if (!gitOk(merge, 'merge-base', '--is-ancestor', this.br(n, role), 'HEAD')) await this.mergeBranch(n, tier, issue, this.br(n, role), role);
      }

      const head = git(merge, 'rev-parse', 'HEAD');
      const rv = await this.agent('swarm-reviewer', n, merge, tier, this.facts(n, issue, 'reviewer', tier,
        `Review: git diff ${this.base}...HEAD in your worktree. Do not edit, stage or commit.\nTag each finding with the role whose branch must fix it: tester for test files, coder for everything else.\n`), REVIEW_SCHEMA);
      if (git(merge, 'rev-parse', 'HEAD') !== head || git(merge, 'status', '--porcelain', '--untracked-files=no')) {
        this.emit(`#${n} reviewer changed the worktree; reset`);
        git(merge, 'reset', '--hard', head);
      }
      const note = rv.verdict === 'PASS' ? rv.commands.join('; ').slice(0, 200) : rv.findings.map((f) => `${f.file}: ${f.problem}`).join('; ').slice(0, 300);
      T.rows.push(`| #${n} | ${T.rounds} | ${tierName(tier)} | ${rv.verdict} | ${note.replace(/\|/g, '/').replace(/\r?\n/g, ' ')} |`);
      this.emit(`#${n} reviewer ${rv.verdict}${rv.verdict === 'FAIL' ? `: ${rv.findings.length} finding(s)` : ''}`);
      if (rv.verdict === 'PASS') { T.commands = rv.commands; this.save(); return this.land(n, issue, tier); }
      const prev = new Set(T.findings.map((f) => `${f.file}|${f.problem}`));
      T.findings = rv.findings.map((f) => ({ ...f, repeat: prev.has(`${f.file}|${f.problem}`) }));
      T.failures++; this.save();
      relaunch = [...new Set(T.findings.map((f) => f.role))];
      if (!relaunch.length) relaunch = ['coder', 'tester'];
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
      if (!existsSync(lp)) { mkdirSync(dirname(lp), { recursive: true }); writeFileSync(lp, '# Swarm log\n\n| Ticket | Round | Tier | Result | Notes |\n| --- | --- | --- | --- | --- |\n'); }
      appendFileSync(lp, T.rows.join('\n') + '\n');
      git(merge, 'add', '--', this.sw.log);
      git(merge, 'commit', '-m', `Swarm log for #${n}`);
    }
    const subject = `#${n} ${issue.title}`.slice(0, 72);
    const msg = `${subject}\n\nSwarm: ${T.rounds} round(s), final tier ${tierName(tier)}.\n\n${this.coAuthor(tier.model)}`;
    const sha = await this.squash(n, msg);
    this.emit(`#${n} squashed as ${sha.slice(0, 8)} on ${this.base}`);
    const cost = T.cost || 0;
    done(this.cfg, n, T.rounds, `Squashed as ${sha} on \`${this.base}\` after ${T.rounds} round(s), API cost $${cost.toFixed(2)}.\n\nReviewer checks:\n${(T.commands || []).map((c) => `- ${c}`).join('\n')}`, cost);
    this.removeWorktrees(n, { branches: true });
    T.phase = 'done'; T.commit = sha; this.save();
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
    const p = block.match(/^worktree (.*)$/m)[1];
    for (let i = 0; i < 30 && !gitOk(p, 'diff', '--cached', '--quiet'); i++) {
      if (i === 0) this.emit(`#${n} waiting: ${p} has staged changes from another session`);
      await sleep(10e3);
    }
    if (!gitOk(p, 'diff', '--cached', '--quiet')) throw new Critical(`${p} index busy; squash not done`);
    try { git(p, 'merge', '--squash', ref); } catch (e) { gitOk(p, 'reset', '--merge'); throw new Critical(`merge --squash refused in ${p}: ${String(e.stderr || e.message).slice(0, 300)}`); }
    git(p, 'commit', '-F', msgFile);
    return git(p, 'rev-parse', 'HEAD');
  }

  async stop(n, err) {
    const T = this.t(n);
    T.phase = err instanceof Stop ? err.kind : 'critical';
    T.reason = err.message; this.save();
    this.emit(`#${n} STOP ${T.phase}: ${err.message}`);
    try {
      setStatus(this.cfg, n, 'Backlog');
      if (T.cost) setCost(this.cfg, n, T.cost);
      const open = T.findings.map((f, i) => `${i + 1}. [${f.role}] ${f.file}${f.line ? ':' + f.line : ''} ${f.problem}`).join('\n');
      comment(this.cfg, n, `Swarm stopped (${T.phase}): ${err.message}\n\nRounds: ${T.rounds}. Work kept on branch \`${this.br(n, 'merge')}\`.\n\n${open ? `Open findings:\n${open}\n\n` : ''}| Ticket | Round | Tier | Result | Notes |\n| --- | --- | --- | --- | --- |\n${T.rows.join('\n')}`);
    } catch (e) { this.emit(`#${n} board/comment write failed: ${e.message}`); }
    if (T.phase !== 'critical') this.removeWorktrees(n, { branches: false });
  }

  // ---------- loop ----------

  async loop({ parent, only }) {
    const running = new Map();
    const warned = new Set();
    for (const [n, T] of Object.entries(this.state.tickets)) {
      if (T.phase === 'running') { T.phase = 'resume'; this.emit(`#${n} resuming at round ${T.rounds + 1}`); }
    }
    this.save();
    const start = (n) => {
      const p = this.runTicket(n).catch((e) => this.stop(n, e)).finally(() => running.delete(n));
      running.set(n, p);
    };
    for (;;) {
      let ready = [];
      if (parent) {
        const r = sync(this.cfg, parent);
        for (const m of r.moves) this.emit(`board ${m}`);
        ready = r.ready;
      }
      if (only) ready = only.filter((n) => getIssue(this.cfg, n).state === 'OPEN');
      const resume = Object.entries(this.state.tickets).filter(([, T]) => T.phase === 'resume').map(([n]) => Number(n));
      const queue = [...new Set([...resume, ...ready])].filter((n) => {
        if (running.has(n)) return false;
        const T = this.state.tickets[n];
        if (T && !['new', 'resume'].includes(T.phase)) return false;
        const planned = getIssue(this.cfg, n).item?.planned;
        if (!planned || !MODELS.includes(planned.toLowerCase())) {
          if (!warned.has(n)) { warned.add(n); this.emit(`#${n} NEED planned model (board.mjs planned ${n} <Haiku|Sonnet|Opus>)`); }
          return false;
        }
        return true;
      });
      while (running.size < this.sw.slots && queue.length) start(queue.shift());
      if (!running.size) break;
      await Promise.race([...running.values(), sleep(120e3)]);
    }
    const ts = Object.entries(this.state.tickets);
    this.emit(`FINISHED: ${ts.map(([n, T]) => `#${n} ${T.phase}${T.phase === 'done' ? ` ${T.commit?.slice(0, 8)} r${T.rounds}` : ''}`).join(', ') || 'nothing to run'}`);
    if (warned.size) this.emit(`waiting on planned model: ${[...warned].map((n) => '#' + n).join(' ')}`);
  }
}
class Critical extends Error {}
class Stop extends Error { constructor(msg, kind) { super(msg); this.kind = kind; } }

// ---------- lock ----------

async function lock(name, cmd) {
  const common = resolve(run('git', ['rev-parse', '--git-common-dir']));
  const dir = join(tmpdir(), `swarm-${createHash('sha1').update(common).digest('hex').slice(0, 10)}-${name}.lock`);
  const staleMs = 30 * 60e3;
  for (let waited = 0; ; waited++) {
    try { mkdirSync(dir); break; } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      let dead = false;
      try {
        const o = JSON.parse(readFileSync(join(dir, 'owner.json'), 'utf8'));
        try { process.kill(o.pid, 0); } catch { dead = true; }
        if (Date.now() - o.t > staleMs) dead = true;
      } catch { dead = Date.now() - statSync(dir).mtimeMs > 60e3; }
      if (dead) { rmSync(dir, { recursive: true, force: true }); continue; }
      if (waited % 30 === 0) console.error(`[lock ${name}] waiting...`);
      await sleep(2000);
    }
  }
  writeFileSync(join(dir, 'owner.json'), JSON.stringify({ pid: process.pid, t: Date.now(), cmd }));
  const release = () => rmSync(dir, { recursive: true, force: true });
  process.on('SIGINT', () => { release(); process.exit(130); });
  const code = await new Promise((res) => spawn(cmd, { shell: true, stdio: 'inherit' }).on('close', res));
  release();
  process.exit(code ?? 1);
}

// ---------- CLI ----------

const HELP = `swarm.mjs: ticket swarm runner (config docs/agents/board.json)
  run <parent> [--base <branch>] [--slots <k>]   swarm every ready child until none is left
  ticket <n>[,<n>...] [--base <branch>]          swarm the named tickets only
  status [<key>]                                 phase, rounds and tier of each ticket in a run
  gc                                             remove worktrees and branches of closed tickets
  lock [--name <name>] -- <command...>           run a command under a machine-wide mutex (default name: browser)
--no-install skips the install command in new worktrees. Base defaults to the current branch. State and event log: .claude/swarm/<key>.{json,log}.`;

function opt(a, name, def) { const i = a.indexOf(name); return i >= 0 ? a[i + 1] : def; }

async function main(argv) {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') return console.log(HELP);
  if (cmd === 'lock') {
    const i = a.indexOf('--');
    if (i < 0) throw new Error('lock needs -- <command>');
    return lock(opt(a.slice(0, i), '--name', 'browser'), a.slice(i + 1).join(' '));
  }
  const cfg = loadConfig(repoRoot());
  if (cmd === 'status') {
    const dir = join(cfg.root, '.claude', 'swarm');
    const files = existsSync(dir) ? readdirSync(dir).filter((f) => f.endsWith('.json') && (!a[0] || f === `${a[0]}.json`)) : [];
    for (const f of files) {
      const s = JSON.parse(readFileSync(join(dir, f), 'utf8'));
      console.log(`${s.key} (base ${s.base})`);
      for (const [n, T] of Object.entries(s.tickets)) console.log(`  #${n} ${T.phase} rounds=${T.rounds} failures=${T.failures} cost=$${(T.cost || 0).toFixed(2)}${T.reason ? ` (${T.reason})` : ''}`);
    }
    return;
  }
  if (cmd === 'gc') {
    const root = cfg.root;
    const branches = git(root, 'branch', '--format=%(refname:short)').split(/\r?\n/).filter((b) => /^ticket\/\d+/.test(b));
    const nums = [...new Set(branches.map((b) => Number(b.match(/^ticket\/(\d+)/)[1])))];
    for (const n of nums) {
      if (getIssue(cfg, n).state === 'OPEN') { console.log(`keep #${n} (open)`); continue; }
      for (const role of ['coder', 'tester', 'merge']) {
        const p = join(root, '.claude', 'worktrees', `t${n}-${role}`);
        if (existsSync(p)) gitOk(root, 'worktree', 'remove', '--force', p) || rmSync(p, { recursive: true, force: true });
      }
      for (const b of branches.filter((b) => b === `ticket/${n}` || b.startsWith(`ticket/${n}-`))) gitOk(root, 'branch', '-D', b);
      console.log(`removed #${n} worktrees and branches`);
    }
    gitOk(root, 'worktree', 'prune');
    return;
  }
  if (a.includes('--no-install')) cfg.swarm = { ...cfg.swarm, install: '' };
  const base = opt(a, '--base', git(cfg.root, 'branch', '--show-current'));
  if (!base) throw new Error('No base branch: pass --base');
  if (cmd === 'run') {
    const parent = Number(a[0]);
    if (!parent) throw new Error('run needs a parent issue number');
    const s = new Swarm(cfg, `p${parent}`, base);
    if (a.includes('--slots')) s.sw.slots = Number(opt(a, '--slots'));
    s.emit(`START parent #${parent} base ${s.base} slots ${s.sw.slots}`);
    return s.loop({ parent });
  }
  if (cmd === 'ticket') {
    const only = String(a[0]).split(',').map(Number).filter(Boolean);
    const s = new Swarm(cfg, `t${only.join('-')}`, base);
    s.sw.slots = Math.max(s.sw.slots, only.length);
    s.emit(`START tickets ${only.map((n) => '#' + n).join(' ')} base ${s.base}`);
    return s.loop({ only });
  }
  throw new Error(`Unknown command "${cmd}".\n${HELP}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((e) => { console.error(String(e.stderr || e.message || e).trim()); process.exit(1); });
}
