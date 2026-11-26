// One swarm ticket: work rounds, the round merge, the review, landing and stopping.
import { existsSync, writeFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { getIssue, setStatus, setCost, done, comment } from '../update-gh-board/board.mjs';
import { StopError } from './errors.mjs';
import { settleWorkers, git, gitOk } from './proc.mjs';
import { RESUMABLE, WORK_SCHEMA, REVIEW_SCHEMA, tierAt, tierName } from './agents.mjs';
import { ticketBranch } from './base.mjs';
import { cleanWorktree } from './worktrees.mjs';
import { SwarmMerge } from './merge.mjs';

const findingLine = (f, i) =>
  `${i + 1}. ${f.file}${f.line ? `:${f.line}` : ''} ${f.problem}${f.acceptance ? ` (acceptance: ${f.acceptance})` : ''}${f.repeat ? ' [REPEATED: add a test that proves the fix]' : ''}`;

export class SwarmTicket extends SwarmMerge {
  /** Mark the ticket running, move it to In progress and make its worktrees. Returns the issue. */
  async startTicket(n) {
    const T = this.t(n);
    const issue = getIssue(this.cfg, n);
    T.cut = T.phase === 'resume';
    T.phase = 'running';
    T.noTests = /^Tests:\s*none\b/imu.test(issue.body ?? '');
    this.save();
    setStatus(this.cfg, n, 'In progress');
    await this.ensureWorktrees(n);
    if (T.noTests) {
      this.emit(`#${n} Tests: none, no tester`);
    }
    return issue;
  }

  /**
   * True when a stop cut a round after its workers finished: a role commit is not merged yet, or the merge
   * stopped in the gates (`gateHead`) or in the review (`reviewHead`). The round then resumes at the merge.
   */
  reviewPending(n, merge, workers) {
    const T = this.t(n);
    const head = git(merge, 'rev-parse', 'HEAD');
    return (
      T.rounds > 0 &&
      (T.reviewHead === head ||
        T.gateHead === head ||
        workers.some((r) => !gitOk(merge, 'merge-base', '--is-ancestor', ticketBranch(n, r), 'HEAD')))
    );
  }

  /**
   * Open a ticket's integration worktree. Returns true when the round resumes at the merge.
   * After a cut-off run it saves uncommitted work first; with one worker that worktree is the coder's,
   * so `prepare` decides what happens to the work.
   */
  reopen(n, merge, workers) {
    const T = this.t(n);
    if (T.cut) {
      this.saveWip(n);
    }
    const pending = this.reviewPending(n, merge, workers);
    if (pending || !T.cut || this.intRole(n) === 'merge') {
      cleanWorktree(merge);
    }
    return pending;
  }

  async runTicket(n) {
    const T = this.t(n);
    const issue = await this.startTicket(n);
    const planned = issue.item?.planned;
    const workers = this.roles(n).filter((r) => r !== 'merge');
    const routed = (findings) => {
      const r = [...new Set(findings.map((f) => (T.noTests ? 'coder' : f.role)))];
      return r.length > 0 ? r : workers;
    };
    let relaunch = T.findings.length > 0 ? routed(T.findings) : workers;
    const merge = this.wt(n, this.intRole(n));
    let pending = this.reopen(n, merge, workers);
    for (;;) {
      const tier = tierAt(planned, T.failures);
      if (!tier) {
        throw new StopError('ladder exhausted', 'exhausted');
      }
      if (pending) {
        this.emit(`#${n} round ${T.rounds} resumes at the round merge`);
        relaunch = [];
      } else {
        T.rounds++;
        this.save();
        this.emit(`#${n} round ${T.rounds} ${tierName(tier)}: ${relaunch.join(' + ')}`);
      }
      pending = false;
      await this.workRound(n, { issue, tier, relaunch });
      await this.roundMerge(n, { issue, tier, workers });
      // Repo gates run here, by the runner: a failure goes back to the workers without a reviewer run.
      T.gateHead = git(merge, 'rev-parse', 'HEAD');
      this.save();
      const failed = await this.runChecks(n, merge);
      delete T.gateHead;
      if (failed) {
        this.gateFail(n, tier, failed);
        relaunch = workers;
        continue;
      }
      const rv = await this.review(n, { issue, tier });
      if (rv.verdict === 'PASS') {
        T.commands = [...(this.sw.checks ?? []).map((c) => `${c}: ok (runner)`), ...rv.commands];
        this.save();
        return this.land(n, issue, tier);
      }
      this.failRound(n, rv.findings);
      relaunch = routed(T.findings);
    }
  }

  /** A reviewer FAIL: keep its findings, each marked when the last round had it too, and count the failure. */
  failRound(n, findings) {
    const T = this.t(n);
    const prev = new Set(T.findings.map((f) => `${f.file}|${f.problem}`));
    for (const f of findings) {
      f.repeat = prev.has(`${f.file}|${f.problem}`);
    }
    T.findings = findings;
    T.failures++;
    this.save();
  }

  /** Run the `relaunch` workers in parallel on the integration tip, each with its own findings. */
  async workRound(n, { issue, tier, relaunch }) {
    const T = this.t(n);
    const findingsText =
      T.findings.length > 0
        ? `Reviewer findings to fix on your branch:\n${T.findings
            .filter((f) => T.noTests || relaunch.includes(f.role))
            .map((f, i) => findingLine(f, i))
            .join('\n')}\n`
        : '';
    const tip = git(this.wt(n, this.intRole(n)), 'rev-parse', 'HEAD');
    const blockers = [];
    const jobs = relaunch.map(async (role) => this.runWorker(n, { role, issue, tier, tip, findingsText, blockers }));
    await settleWorkers(jobs, blockers);
    T.cut = false;
  }

  /** One worker agent on its own branch. A blocker it reports goes to `blockers`. */
  async runWorker(n, { role, issue, tier, tip, findingsText, blockers }) {
    const p = this.wt(n, role);
    const keptText = this.prepare(n, p, tip);
    await this.relinkDeps(n, p);
    const out = await this.agent({
      role: `swarm-${role}`,
      n,
      cwd: p,
      tier,
      prompt: this.facts(n, { issue, role, tier, extra: keptText + findingsText }),
      schema: WORK_SCHEMA,
    });
    if (out.blocker && role === 'tester') {
      // A failing test is the coder's work, not a stop: the reviewer sends it back as a finding.
      this.emit(`#${n} tester note: ${out.blocker.slice(0, 200)}`);
    } else if (out.blocker) {
      blockers.push(`${role} blocker: ${out.blocker}`);
      return;
    }
    const dirty = git(p, 'status', '--porcelain', '--untracked-files=no');
    this.emit(
      `#${n} ${role} ${git(p, 'rev-parse', '--short', 'HEAD')}: ${out.summary.split(/\r?\n/u)[0].slice(0, 160)}${out.unmet.length > 0 ? ` | unmet: ${out.unmet.length}` : ''}${dirty ? ' | WARNING: uncommitted changes dropped' : ''}`,
    );
  }

  /** Round merge: base first (keeps the review honest), then coder, then tester. */
  async roundMerge(n, { issue, tier, workers }) {
    const int = this.intRole(n);
    const merge = this.wt(n, int);
    cleanWorktree(merge);
    await this.mergeBranch(n, { tier, issue, ref: this.base, side: 'base' });
    // Merge every role branch the integration branch does not hold yet (covers commits from an earlier, interrupted run).
    for (const role of workers.filter((r) => r !== int)) {
      if (!gitOk(merge, 'merge-base', '--is-ancestor', ticketBranch(n, role), 'HEAD')) {
        await this.mergeBranch(n, { tier, issue, ref: ticketBranch(n, role), side: role });
      }
    }
    await this.relinkDeps(n, merge);
  }

  /** The reviewer agent on the integration branch. Records its row and returns its verdict. */
  async review(n, { issue, tier }) {
    const T = this.t(n);
    const merge = this.wt(n, this.intRole(n));
    const head = git(merge, 'rev-parse', 'HEAD');
    T.reviewHead = head;
    this.save();
    const rv = await this.agent({
      role: 'swarm-reviewer',
      n,
      cwd: merge,
      tier,
      prompt: this.facts(n, { issue, role: 'reviewer', tier, extra: this.reviewTask(n) }),
      schema: REVIEW_SCHEMA,
    });
    delete T.reviewHead;
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
      `| #${n} | ${T.rounds} | ${tierName(tier)} | ${rv.verdict} | ${note.replaceAll('|', '/').replaceAll(/\r?\n/gu, ' ')} |`,
    );
    this.emit(`#${n} reviewer ${rv.verdict}${rv.verdict === 'FAIL' ? `: ${rv.findings.length} finding(s)` : ''}`);
    return rv;
  }

  async land(n, issue, tier) {
    const T = this.t(n);
    setStatus(this.cfg, n, 'In review');
    const merge = this.wt(n, this.intRole(n));
    await this.mergeBranch(n, { tier, issue, ref: this.base, side: 'base' });
    // Swarm log rows land with the squash.
    if (this.sw.log) {
      const lp = path.join(merge, this.sw.log);
      if (!existsSync(lp)) {
        mkdirSync(path.dirname(lp), { recursive: true });
        writeFileSync(
          lp,
          '# Swarm log\n\n| Ticket | Round | Tier | Result | Notes |\n| --- | --- | --- | --- | --- |\n',
        );
      }
      appendFileSync(lp, `${T.rows.join('\n')}\n`);
      git(merge, 'add', '--', this.sw.log);
      git(merge, 'commit', '-m', `Swarm log for #${n}`);
    }
    const subject = `#${n} ${issue.title}`.slice(0, 72);
    const msg = `${subject}\n\nSwarm: ${T.rounds} round(s), final tier ${tierName(tier)}.\n\n${this.coAuthor(tier.model)}`;
    const sha = await this.squash(n, msg);
    this.emit(`#${n} squashed as ${sha.slice(0, 8)} on ${this.base}`);
    const cost = T.cost || 0;
    done(this.cfg, n, {
      rounds: T.rounds,
      body: `Squashed as ${sha} on \`${this.base}\` after ${T.rounds} round(s), API cost $${cost.toFixed(2)}.\n\nReviewer checks:\n${(T.commands || []).map((c) => `- ${c}`).join('\n')}`,
      cost,
    });
    this.removeWorktrees(n, { branches: true });
    T.phase = 'done';
    T.commit = sha;
    this.save();
    this.emit(`#${n} DONE rounds=${T.rounds} cost=$${cost.toFixed(2)}`);
  }
  stop(n, err) {
    const T = this.t(n);
    T.phase = err instanceof StopError ? err.kind : 'critical';
    T.reason = err.message;
    this.save();
    this.emit(
      T.phase === 'permission'
        ? `#${n} NEED permission: ${err.message} (add a rule to swarm.allow in board.json, then rerun)`
        : `#${n} STOP ${T.phase}: ${err.message}`,
    );
    const wip = this.saveWip(n);
    if (wip.length > 0) {
      this.emit(`#${n} uncommitted work saved: ${wip.join(', ')}`);
    }
    try {
      setStatus(this.cfg, n, 'Backlog');
      if (T.cost) {
        setCost(this.cfg, n, T.cost);
      }
      const open = T.findings
        .map((f, i) => `${i + 1}. [${f.role}] ${f.file}${f.line ? `:${f.line}` : ''} ${f.problem}`)
        .join('\n');
      comment(
        this.cfg,
        n,
        `Swarm stopped (${T.phase}): ${err.message}\n\nRounds: ${T.rounds}. Work kept on branch \`${ticketBranch(n, this.intRole(n))}\`.${wip.length > 0 ? ` Uncommitted work: ${wip.map((r) => `\`${r}\``).join(', ')} (see it with \`git show --stat <ref>\`).` : ''}\n\n${open ? `Open findings:\n${open}\n\n` : ''}| Ticket | Round | Tier | Result | Notes |\n| --- | --- | --- | --- | --- |\n${T.rows.join('\n')}`,
      );
    } catch (error) {
      this.emit(`#${n} board/comment write failed: ${error.message}`);
    }
    if (!RESUMABLE.has(T.phase)) {
      this.removeWorktrees(n, { branches: false });
    }
  }
}
