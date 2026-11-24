/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { configDefaults } from 'vitest/config';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HEAVY_TESTS } from './tools/heavy-tests.ts';

const BROWSER_TESTS = '**/*.browser.test.ts';
const EXCLUDE = [...configDefaults.exclude, '**/.claude/**'];

// The short git hash of this build, shown as the build line (src/core/ui/build.ts). The dev server reads 'dev'.
function buildHash(): string {
  try {
    return (
      execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim() || 'unknown'
    );
  } catch {
    return 'unknown';
  }
}

// base './' so the build works from any path (GitHub Pages, file://, artifact)
export default defineConfig(({ command }) => ({
  base: './',
  // Per checkout, not in node_modules: swarm worktrees share one node_modules through a link (docs/agents/board.json shareDeps).
  cacheDir: '.cache/vite',
  plugins: [preact()],
  resolve: { alias: { '@': fileURLToPath(new URL('src', import.meta.url)) } },
  worker: { format: 'es' },
  define: { __BUILD__: JSON.stringify(command === 'serve' ? 'dev' : buildHash()) },
  // Tests. The default pool (forks) fails on this checkout ("reading 'config'"), so every run uses vmThreads.
  // Three projects: `fast` (the bulk, under a minute), `heavy` (the slow 3D and long simulations, few workers so they do not time
  // out on each other) and `browser` (Chrome, one file at a time; skipped unless T44_BROWSER=1). See `npm run test:fast`.
  test: {
    pool: 'vmThreads',
    exclude: EXCLUDE,
    projects: [
      {
        extends: true,
        test: { name: 'fast', sequence: { groupOrder: 1 }, exclude: [...EXCLUDE, ...HEAVY_TESTS, BROWSER_TESTS] },
      },
      {
        extends: true,
        test: {
          name: 'heavy',
          sequence: { groupOrder: 2 },
          include: [...HEAVY_TESTS],
          maxWorkers: 6,
          testTimeout: 400_000,
          hookTimeout: 120_000,
        },
      },
      {
        extends: true,
        test: {
          name: 'browser',
          sequence: { groupOrder: 3 },
          include: [BROWSER_TESTS],
          fileParallelism: false,
          testTimeout: 240_000,
        },
      },
    ],
  },
}));
