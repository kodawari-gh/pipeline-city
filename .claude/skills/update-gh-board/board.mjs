#!/usr/bin/env node
// Board CLI for a GitHub Projects board. Config: <repo>/docs/agents/board.json.
// Usage: node board.mjs <show|status|planned|rounds|done|sync|init> ...  (run with no args for help)
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

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
export const gh = (args) => run('gh', args);
/** The main checkout's root, also from inside a linked worktree (its config is the live one). */
export const repoRoot = (cwd = process.cwd()) =>
  dirname(run('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd }));

export function configPath(root = repoRoot()) {
  return join(root, 'docs', 'agents', 'board.json');
}
export function loadConfig(root = repoRoot()) {
  const p = configPath(root);
  if (!existsSync(p))
    throw new Error(`No board config at ${p}. Run: node board.mjs init <owner> <project-number> <owner/repo>`);
  const cfg = JSON.parse(readFileSync(p, 'utf8'));
  const [o, r] = cfg.repo.split('/');
  return { ...cfg, root, o, r };
}

function pick(list, name, what) {
  const hit = list.find((s) => s.toLowerCase() === String(name).toLowerCase());
  if (!hit) throw new Error(`Unknown ${what} "${name}". Use one of: ${list.join(', ')}`);
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
  if (!is) throw new Error(`Issue #${n} not found in ${cfg.repo}`);
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
    if (!is.item) throw new Error(`#${n}: item-add did not put it on the board`);
  }
  return is;
}

function editSelect(cfg, itemId, field, option) {
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
function setSelect(cfg, n, key, list, name) {
  const want = pick(list, name, key);
  const is = ensureItem(cfg, n);
  const cur = key === 'status' ? is.item.status : is.item.planned;
  if (cur === want) return is;
  editSelect(cfg, is.item.id, cfg.fields[key], want);
  const after = getIssue(cfg, n);
  const got = key === 'status' ? after.item.status : after.item.planned;
  if (got !== want) throw new Error(`#${n}: ${key} write did not stick (read back "${got}")`);
  return after;
}
export const setStatus = (cfg, n, s) => setSelect(cfg, n, 'status', STATUSES, s);
export const setPlanned = (cfg, n, m) => setSelect(cfg, n, 'planned', PLANNED, m);

function setNumber(cfg, n, key, v) {
  if (!cfg.fields[key]) return;
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
    String(v),
  ]);
}
export const setRounds = (cfg, n, k) => setNumber(cfg, n, 'rounds', k);
/** Cost in USD, rounded to cents. Accumulated API cost of every agent run on the ticket. */
export const setCost = (cfg, n, usd) => setNumber(cfg, n, 'cost', Math.round(usd * 100) / 100);

export function comment(cfg, n, body) {
  gh(['issue', 'comment', String(n), '--repo', cfg.repo, '--body', body]);
}

/** Close with a comment, set Rounds, Cost and Done. */
export function done(cfg, n, rounds, body, cost) {
  const is = getIssue(cfg, n);
  if (is.state === 'OPEN') {
    if (body) comment(cfg, n, body);
    gh(['issue', 'close', String(n), '--repo', cfg.repo]);
  }
  if (rounds != null) setRounds(cfg, n, rounds);
  if (cost != null) setCost(cfg, n, cost);
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
    } else if (is.openBlockers.length) {
      want = 'Backlog';
      report.blocked.push(`${is.n}<-${is.openBlockers.join('+')}`);
    } else {
      want = 'Ready';
      report.ready.push(is.n);
      if (!planned) report.noPlanned.push(is.n);
    }
    if (cur !== want) {
      report.moves.push(`#${is.n} ${cur ?? '(none)'} -> ${want}`);
      if (!dry) setStatus(cfg, is.n, want);
    }
  }
  return report;
}

