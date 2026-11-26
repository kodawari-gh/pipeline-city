// `npm run bench:speed`: runs the sandbox speed benchmark (src/features/sandbox/sim/speed.ts) through Vite's SSR loader, so it
// needs no test runner and `npm test` never runs it. Prints "SPEED" lines; see src/features/sandbox/SANDBOX.md.
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';

/**
 * Whether the loaded module exports the benchmark's `main`.
 * @param {unknown} m
 * @returns {m is { main: () => Promise<void> }}
 */
const hasMain = (m) => typeof m === 'object' && m !== null && 'main' in m && typeof m.main === 'function';

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  resolve: { alias: { '@': fileURLToPath(new URL('../src', import.meta.url)) } },
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const mod = await server.ssrLoadModule('/src/features/sandbox/sim/speed.ts');
  if (!hasMain(mod)) {
    throw new TypeError('speed.ts exports no main');
  }
  await mod.main();
} finally {
  await server.close();
}
