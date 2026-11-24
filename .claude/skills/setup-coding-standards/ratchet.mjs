#!/usr/bin/env node
// Baseline ratchet for any checker. Records violation counts per file and rule in .baseline/<name>.json,
// fails on new violations, and fails when a recorded violation is gone so the baseline only shrinks.
//
//   node ratchet.mjs <name> [--parse <kind>] [--update | --init] -- <command...>
//
// kinds: tsc | oxlint (-f json) | stylelint (--formatter json) | markdownlint | ruff (--output-format json)
//        | knip (--reporter json) | cspell. Default kind = <name>.
// --update rewrites the baseline after fixes and refuses to grow it. --init writes it from scratch.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, resolve, isAbsolute } from 'node:path';

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd();
const rel = (f) => relative(root, isAbsolute(f) ? f : resolve(root, f)).replaceAll('\\', '/');

let stdoutOnly = '';

// JSON checkers print JSON on stdout. Stderr can hold tool noise (uvx "Downloading ruff"), so read stdout first.
function jsonOf(out) {
  const src = stdoutOnly.includes('[') || stdoutOnly.includes('{') ? stdoutOnly : out;
  return JSON.parse(src.slice(src.search(/[[{]/u)));
}

const PARSERS = {
  tsc: (out) =>
    [...out.matchAll(/^(.+?)\((\d+),\d+\): error (TS\d+): (.*)$/gm)].map((m) => ({
      file: m[1],
      line: Number(m[2]),
      rule: m[3],
      msg: m[4],
    })),
  oxlint: (out) =>
    jsonOf(out).diagnostics.map((d) => ({
      file: d.filename,
      line: d.labels?.[0]?.span?.line ?? 0,
      rule: d.code,
      msg: d.message,
    })),
  stylelint: (out) =>
    jsonOf(out).flatMap((r) => r.warnings.map((w) => ({ file: r.source, line: w.line, rule: w.rule, msg: w.text }))),
  markdownlint: (out) =>
    [...out.matchAll(/^(.+?\.md):(\d+)(?::\d+)?\s+(?:error\s+)?(MD\d+)\S*\s+(.*)$/gim)].map((m) => ({
      file: m[1],
      line: Number(m[2]),
      rule: m[3],
      msg: m[4],
    })),
  ruff: (out) =>
    jsonOf(out).map((d) => ({
      file: d.filename,
      line: d.location?.row ?? 0,
      rule: d.code ?? 'syntax',
      msg: d.message,
    })),
  knip: (out) =>
    (jsonOf(out).issues ?? []).flatMap((iss) =>
      Object.entries(iss)
        .filter(([, v]) => Array.isArray(v) && v.length)
        .flatMap(([type, v]) =>
          v.map((x) => ({ file: iss.file, line: x.line ?? 0, rule: `knip/${type}`, msg: x.name ?? type })),
        ),
    ),
  cspell: (out) =>
    [...out.matchAll(/^(.+?):(\d+):\d+ - Unknown word \((.+?)\)/gm)].map((m) => ({
      file: m[1],
      line: Number(m[2]),
      rule: `word:${m[3].toLowerCase()}`,
      msg: `unknown word "${m[3]}"`,
    })),
};

function count(entries) {
  const b = {};
  for (const e of entries) {
    const f = rel(e.file);
    (b[f] ||= {})[e.rule] = (b[f][e.rule] || 0) + 1;
  }
  return sortObj(Object.fromEntries(Object.entries(b).map(([f, r]) => [f, sortObj(r)])));
}
const sortObj = (o) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => (a < b ? -1 : 1)));

function main(argv) {
  const sep = argv.indexOf('--');
  if (sep < 1) {
    console.error('usage: ratchet.mjs <name> [--parse kind] [--update|--init] -- <command...>');
    process.exit(2);
  }
  const opts = argv.slice(0, sep);
  const name = opts[0];
  const kind = opts.includes('--parse') ? opts[opts.indexOf('--parse') + 1] : name;
  const parse = PARSERS[kind];
  if (!parse) {
    throw new Error(`unknown parser "${kind}" (${Object.keys(PARSERS).join(', ')})`);
  }
  const cmd = argv.slice(sep + 1).join(' ');
  const r = spawnSync(cmd, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 1 << 30 });
  stdoutOnly = r.stdout;
  const out = `${r.stdout}\n${r.stderr}`;
  let entries;
  try {
    entries = parse(out);
  } catch {
    console.error(`[${name}] could not parse output of: ${cmd}\n${out.slice(0, 2000)}`);
    process.exit(2);
  }
  if (r.status !== 0 && entries.length === 0) {
    console.error(`[${name}] command failed with no parsable findings (exit ${r.status}):\n${out.slice(0, 2000)}`);
    process.exit(r.status || 2);
  }
  const now = count(entries);
  const file = join(root, '.baseline', `${name}.json`);
  const base = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};

  const grew = [];
  const shrank = [];
  for (const [f, rules] of Object.entries(now)) {
    for (const [rule, n] of Object.entries(rules))
      if (n > (base[f]?.[rule] ?? 0)) grew.push([f, rule, n, base[f]?.[rule] ?? 0]);
  }
  for (const [f, rules] of Object.entries(base)) {
    for (const [rule, n] of Object.entries(rules))
      if (n > (now[f]?.[rule] ?? 0)) shrank.push([f, rule, now[f]?.[rule] ?? 0, n]);
  }

  const total = entries.length;
  if (process.env.RATCHET_UPDATE === '1' && !opts.includes('--init')) opts.push('--update');
  if (process.env.RATCHET_UPDATE === 'init') opts.push('--init');
  if (opts.includes('--init') || opts.includes('--update')) {
    if (opts.includes('--update') && grew.length > 0) {
      report(name, entries, grew);
      console.error(`[${name}] --update refuses to grow the baseline. Fix the new violations first.`);
      process.exit(1);
    }
    mkdirSync(join(root, '.baseline'), { recursive: true });
    writeFileSync(file, `${JSON.stringify(now, null, 1)}\n`);
    console.log(`[${name}] baseline written: ${total} violation(s) in ${Object.keys(now).length} file(s)`);
    return;
  }
  if (grew.length > 0) {
    report(name, entries, grew);
  }
  if (shrank.length > 0) {
    console.error(
      `[${name}] ${shrank.length} baselined violation group(s) are fixed. Shrink the baseline: npm run baseline:update (or ratchet.mjs ${name} --update -- ...)`,
    );
    for (const [f, rule, n, was] of shrank.slice(0, 20)) {
      console.error(`  ${f} ${rule}: ${was} -> ${n}`);
    }
  }
  if (grew.length > 0 || shrank.length > 0) {
    process.exit(1);
  }
  console.log(`[${name}] ok (${total} baselined)`);
}

function report(name, entries, grew) {
  console.error(`[${name}] new violations:`);
  for (const [f, rule, n, was] of grew) {
    console.error(`  ${f} ${rule}: ${was} -> ${n}`);
    for (const e of entries.filter((e) => rel(e.file) === f && e.rule === rule).slice(0, 5)) {
      console.error(`    ${f}:${e.line} ${e.msg}`);
    }
  }
}

main(process.argv.slice(2));
