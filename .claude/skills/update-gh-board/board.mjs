#!/usr/bin/env node
// Board CLI for a GitHub Projects board. Config: <repo>/docs/agents/board.json.
// Usage: node board.mjs <show|status|planned|rounds|done|sync|init> ...  (run with no args for help)
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  STATUSES,
  PLANNED,
  gh,
  repoRoot,
  configPath,
  loadConfig,
  getIssue,
  setStatus,
  setPlanned,
  setRounds,
  setCost,
  done,
  sync,
} from './api.mjs';

export {
  STATUSES,
  PLANNED,
  run,
  gh,
  repoRoot,
  configPath,
  loadConfig,
  getIssue,
  ensureItem,
  setStatus,
  setPlanned,
  setRounds,
  setCost,
  comment,
  done,
  sync,
} from './api.mjs';

// The option ids of a single-select field, by option name. Throws when the field lacks one.
function optionIds(f, names) {
  const o = {};
  for (const nm of names) {
    const hit = (f.options || []).find((x) => x.name.toLowerCase() === nm.toLowerCase());
    if (!hit) {
      throw new Error(`Field "${f.name}" lacks option "${nm}". Add it in the board UI, then rerun init.`);
    }
    o[nm] = hit.id;
  }
  return o;
}

function createMissingFields({ owner, number }, find) {
  if (!find('Planned model')) {
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
  }
  for (const nm of ['Rounds', 'Cost']) {
    if (!find(nm)) {
      gh(['project', 'field-create', String(number), '--owner', owner, '--name', nm, '--data-type', 'NUMBER']);
    }
  }
}

/** Discover ids for a project and write docs/agents/board.json. Creates missing Planned model and Rounds fields. */
export function init({ owner, number, repo, root = repoRoot() }) {
  const listFields = () =>
    JSON.parse(gh(['project', 'field-list', String(number), '--owner', owner, '--format', 'json'])).fields;
  let fields = listFields();
  const find = (name) => fields.find((f) => f.name.toLowerCase() === name.toLowerCase());
  createMissingFields({ owner, number }, find);
  fields = listFields();
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
      status: { id: status.id, options: optionIds(status, STATUSES) },
      planned: { id: planned.id, options: optionIds(planned, PLANNED) },
      rounds: { id: find('Rounds').id },
      cost: { id: find('Cost').id },
    },
  };
  mkdirSync(path.dirname(p), { recursive: true });
  writeFileSync(p, `${JSON.stringify(cfg, null, 2)}\n`);
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

function show(cfg, n) {
  const is = getIssue(cfg, n);
  const cost = typeof is.item?.cost === 'number' ? `$${is.item.cost}` : '-';
  console.log(`#${is.n} ${is.state} "${is.title}"`);
  console.log(
    `  status=${is.item?.status ?? '(not on board)'} planned=${is.item?.planned ?? '-'} rounds=${is.item?.rounds ?? '-'} cost=${cost}`,
  );
  console.log(`  open blockers: ${is.openBlockers.map((b) => `#${b}`).join(' ') || 'none'}`);
  if (is.children.length > 0) {
    console.log(
      `  children: ${is.children.map((c) => `#${c.number}${c.state === 'OPEN' ? '' : '(closed)'}`).join(' ')}`,
    );
  }
}

function showSync(cfg, n, a) {
  const r = sync(cfg, n, { dry: a.includes('--dry') });
  for (const m of r.moves) {
    console.log(`${a.includes('--dry') ? 'would move' : 'moved'} ${m}`);
  }
  console.log(`ready: ${r.ready.join(' ') || '-'}`);
  console.log(`in flight: ${r.inFlight.join(' ') || '-'}`);
  console.log(`blocked: ${r.blocked.join(' ') || '-'}`);
  console.log(`held: ${r.held.join(' ') || '-'}`);
  if (r.noPlanned.length > 0) {
    console.log(`NO PLANNED MODEL (set before swarming): ${r.noPlanned.join(' ')}`);
  }
}

// Commands that act on one issue: (cfg, issue number, the other args).
const COMMANDS = {
  show,
  status: (cfg, n, a) => console.log(`#${n} status=${setStatus(cfg, n, a[1]).item.status}`),
  planned: (cfg, n, a) => console.log(`#${n} planned=${setPlanned(cfg, n, a[1]).item.planned}`),
  rounds: (cfg, n, a) => {
    setRounds(cfg, n, Number(a[1]));
    console.log(`#${n} rounds=${a[1]}`);
  },
  cost: (cfg, n, a) => {
    setCost(cfg, n, Number(a[1]));
    console.log(`#${n} cost=$${a[1]}`);
  },
  done: (cfg, n, a) => {
    const rounds = a[1] === undefined ? null : Number(a[1]);
    console.log(`#${n} status=${done(cfg, n, { rounds, body: a[2] }).item.status}`);
  },
  sync: showSync,
};

function main(argv) {
  const [cmd, ...a] = argv;
  if (!cmd || cmd === 'help' || cmd === '--help') {
    console.log(HELP);
    return;
  }
  if (cmd === 'init') {
    console.log(`wrote ${init({ owner: a[0], number: a[1], repo: a[2] })}`);
    return;
  }
  const cfg = loadConfig();
  const command = Object.hasOwn(COMMANDS, cmd) ? COMMANDS[cmd] : null;
  if (!command) {
    throw new Error(`Unknown command "${cmd}".\n${HELP}`);
  }
  command(cfg, Number(a[0]), a);
}

if (process.argv[1] && import.meta.filename === path.resolve(process.argv[1])) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(String(error.stderr || error.message || error).trim());
    process.exit(1);
  }
}
