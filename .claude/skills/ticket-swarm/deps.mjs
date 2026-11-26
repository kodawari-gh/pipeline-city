// Shared dependency installs (swarm.shareDeps: { keys, dirs }): hashes, links, removal and gc.
import {
  existsSync,
  readFileSync,
  writeFileSync,
  rmSync,
  readdirSync,
  lstatSync,
  unlinkSync,
  rmdirSync,
} from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { sh, git, gitOk } from './proc.mjs';

/** Short hash of the dependency key files in worktree `p`. */
export function depsHash(share, p) {
  const h = createHash('sha256');
  for (const k of share.keys) {
    const f = path.join(p, k);
    h.update(`${k}\0`);
    if (existsSync(f)) {
      h.update(readFileSync(f));
    }
    h.update('\0');
  }
  return h.digest('hex').slice(0, 12);
}
export const depsDir = (root, h) => path.join(root, '.claude', 'worktrees', `deps-${h}`);
/** Marker in the worktree's own git dir: `shared <hash>` or `private <hash>`. */
export const depsMarker = (p) => path.join(git(p, 'rev-parse', '--absolute-git-dir'), 'swarm-deps');
export function isLink(p) {
  try {
    return lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}
/** Remove a dir, or only the link when it is a symlink or junction (never its target). */
export function removeDir(p) {
  if (isLink(p)) {
    try {
      unlinkSync(p);
    } catch {
      rmdirSync(p);
    }
  } else if (existsSync(p)) {
    rmSync(p, { recursive: true, force: true });
  }
}
/** Remove only the dependency links in worktree `p`, so no later recursive delete can reach the shared install. */
export function unlinkDeps(share, p) {
  for (const d of share?.dirs ?? []) {
    if (isLink(path.join(p, d))) {
      removeDir(path.join(p, d));
    }
  }
}
/** Remove a worktree (dependency links first). False when it is still there, e.g. a process holds it open. */
export function removeWorktree(root, share, p) {
  if (!existsSync(p)) {
    return true;
  }
  unlinkDeps(share, p);
  if (!gitOk(root, 'worktree', 'remove', '--force', p)) {
    try {
      rmSync(p, { recursive: true, force: true });
    } catch {
      // In use: the caller reports it and gc retries.
    }
  }
  return !existsSync(p);
}
/** Remove shared installs no ticket worktree links to, except the one for the main checkout's key files. */
export function gcDeps(cfg) {
  const { root } = cfg;
  const wtDir = path.join(root, '.claude', 'worktrees');
  if (!existsSync(wtDir)) {
    return [];
  }
  const keep = new Set([depsHash(cfg.swarm.shareDeps, root)]);
  const names = readdirSync(wtDir);
  for (const d of names.filter((x) => !x.startsWith('deps-'))) {
    try {
      const m = readFileSync(depsMarker(path.join(wtDir, d)), 'utf8').split(' ');
      if (m[0] === 'shared') {
        keep.add(m[1]);
      }
    } catch {
      // Not a worktree or no marker: it links nothing.
    }
  }
  const out = [];
  for (const d of names.filter((x) => /^deps-[0-9a-f]+$/u.test(x))) {
    if (keep.has(d.slice(5)) || existsSync(path.join(wtDir, `${d}.lock`))) {
      continue;
    }
    const p = path.join(wtDir, d);
    out.push(removeWorktree(root, null, p) ? `removed shared deps ${d.slice(5)}` : `could not remove ${p} (in use)`);
  }
  gitOk(root, 'worktree', 'prune');
  return out;
}

/** `swarm.mjs deps`: replace the dependency links in the current worktree with a private install. */
export async function privateDeps(cfg) {
  const share = cfg.swarm?.shareDeps;
  if (!share || !cfg.swarm.install) {
    console.log('shareDeps is off: run the install command yourself.');
    return;
  }
  const p = path.resolve(git(process.cwd(), 'rev-parse', '--show-toplevel'));
  if (p === path.resolve(cfg.root)) {
    throw new Error('deps runs only in a swarm worktree');
  }
  unlinkDeps(share, p);
  const r = await sh(cfg.swarm.install, [], { cwd: p, shell: true, timeoutMs: 20 * 60e3 });
  process.stdout.write(r.out.slice(-2000));
  if (r.code !== 0) {
    throw new Error(`install failed: ${r.err.slice(-500)}`);
  }
  writeFileSync(depsMarker(p), `private ${depsHash(share, p)}`);
  console.log('private install done');
}
