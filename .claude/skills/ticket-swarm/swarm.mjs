#!/usr/bin/env node
// Ticket swarm runner. Drives coder + tester -> round merge -> reviewer -> squash for tickets on a
// GitHub Projects board, escalating model and effort per reviewer FAIL. Prints one event line per stage.
// Config: <repo>/docs/agents/board.json (see update-gh-board). Run with no args for help.
// Modules: base (state, agent runs), worktrees, merge, ticket (one ticket), this file (the loop and the CLI).
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { loadConfig, getIssue, sync, repoRoot } from '../update-gh-board/board.mjs';
import { sleep, git } from './proc.mjs';
import { privateDeps } from './deps.mjs';
import { MODELS, RESUMABLE } from './agents.mjs';
import { gc, parentBranch, lock, retry } from './commands.mjs';
import { SwarmTicket } from './ticket.mjs';

export { tierAt, tierName } from './agents.mjs';

class Swarm extends SwarmTicket {
  /** A critical or permission stop keeps its worktrees; a rerun resumes it once the cause is fixed. */
  markResumes() {
    for (const [n, T] of Object.entries(this.state.tickets)) {
      if (RESUMABLE.has(T.phase)) {
        T.phase = 'resume';
        delete T.reason;
        this.emit(`#${n} resuming at round ${T.rounds + 1}`);
      }
    }
    this.save();
  }

  /** Run one ticket; a failure stops it. Leaves `running` when done either way. */
  async guardedTicket(n, running) {
    try {
      await this.runTicket(n);
    } catch (error) {
      this.stop(n, error);
    } finally {
      running.delete(n);
    }
  }

  /** Tickets to start now: resumes first, then ready ones. Warns once per ticket with no swarmable planned model. */
  nextTickets({ parent, only, running, warned }) {
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
    return [...new Set([...resume, ...ready])].filter((n) => {
      if (running.has(n)) {
        return false;
      }
      const T = this.state.tickets[n];
      if (T && !['new', 'resume'].includes(T.phase)) {
        return false;
      }
      const issue = getIssue(this.cfg, n);
      if (issue.state !== 'OPEN') {
        if (T) {
          T.phase = 'closed';
          this.save();
          this.emit(`#${n} closed outside the swarm; not run`);
        }
        return false;
      }
      const planned = issue.item?.planned;
      if (!planned || !MODELS.includes(planned.toLowerCase())) {
        if (!warned.has(n)) {
          warned.add(n);
          this.emit(`#${n} NEED planned model (board.mjs planned ${n} <Haiku|Sonnet|Opus>)`);
        }
        return false;
      }
      return true;
    });
  }

