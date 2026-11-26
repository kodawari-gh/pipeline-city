// Swarm runner state: config, the state file, the event log, names, and one agent run.
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { StopError } from './errors.mjs';
import { stamp, sh, sleep } from './proc.mjs';
import { SELF, AGENT_ALLOW, AGENT_DENY, tierName, findClaude, agentsJson } from './agents.mjs';

/**
 * @typedef {{ keys: string[], dirs: string[] }} ShareDeps
 * @typedef {{ slots: number, permissionMode: string, agentTimeoutMin: number, testFile: string, locked: string[],
 *   coAuthor: Record<string, string>, install?: string, shareDeps?: ShareDeps, log?: string, claudeBin?: string,
 *   checks?: string[], rerun?: string[], allow?: string[] }} SwarmConfig
 */
/** The branch of a ticket role; `merge` holds the integration branch. */
export const ticketBranch = (n, role) => (role === 'merge' ? `ticket/${n}` : `ticket/${n}-${role}`);

export class SwarmBase {
  constructor(cfg, key, base) {
    this.cfg = cfg;
    /** @type {string} */
    this.root = cfg.root;
    /** @type {SwarmConfig} */
    this.sw = {
      slots: 2,
      permissionMode: 'auto',
      agentTimeoutMin: 60,
      testFile: String.raw`\.(test|spec)\.[cm]?[jt]sx?$`,
      locked: [],
      coAuthor: {},
      ...cfg.swarm,
    };
    this.dir = path.join(this.root, '.claude', 'swarm');
    mkdirSync(this.dir, { recursive: true });
    this.statePath = path.join(this.dir, `${key}.json`);
    this.logPath = path.join(this.dir, `${key}.log`);
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
    this.agentSettings = JSON.stringify({
      permissions: { allow: [...AGENT_ALLOW, ...(this.sw.allow ?? [])], deny: AGENT_DENY },
    });
    this.testRe = new RegExp(this.sw.testFile, 'u');
  }
  save() {
    writeFileSync(this.statePath, JSON.stringify(this.state, null, 2));
  }
  emit(line) {
    const l = `${stamp()} ${line}`;
    console.log(l);
    appendFileSync(this.logPath, `${l}\n`);
  }
  t(n) {
    return (this.state.tickets[n] ||= { phase: 'new', failures: 0, rounds: 0, rows: [], findings: [] });
  }
  wt(n, role) {
    return path.join(this.root, '.claude', 'worktrees', `t${n}-${role}`);
  }
  coAuthor(model) {
    const name = this.sw.coAuthor[model] ?? `Claude ${model[0].toUpperCase()}${model.slice(1)}`;
    return `Co-Authored-By: ${name} <noreply@anthropic.com>`;
  }

  /** Run one agent with a JSON output schema, twice at most. Returns its structured output. */
  async agent({ role, n, cwd, tier, prompt, schema }) {
    const args = [
      '-p',
      '--agents',
      this.agents,
      '--agent',
      role,
      '--model',
      tier.model,
      '--effort',
      (role === 'swarm-coder' && process.env.SWARM_EFFORT) || tier.effort,
      '--output-format',
      'json',
      '--json-schema',
      JSON.stringify(schema),
      '--permission-mode',
      this.sw.permissionMode,
      '--permission-prompts',
      'none',
      '--settings',
      this.agentSettings,
    ];
    let limitWaits = 0;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const r = await sh(this.claude, args, { cwd, input: prompt, timeoutMs: this.sw.agentTimeoutMin * 60e3 });
      let j = null;
      try {
        j = JSON.parse(r.out);
      } catch {
        // No JSON: the failure line below shows the output.
      }
      const so = j?.structured_output;
      if (j?.total_cost_usd) {
        const T = this.t(n);
        T.cost = (T.cost || 0) + j.total_cost_usd;
        this.save();
      }
      if (r.code === 0 && so && !j.is_error) {
        this.reportDenials(n, role, j.permission_denials ?? []);
        if (so.permission) {
          throw new StopError(`${role} needs permission: ${so.permission}`, 'permission');
        }
        return so;
      }
      const why = r.timedOut
        ? 'timed out'
        : (j?.result || r.err || r.out).toString().trim().split(/\r?\n/u).slice(-3).join(' | ').slice(0, 300);
      if (/hit your .*limit/iu.test(why) && ++limitWaits <= 36) {
        this.emit(`#${n} ${role} usage limit hit, waiting 10 min: ${why}`);
        await sleep(600e3);
        attempt--;
        continue;
      }
      this.emit(`#${n} ${role} attempt ${attempt} failed: ${why}`);
    }
    throw new StopError(`${role} agent failed twice`, 'critical');
  }

  /** Log each refused tool call with its command or path, so a missing allow rule is easy to see. */
  reportDenials(n, role, denials) {
    if (denials.length === 0) {
      return;
    }
    const what = denials
      .map((d) => `${d.tool_name}(${String(d.tool_input?.command ?? d.tool_input?.file_path ?? '').slice(0, 100)})`)
      .join(', ');
    this.emit(`#${n} ${role}: ${denials.length} permission denial(s): ${what}`);
  }

  /** Repo gates as a quoted list, or '' when `swarm.checks` is empty. */
  gatesList() {
    return (this.sw.checks ?? []).map((c) => `"${c}"`).join(', ');
  }

  /** The ticket text and the facts an agent needs: worktree, branches, round, tier, locks and gates. */
  facts(n, { issue, role, tier, extra = '' }) {
    const lockLine =
      this.sw.locked.length > 0
        ? `Shared-resource lock: run any command starting with ${this.sw.locked.map((c) => `"${c}"`).join(', ')} as: node "${SELF}" lock -- <command>\n`
        : '';
    const depsLine = this.sw.shareDeps
      ? `Dependencies: ${this.sw.shareDeps.dirs.join(', ')} link to an install other worktrees share. Never run "${this.sw.install}" or a package add/remove command there. To change dependencies, first run: node "${SELF}" deps (it makes a private install in your worktree).\n`
      : '';
    const gates = this.gatesList();
    const checksLine = gates
      ? `Repo gates the runner runs on the integration branch after the round merge: ${gates}. Do not run them yourself; run only the checks for what you touched.\n`
      : '';
    const at = role === 'reviewer' || role === 'merge' ? this.intRole(n) : role;
    return `Ticket #${n} in ${this.cfg.repo}: "${issue.title}". Its full text is below; do not fetch it again.
<ticket>
${(issue.body ?? '').trim()}
</ticket>
Your worktree (cwd): ${this.wt(n, at)}
Commands already run in this worktree. Run each one bare, with no "cd ... &&" prefix and no "&&" chain: allow rules match only a bare command, and a chained one is refused.
Commit hooks always run. When a hook fails, fix the cause (a hook that says to update a baseline means run that update) and commit again.
Your branch: ${ticketBranch(n, at)}
Base branch: ${this.base}
Round ${this.t(n).rounds}, tier ${tierName(tier)}.
Co-author line for commits: ${this.coAuthor(tier.model)}
${lockLine}${depsLine}${role === 'reviewer' ? '' : checksLine}${extra}`;
  }

  // ---------- worktrees ----------

  /**
   * Worktree roles a ticket needs. `Tests: none` means no tester, and with one worker the coder's branch
   * is the integration branch: no merge worktree.
   */
  roles(n) {
    return this.t(n).noTests ? ['coder'] : ['coder', 'tester', 'merge'];
  }
  /** The role whose worktree and branch hold the integration branch. */
  intRole(n) {
    return this.t(n).noTests ? 'coder' : 'merge';
  }
}
