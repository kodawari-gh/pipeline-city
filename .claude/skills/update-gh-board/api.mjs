// Library for a GitHub Projects board: read an issue with its board item, set fields, close, sync a parent.
// Config: <repo>/docs/agents/board.json. The CLI is board.mjs, which re-exports this module.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const STATUSES = ['Backlog', 'Ready', 'In progress', 'In review', 'Done'];
export const PLANNED = ['Opus', 'Sonnet', 'Haiku', 'Human', 'Parent'];
const HELD = new Set(['Human', 'Parent']);
const IN_FLIGHT = new Set(['In progress', 'In review']);

export function run(cmd, args, opts = {}) {
  return execFileSync(cmd, args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 64 << 20,
    ...opts,
  }).trim();
}
const TRANSIENT = /Bad credentials|HTTP 401|HTTP 5dd|ECONNRESET|ETIMEDOUT|timed out|Something went wrong/iu;
/** gh call; a transient auth or network failure retries up to 5 times with a growing pause. */
export function gh(args) {
  for (let i = 0; ; i++) {
    try {
      return run('gh', args);
    } catch (error) {
      const text = `${error.stderr ?? ''}${error.message ?? ''}`;
      if (i >= 4 || !TRANSIENT.test(text)) {
        throw error;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2000 * (i + 1));
    }
  }
}
/** The main checkout's root, also from inside a linked worktree (its config is the live one). */
export const repoRoot = (cwd = process.cwd()) =>
  path.dirname(run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }));

export function configPath(root = repoRoot()) {
  return path.join(root, 'docs', 'agents', 'board.json');
}
export function loadConfig(root = repoRoot()) {
  const p = configPath(root);
  if (!existsSync(p)) {
    throw new Error(`No board config at ${p}. Run: node board.mjs init <owner> <project-number> <owner/repo>`);
  }
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  const [o, r] = cfg.repo.split('/');
  return { ...cfg, root, o, r };
}

function pick(list, name, what) {
  const hit = list.find((s) => s.toLowerCase() === String(name).toLowerCase());
  if (!hit) {
    throw new Error(`Unknown ${what} "${name}". Use one of: ${list.join(', ')}`);
  }
  return hit;
}

const ISSUE_Q = `query($o:String!,$r:String!,$n:Int!){repository(owner:$o,name:$r){issue(number:$n){
  id number state title body
  projectItems(first:20){nodes{id project{id}
    fieldValues(first:40){nodes{
      ... on ProjectV2ItemFieldSingleSelectValue{name field{... on ProjectV2FieldCommon{id}}}
      ... on ProjectV2ItemFieldNumberValue{number field{... on ProjectV2FieldCommon{id}}}}}}}
  blockedBy(first:50){nodes{number state}}
  subIssues(first:100){nodes{number state}}}}}`;

/** One issue with its board item, blockers and children. */
export function getIssue(cfg, n) {
  const out = gh(['api', 'graphql', '-f', `query=${ISSUE_Q}`, '-f', `o=${cfg.o}`, '-f', `r=${cfg.r}`, '-F', `n=${n}`]);
  const is = JSON.parse(out).data.repository.issue;
  if (!is) {
    throw new Error(`Issue #${n} not found in ${cfg.repo}`);
  }
  const node = is.projectItems.nodes.find((x) => x.project.id === cfg.projectId);
  let item = null;
  if (node) {
    const val = (fid) => node.fieldValues.nodes.find((v) => v.field && v.field.id === fid);
    item = {
      id: node.id,
      status: val(cfg.fields.status.id)?.name ?? null,
      planned: val(cfg.fields.planned.id)?.name ?? null,
      rounds: val(cfg.fields.rounds.id)?.number ?? null,
      cost: cfg.fields.cost ? (val(cfg.fields.cost.id)?.number ?? null) : null,
    };
  }
  return {
    n: is.number,
    nodeId: is.id,
    state: is.state,
    title: is.title,
    body: is.body,
    item,
    blockers: is.blockedBy.nodes,
    openBlockers: is.blockedBy.nodes.filter((b) => b.state === 'OPEN').map((b) => b.number),
    children: is.subIssues.nodes,
  };
}

export function ensureItem(cfg, n) {
  let is = getIssue(cfg, n);
  if (!is.item) {
    gh([
      'project',
      'item-add',
      String(cfg.number),
      '--owner',
      cfg.owner,
      '--url',
      `https://github.com/${cfg.repo}/issues/${n}`,
    ]);
    is = getIssue(cfg, n);
    if (!is.item) {
      throw new Error(`#${n}: item-add did not put it on the board`);
    }
  }
  return is;
}

function editSelect(cfg, { itemId, field, option }) {
  gh([
    'project',
    'item-edit',
    '--project-id',
    cfg.projectId,
    '--id',
    itemId,
    '--field-id',
    field.id,
    '--single-select-option-id',
    field.options[option],
  ]);
}

