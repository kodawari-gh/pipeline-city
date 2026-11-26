#!/usr/bin/env node
// Runs every `check:*` script in package.json (or every `fix:*` script with --fix, then the checks),
// all of them even when one fails, and prints one line per gate. Exit 1 if any gate failed.
//
//   node check.mjs [--fix] [--update-baselines] [--only <name,name>]
//
// --update-baselines sets RATCHET_UPDATE=1, so each ratchet gate shrinks its baseline instead of failing on fixed violations.
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const argv = process.argv.slice(2);
const root = process.cwd();
const scripts = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
const only = argv.includes('--only') ? argv[argv.indexOf('--only') + 1].split(',') : null;
const pick = (prefix) =>
  Object.keys(scripts).filter((s) => s.startsWith(prefix) && (!only || only.includes(s.slice(prefix.length))));
const env = { ...process.env, ...(argv.includes('--update-baselines') ? { RATCHET_UPDATE: '1' } : {}) };

async function run(name) {
  const t = Date.now();
  return new Promise((resolve) => {
    let out = '';
    const p = spawn('npm', ['run', '--silent', name], { cwd: root, shell: true, env });
    p.stdout.on('data', (d) => {
      out += d;
    });
    p.stderr.on('data', (d) => {
      out += d;
    });
    p.on('close', (code) => {
      resolve({ name, code, out, ms: Date.now() - t });
    });
  });
}

async function phase(prefix, parallel) {
  const names = pick(prefix);
  const results = [];
  if (parallel) {
    results.push(...(await Promise.all(names.map(async (n) => run(n)))));
  } else {
    for (const n of names) {
      results.push(await run(n));
    }
  }
  for (const r of results) {
    const mark = r.code === 0 ? 'ok  ' : 'FAIL';
    console.log(`${mark} ${r.name} (${(r.ms / 1000).toFixed(1)}s)`);
    if (r.code !== 0) {
      console.log(
        r.out
          .trim()
          .split('\n')
          .slice(-40)
          .map((l) => `     ${l}`)
          .join('\n'),
      );
    }
  }
  return results.every((r) => r.code === 0);
}

if (argv.includes('--fix')) {
  await phase('fix:', false);
}
const ok = await phase('check:', true);
process.exit(ok ? 0 : 1);
