// Swarm agents: the model ladder, permission rules, output schemas, the claude CLI and the agent definitions.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';
import { run } from '../update-gh-board/board.mjs';

/** The runner CLI. Agents call it for `lock` and `deps`. */
export const SELF = path.join(import.meta.dirname, 'swarm.mjs');
export const MODELS = ['haiku', 'sonnet', 'opus'];
const EFFORTS = ['medium', 'high', 'xhigh'];
/** Phases a rerun resumes: their worktrees are kept. */
export const RESUMABLE = new Set(['running', 'critical', 'permission']);
/** Permission rules for every swarm agent; `swarm.allow` adds the repo's own commands. */
export const AGENT_ALLOW = [
  'Bash(git status:*)',
  'Bash(git diff:*)',
  'Bash(git log:*)',
  'Bash(git show:*)',
  'Bash(git blame:*)',
  'Bash(git grep:*)',
  'Bash(git ls-files:*)',
  'Bash(git rev-parse:*)',
  'Bash(git merge-base:*)',
  'Bash(git add:*)',
  'Bash(git rm:*)',
  'Bash(git mv:*)',
  'Bash(git commit:*)',
  'Bash(git restore:*)',
  'Bash(git checkout --ours:*)',
  'Bash(git checkout --theirs:*)',
  'Bash(git merge --abort)',
  `Bash(node "${SELF}" lock:*)`,
  `Bash(node "${SELF}" deps)`,
];
export const AGENT_DENY = [
  'Bash(git push:*)',
  'Bash(git rebase:*)',
  'Bash(git branch -D:*)',
  'Bash(git worktree:*)',
  'Bash(gh issue close:*)',
  'Bash(gh issue edit:*)',
  'Bash(gh issue comment:*)',
  'Bash(gh project:*)',
  'Bash(gh pr:*)',
];
const PERMISSION_FIELD = {
  type: 'string',
  description:
    'empty, or the exact command or tool you need that the permission rules refused, and why. Fill it only when no allowed way exists; the runner asks the user to allow it.',
};
/** Tier for a ticket after `failures` reviewer FAILs, starting at the planned model. null = exhausted. */
export function tierAt(planned, failures) {
  const m = MODELS.indexOf(String(planned).toLowerCase());
  if (m === -1) {
    throw new Error(`Planned model "${planned}" is not swarmable`);
  }
  const i = m * EFFORTS.length + failures;
  if (i >= MODELS.length * EFFORTS.length) {
    return null;
  }
  return { model: MODELS[Math.floor(i / EFFORTS.length)], effort: EFFORTS[i % EFFORTS.length] };
}
export const tierName = (t) => `${t.model} ${t.effort}`;
export function findClaude(cfg) {
  const cands = [process.env.CLAUDE_BIN, cfg.swarm?.claudeBin].filter(Boolean);
  try {
    cands.push(run(process.platform === 'win32' ? 'where' : 'which', ['claude']).split(/\r?\n/u)[0]);
  } catch {
    // Not on PATH: try the other places.
  }
  const ext = path.join(homedir(), '.vscode', 'extensions');
  if (existsSync(ext)) {
    const dirs = readdirSync(ext)
      .filter((d) => d.startsWith('anthropic.claude-code-'))
      .toSorted()
      .toReversed();
    for (const d of dirs) {
      cands.push(
        path.join(ext, d, 'resources', 'native-binary', process.platform === 'win32' ? 'claude.exe' : 'claude'),
      );
    }
  }
  cands.push(path.join(homedir(), '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'));
  const hit = cands.find((c) => c && existsSync(c));
  if (!hit) {
    throw new Error('claude CLI not found. Set CLAUDE_BIN or swarm.claudeBin in board.json.');
  }
  return hit;
}

export const WORK_SCHEMA = {
  type: 'object',
  properties: {
    commit: { type: 'string', description: 'hash of your one commit this round, or empty' },
    summary: { type: 'string', description: 'what changed, at most 3 lines' },
    unmet: { type: 'array', items: { type: 'string' }, description: 'acceptance items not met, and why' },
    blocker: { type: 'string', description: 'empty, or why the ticket cannot be done as written' },
    permission: PERMISSION_FIELD,
  },
  required: ['commit', 'summary', 'unmet', 'blocker', 'permission'],
};
export const REVIEW_SCHEMA = {
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
    permission: PERMISSION_FIELD,
  },
  required: ['verdict', 'commands', 'findings', 'permission'],
};
export const MERGE_SCHEMA = {
  type: 'object',
  properties: { resolved: { type: 'boolean' }, summary: { type: 'string' }, permission: PERMISSION_FIELD },
  required: ['resolved', 'summary', 'permission'],
};

/** Agent definitions read from the main checkout, so worktrees on older bases still get current rules. */
export function agentsJson(root) {
  const defs = {};
  const dir = path.join(root, '.claude', 'agents');
  for (const f of readdirSync(dir).filter((name) => /^swarm-.*\.md$/u.test(name))) {
    const txt = readFileSync(path.join(dir, f), 'utf8');
    const m = /^---\r?\n(?<head>[\s\S]*?)\r?\n---\r?\n(?<body>[\s\S]*)$/u.exec(txt);
    const desc = m ? (/^description:\s*(?<desc>.*)$/mu.exec(m.groups.head)?.groups.desc ?? f) : f;
    defs[f.replace(/\.md$/u, '')] = { description: desc, prompt: (m?.groups.body ?? txt).trim() };
  }
  return JSON.stringify(defs);
}