/** Set a single-select field, then re-read to verify. Returns the issue after the write. */
function setSelect(cfg, n, { key, list, name }) {
  const want = pick(list, name, key);
  const is = ensureItem(cfg, n);
  const cur = key === 'status' ? is.item.status : is.item.planned;
  if (cur === want) {
    return is;
  }
  editSelect(cfg, { itemId: is.item.id, field: cfg.fields[key], option: want });
  const after = getIssue(cfg, n);
  const got = key === 'status' ? after.item.status : after.item.planned;
  if (got !== want) {
    throw new Error(`#${n}: ${key} write did not stick (read back "${got}")`);
  }
  return after;
}
export const setStatus = (cfg, n, s) => setSelect(cfg, n, { key: 'status', list: STATUSES, name: s });
export const setPlanned = (cfg, n, m) => setSelect(cfg, n, { key: 'planned', list: PLANNED, name: m });

function setNumber(cfg, n, { key, value }) {
  if (!cfg.fields[key]) {
    return;
  }
  const is = ensureItem(cfg, n);
  gh([
    'project',
    'item-edit',
    '--project-id',
    cfg.projectId,
    '--id',
    is.item.id,
    '--field-id',
    cfg.fields[key].id,
    '--number',
    String(value),
  ]);
}
export const setRounds = (cfg, n, k) => setNumber(cfg, n, { key: 'rounds', value: k });
/** Cost in USD, rounded to cents. Accumulated API cost of every agent run on the ticket. */
export const setCost = (cfg, n, usd) => setNumber(cfg, n, { key: 'cost', value: Math.round(usd * 100) / 100 });

export function comment(cfg, n, body) {
  gh(['issue', 'comment', String(n), '--repo', cfg.repo, '--body', body]);
}

/** Close with a comment, set Rounds, Cost and Done. A null or missing rounds or cost is left as it is. */
export function done(cfg, n, { rounds = null, body = '', cost = null } = {}) {
  const is = getIssue(cfg, n);
  if (is.state === 'OPEN') {
    if (body) {
      comment(cfg, n, body);
    }
    gh(['issue', 'close', String(n), '--repo', cfg.repo]);
  }
  if (rounds !== null) {
    setRounds(cfg, n, rounds);
  }
  if (cost !== null) {
    setCost(cfg, n, cost);
  }
  return setStatus(cfg, n, 'Done');
}

/**
 * Bring a parent's children in line with the rules:
 * closed -> Done; held (Human/Parent) -> Backlog; in flight -> untouched;
 * else Ready when every blocker is closed, Backlog otherwise.
 */
export function sync(cfg, parent, { dry = false } = {}) {
  const p = getIssue(cfg, parent);
  const report = { ready: [], inFlight: [], held: [], blocked: [], done: [], noPlanned: [], moves: [] };
  for (const c of p.children) {
    const is = dry ? getIssue(cfg, c.number) : ensureItem(cfg, c.number);
    const cur = is.item?.status ?? null;
    const planned = is.item?.planned ?? null;
    let want;
    if (is.state !== 'OPEN') {
      want = 'Done';
      report.done.push(is.n);
    } else if (IN_FLIGHT.has(cur)) {
      report.inFlight.push(is.n);
      continue;
    } else if (HELD.has(planned)) {
      want = 'Backlog';
      report.held.push(is.n);
    } else if (is.openBlockers.length > 0) {
      want = 'Backlog';
      report.blocked.push(`${is.n}<-${is.openBlockers.join('+')}`);
    } else {
      want = 'Ready';
      report.ready.push(is.n);
      if (!planned) {
        report.noPlanned.push(is.n);
      }
    }
    if (cur !== want) {
      report.moves.push(`#${is.n} ${cur ?? '(none)'} -> ${want}`);
      if (!dry) {
        setStatus(cfg, is.n, want);
      }
    }
  }
  moveParent(cfg, p, { report, dry });
  return report;
}

function moveParent(cfg, p, { report, dry }) {
  const want = parentStatus(p, report);
  const cur = p.item?.status ?? null;
  if (want && cur !== want) {
    report.moves.push(`#${p.n} ${cur ?? '(none)'} -> ${want} (parent)`);
    if (!dry) {
      setStatus(cfg, p.n, want);
    }
  }
}

/**
 * The parent follows its children: Done once closed, In review once every child is Done (its PR waits on the user),
 * In progress once any child started or finished, else Ready or Backlog by its own blockers.
 */
function parentStatus(p, report) {
  if (p.children.length === 0) {
    return null;
  }
  if (p.state !== 'OPEN') {
    return 'Done';
  }
  if (report.done.length === p.children.length) {
    return 'In review';
  }
  if (report.done.length + report.inFlight.length > 0) {
    return 'In progress';
  }
  return p.openBlockers.length > 0 ? 'Backlog' : 'Ready';
}
