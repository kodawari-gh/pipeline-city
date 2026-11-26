// Swarm merges: the round merge into the integration branch, the parent catch-up, gate failures and the squash.
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { getIssue } from '../update-gh-board/board.mjs';
import { StopError } from './errors.mjs';
import { sleep, sh, git, gitOk } from './proc.mjs';
import { removeWorktree } from './deps.mjs';
import { MERGE_SCHEMA, tierName } from './agents.mjs';
import { ticketBranch } from './base.mjs';
import { SwarmWorktrees, cleanWorktree } from './worktrees.mjs';

export class SwarmMerge extends SwarmWorktrees {
  // ---------- round merge ----------

  /** Merge `ref` into the integration branch. `side` (coder, tester or base) settles role conflicts. */
  async mergeBranch(n, { tier, issue, ref, side }) {
    const p = this.wt(n, this.intRole(n));
    if (gitOk(p, 'merge', '--no-ff', '--no-edit', ref)) {
      return;
    }
    if (!gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
      cleanWorktree(p);
      throw new StopError(`merge of ${ref} did not start`, 'critical');
    }
    const files = git(p, 'diff', '--name-only', '--diff-filter=U').split(/\r?\n/u).filter(Boolean);
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
    const into = ticketBranch(n, this.intRole(n));
    const extra = `Task: the merge of ${ref} into ${into} is in progress and ${why}
Finish it: keep the ticket's intent and the other side's changes, make the repo's commit hooks pass, stage the paths, and commit with git commit --no-edit. If you cannot, run git merge --abort and report resolved=false.`;
    const out = await this.agent({
      role: 'swarm-merger',
      n,
      cwd: p,
      tier,
      prompt: this.facts(n, { issue, role: 'merge', tier, extra }),
      schema: MERGE_SCHEMA,
    });
    if (out.resolved && !gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
      return;
    }
    cleanWorktree(p);
    throw new StopError(`merge of ${ref} ${why.split('\n')[0]}: ${out.summary}`, 'critical');
  }

  // ---------- parent catch-up ----------

  /**
   * Merge `ref` into the base in a worktree of its own, then run the repo gates. A merger agent settles
   * conflicts. Run once every child is done, before the parent's PR. A rerun resumes in the kept worktree.
   */
  async catchUp(parent, ref, tier) {
    const p = path.join(this.root, '.claude', 'worktrees', `p${parent}-catchup`);
    if (!existsSync(path.join(p, '.git'))) {
      gitOk(this.root, 'worktree', 'prune');
      git(this.root, 'worktree', 'add', p, this.base);
    }
    if (this.sw.shareDeps) {
      await this.ensureDeps(parent, p);
    } else if (this.sw.install) {
      await sh(this.sw.install, [], { cwd: p, shell: true, timeoutMs: 20 * 60e3 });
    }
    this.emit(`#${parent} catch-up: merge ${ref} into ${this.base}`);
    if (!gitOk(p, 'merge', '--no-ff', '--no-edit', ref)) {
      await this.settleCatchUp({ parent, p, ref, tier });
    }
    const failed = await this.runChecks(parent, p);
    if (failed) {
      throw new StopError(`catch-up gate failed: ${failed.cmd}\n${failed.tail.slice(-800)}`, 'critical');
    }
    removeWorktree(this.root, this.sw.shareDeps, p);
    gitOk(this.root, 'worktree', 'prune');
    this.emit(`#${parent} catch-up DONE: ${this.base} at ${git(this.root, 'rev-parse', '--short', this.base)}`);
  }

  async settleCatchUp({ parent, p, ref, tier }) {
    if (!gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
      throw new StopError(`catch-up merge of ${ref} did not start`, 'critical');
    }
    const files = git(p, 'diff', '--name-only', '--diff-filter=U').split(/\r?\n/u).filter(Boolean);
    this.emit(`#${parent} catch-up conflicts: ${files.join(', ')}`);
    const issue = getIssue(this.cfg, parent);
    const prompt = `Parent #${parent} in ${this.cfg.repo}: "${issue.title}". Branch ${this.base} holds its finished children.
<parent>
${(issue.body ?? '').trim()}
</parent>
Your worktree (cwd): ${p}
Commands already run in this worktree. Run each one bare, with no "cd ... &&" prefix and no "&&" chain.
Commit hooks always run. When a hook fails, fix the cause (a hook that says to update a baseline means run that update) and commit again.
Co-author line for commits: ${this.coAuthor(tier.model)}
Task: the merge of ${ref} into ${this.base} stopped on conflicts in: ${files.join(', ')}.
Keep the parent's changes and every change ${ref} made: when ${this.base} moved or rewrote code that ${ref} edited, apply the ${ref} edit to the new code. Stage the paths, and commit with git commit --no-edit. If you cannot, run git merge --abort and report resolved=false.`;
    const out = await this.agent({ role: 'swarm-merger', n: parent, cwd: p, tier, prompt, schema: MERGE_SCHEMA });
    if (!out.resolved || gitOk(p, 'rev-parse', '-q', '--verify', 'MERGE_HEAD')) {
      throw new StopError(`catch-up merge of ${ref} not settled: ${out.summary}`, 'critical');
    }
    this.emit(`#${parent} catch-up merger: ${out.summary.split(/\r?\n/u)[0].slice(0, 200)}`);
  }