  async loop({ parent, only }) {
    const running = new Map();
    const warned = new Set();
    this.markResumes();
    for (;;) {
      const queue = this.nextTickets({ parent, only, running, warned });
      while (running.size < this.sw.slots && queue.length > 0) {
        const n = queue.shift();
        running.set(n, this.guardedTicket(n, running));
      }
      if (running.size === 0) {
        break;
      }
      await Promise.race([...running.values(), sleep(120e3)]);
    }
    const ts = Object.entries(this.state.tickets);
    this.emit(
      `FINISHED: ${ts.map(([n, T]) => `#${n} ${T.phase}${T.phase === 'done' ? ` ${T.commit?.slice(0, 8)} r${T.rounds}` : ''}`).join(', ') || 'nothing to run'}`,
    );
    if (warned.size > 0) {
      this.emit(`waiting on planned model: ${[...warned].map((n) => `#${n}`).join(' ')}`);
    }
    for (const line of gc(this.cfg)) {
      this.emit(`gc: ${line}`);
    }
  }
}

// ---------- CLI ----------

const HELP = `swarm.mjs: ticket swarm runner (config docs/agents/board.json)
  run <parent> [--base <branch>] [--from <ref>] [--slots <k>]   swarm every ready child until none is left
  ticket <n>[,<n>...] [--base <branch>]          swarm the named tickets only
  catchup <parent> [--from <ref>] [--model <m>] [--effort <e>]   merge <ref> (default: current branch) into parent/<parent>; a merger agent settles conflicts; then the gates
  status [<key>]                                 phase, rounds and tier of each ticket in a run
  retry <key> <n>                                mark a stopped ticket to resume from its kept branches on the next run
  gc                                             remove worktrees and branches of closed tickets, and unused shared installs
  deps                                           in a swarm worktree: replace shared dependency links with a private install
  lock [--name <name>] -- <command...>           run a command under a machine-wide mutex (default name: browser)
run: base defaults to parent/<parent>, made from --from (default: the current branch) when missing; gc runs at the end.
ticket: base defaults to the current branch.
--no-install skips the install command in new worktrees. State and event log: .claude/swarm/<key>.{json,log}.`;

function opt(a, name, def) {
  const i = a.indexOf(name);
  return i === -1 ? def : a[i + 1];
}

function showStatus(cfg, key) {
  const dir = path.join(cfg.root, '.claude', 'swarm');
  const files = existsSync(dir)
    ? readdirSync(dir).filter((f) => f.endsWith('.json') && (!key || f === `${key}.json`))
    : [];
  for (const f of files) {
    const s = JSON.parse(readFileSync(path.join(dir, f), 'utf8'));
    console.log(`${s.key} (base ${s.base})`);
    for (const [n, T] of Object.entries(s.tickets)) {
      console.log(
        `  #${n} ${T.phase} rounds=${T.rounds} failures=${T.failures} cost=$${(T.cost || 0).toFixed(2)}${T.reason ? ` (${T.reason})` : ''}`,
      );
    }
  }
}

// Commands that read the config only: (cfg, args).
const CONFIG_COMMANDS = {
  status: (cfg, a) => {
    showStatus(cfg, a[0]);
  },
  retry: (cfg, a) => {
    retry(cfg, a[0], a[1]);
  },
  gc: (cfg) => {
    for (const line of gc(cfg)) {
      console.log(line);
    }
  },
  deps: async (cfg) => privateDeps(cfg),
};

// Commands that run agents: ({ cfg, root, current, a }), `current` is the checked-out branch.
const RUN_COMMANDS = {
  run: async ({ cfg, root, current, a }) => {
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
  },
  catchup: async ({ cfg, current, a }) => {
    const parent = Number(a[0]);
    if (!parent) {
      throw new Error('catchup needs a parent issue number');
    }
    const s = new Swarm(cfg, `p${parent}-catchup`, `parent/${parent}`);
    const tier = { model: opt(a, '--model', 'opus'), effort: opt(a, '--effort', 'high') };
    return s.catchUp(parent, opt(a, '--from', current === '' ? 'HEAD' : current), tier);
  },
  ticket: async ({ cfg, current, a }) => {
    const base = opt(a, '--base', current);
    if (!base) {
      throw new Error('No base branch: pass --base');
    }
    const only = String(a[0]).split(',').map(Number).filter(Boolean);
    const s = new Swarm(cfg, `t${only.join('-')}`, base);
    s.sw.slots = Math.max(s.sw.slots, only.length);
    s.emit(`START tickets ${only.map((n) => `#${n}`).join(' ')} base ${s.base}`);
    return s.loop({ only });
  },
};

async function main(argv) {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return;
  }
  if (cmd === 'lock') {
    const i = a.indexOf('--');
    if (i === -1) {
      throw new Error('lock needs -- <command>');
    }
    await lock(opt(a.slice(0, i), '--name', 'browser'), a.slice(i + 1).join(' '));
    return;
  }
  const root = repoRoot();
  const cfg = loadConfig(root);
  if (Object.hasOwn(CONFIG_COMMANDS, cmd)) {
    await CONFIG_COMMANDS[cmd](cfg, a);
    return;
  }
  if (a.includes('--no-install')) {
    cfg.swarm = { ...cfg.swarm, install: '' };
  }
  /** @type {string} */
  const current = git(root, 'branch', '--show-current');
  if (!Object.hasOwn(RUN_COMMANDS, cmd)) {
    throw new Error(`Unknown command "${cmd}".\n${HELP}`);
  }
  await RUN_COMMANDS[cmd]({ cfg, root, current, a });
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  try {
    await main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.stderr || error.message || error).trim());
    process.exit(1);
  }
}