/** Discover ids for a project and write docs/agents/board.json. Creates missing Planned model and Rounds fields. */
export function init(owner, number, repo, root = repoRoot()) {
  const listFields = () =>
    JSON.parse(gh(['project', 'field-list', String(number), '--owner', owner, '--format', 'json'])).fields;
  let fields = listFields();
  const find = (name) => fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
  if (!find('Planned model'))
    gh([
      'project',
      'field-create',
      String(number),
      '--owner',
      owner,
      '--name',
      'Planned model',
      '--data-type',
      'SINGLE_SELECT',
      '--single-select-options',
      PLANNED.join(','),
    ]);
  for (const nm of ['Rounds', 'Cost'])
    if (!find(nm))
      gh(['project', 'field-create', String(number), '--owner', owner, '--name', nm, '--data-type', 'NUMBER']);
  fields = listFields();
  const opts = (f, names) => {
    const o = {};
    for (const nm of names) {
      const hit = (f.options || []).find((x) => x.name.toLowerCase() === nm.toLowerCase());
      if (!hit) throw new Error(`Field "${f.name}" lacks option "${nm}". Add it in the board UI, then rerun init.`);
      o[nm] = hit.id;
    }
    return o;
  };
  const status = find('Status');
  const planned = find('Planned model');
  const p = configPath(root);
  const prev = existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : {};
  const cfg = {
    ...prev,
    owner,
    number: Number(number),
    repo,
    projectId: gh(['project', 'view', String(number), '--owner', owner, '--format', 'json', '--jq', '.id']),
    fields: {
      status: { id: status.id, options: opts(status, STATUSES) },
      planned: { id: planned.id, options: opts(planned, PLANNED) },
      rounds: { id: find('Rounds').id },
      cost: { id: find('Cost').id },
    },
  };
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(cfg, null, 2) + '\n');
  return p;
}

const HELP = `board.mjs: GitHub Projects board CLI (config docs/agents/board.json)
  show <n>                 status, planned model, rounds, open blockers, children
  status <n> <Status>      ${STATUSES.join(' | ')}
  planned <n> <Model>      ${PLANNED.join(' | ')}
  rounds <n> <k>
  cost <n> <usd>
  done <n> [rounds] [msg]  close with msg, set Rounds and Done
  sync <parent> [--dry]    children: closed->Done, held->Backlog, unblocked->Ready, blocked->Backlog
  init <owner> <number> <owner/repo>   write board.json (creates Planned model and Rounds fields)`;

function main(argv) {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') return console.log(HELP);
  if (cmd === 'init') return console.log(`wrote ${init(a[0], a[1], a[2])}`);
  const cfg = loadConfig();
  const n = Number(a[0]);
  switch (cmd) {
    case 'show': {
      const is = getIssue(cfg, n);
      console.log(`#${is.n} ${is.state} "${is.title}"`);
      console.log(
        `  status=${is.item?.status ?? '(not on board)'} planned=${is.item?.planned ?? '-'} rounds=${is.item?.rounds ?? '-'} cost=${is.item?.cost != null ? '$' + is.item.cost : '-'}`,
      );
      console.log(`  open blockers: ${is.openBlockers.map((b) => '#' + b).join(' ') || 'none'}`);
      if (is.children.length)
        console.log(
          `  children: ${is.children.map((c) => `#${c.number}${c.state === 'OPEN' ? '' : '(closed)'}`).join(' ')}`,
        );
      return;
    }
    case 'status':
      return console.log(`#${n} status=${setStatus(cfg, n, a[1]).item.status}`);
    case 'planned':
      return console.log(`#${n} planned=${setPlanned(cfg, n, a[1]).item.planned}`);
    case 'rounds':
      setRounds(cfg, n, Number(a[1]));
      return console.log(`#${n} rounds=${a[1]}`);
    case 'cost':
      setCost(cfg, n, Number(a[1]));
      return console.log(`#${n} cost=$${a[1]}`);
    case 'done':
      return console.log(`#${n} status=${done(cfg, n, a[1] != null ? Number(a[1]) : null, a[2]).item.status}`);
    case 'sync': {
      const r = sync(cfg, n, { dry: a.includes('--dry') });
      for (const m of r.moves) console.log(`${a.includes('--dry') ? 'would move' : 'moved'} ${m}`);
      console.log(`ready: ${r.ready.join(' ') || '-'}`);
      console.log(`in flight: ${r.inFlight.join(' ') || '-'}`);
      console.log(`blocked: ${r.blocked.join(' ') || '-'}`);
      console.log(`held: ${r.held.join(' ') || '-'}`);
      if (r.noPlanned.length) console.log(`NO PLANNED MODEL (set before swarming): ${r.noPlanned.join(' ')}`);
      return;
    }
    default:
      throw new Error(`Unknown command "${cmd}".\n${HELP}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === (await import('node:path')).resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (e) {
    console.error(String(e.stderr || e.message || e).trim());
    process.exit(1);
  }
}