  /** Settle one conflicted file by the role rule. False when git cannot. */
  takeSide(p, f, side) {
    const theirs = this.testRe.test(f) ? side === 'tester' : side === 'coder';
    if (!gitOk(p, 'checkout', theirs ? '--theirs' : '--ours', '--', f)) {
      return false;
    }
    git(p, 'add', '--', f);
    return true;
  }

  /** A repo gate failed: count a FAIL round and send the output to every worker, each for its own files. */
  gateFail(n, tier, failed) {
    const T = this.t(n);
    const workers = this.roles(n).filter((r) => r !== 'merge');
    T.rows.push(
      `| #${n} | ${T.rounds} | ${tierName(tier)} | FAIL | runner check failed: ${failed.cmd.replaceAll('|', '/')} |`,
    );
    // The merged source is the contract: only the tester adapts to a name or shape. Else both rename to match each other, and swap places each round.
    const side = {
      tester:
        'Fix test files only. The exported names and shapes of the merged source are final: make the tests use them. Never ask for a rename.',
      coder:
        'Fix source and docs only. Keep every exported name and shape the merged source has; add, never rename or remove. A test that disagrees on a name is the tester to fix.',
    };
    T.findings = workers.map((role) => ({
      role,
      file: '(repo gate)',
      problem: `"${failed.cmd}" failed after the round merge. ${side[role] ?? ''} Output tail:\n${failed.tail}`,
    }));
    T.failures++;
    this.save();
  }

  reviewTask(n) {
    const gates = this.gatesList();
    const ran = gates
      ? `The runner ran these repo gates on this HEAD and they passed; do not rerun them: ${gates}. Run only the ticket's other checks.\n`
      : '';
    const tag = this.t(n).noTests
      ? 'The ticket says Tests: none. Tag every finding coder.'
      : 'Tag each finding with the role whose branch must fix it: tester for test files, coder for everything else.';
    return `Review: git diff ${this.base}...HEAD in your worktree. Do not edit, stage or commit.\n${ran}${tag}\n`;
  }
  /** Squash ticket/<n> onto base as one commit, without touching unrelated staged work. */
  async squash(n, msg) {
    const ref = ticketBranch(n, this.intRole(n));
    const wl = git(this.root, 'worktree', 'list', '--porcelain');
    const block = wl.split(/\r?\n\r?\n/u).find((b) => b.includes(`branch refs/heads/${this.base}`));
    const msgFile = path.join(this.dir, `msg-${n}.txt`);
    writeFileSync(msgFile, msg);
    if (!block) {
      const tree = git(this.root, 'rev-parse', `${ref}^{tree}`);
      const old = git(this.root, 'rev-parse', this.base);
      const sha = git(this.root, 'commit-tree', tree, '-p', old, '-F', msgFile);
      git(this.root, 'update-ref', `refs/heads/${this.base}`, sha, old);
      return sha;
    }
    const { p } = /^worktree (?<p>.*)$/mu.exec(block).groups;
    for (let i = 0; i < 30 && !gitOk(p, 'diff', '--cached', '--quiet'); i++) {
      if (i === 0) {
        this.emit(`#${n} waiting: ${p} has staged changes from another session`);
      }
      await sleep(10e3);
    }
    if (!gitOk(p, 'diff', '--cached', '--quiet')) {
      throw new StopError(`${p} index busy; squash not done`, 'critical');
    }
    try {
      git(p, 'merge', '--squash', ref);
    } catch (error) {
      gitOk(p, 'reset', '--merge');
      throw new StopError(
        `merge --squash refused in ${p}: ${String(error.stderr || error.message).slice(0, 300)}`,
        'critical',
      );
    }
    try {
      git(p, 'commit', '-F', msgFile);
    } catch (error) {
      // Leave the checkout as it was: unstage the squash and restore the files.
      gitOk(p, 'reset', '--merge');
      throw new StopError(
        `squash commit refused in ${p}: ${`${error.stdout ?? ''}${error.stderr ?? ''}`.slice(-300)}`,
        'critical',
      );
    }
    return git(p, 'rev-parse', 'HEAD');
  }
}
