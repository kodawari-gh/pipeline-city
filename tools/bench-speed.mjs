// `npm run bench:speed`: runs the sandbox speed benchmark (src/features/sandbox/sim/speed.ts) through Vite's SSR loader, so it
// needs no test runner and `npm test` never runs it. Prints "SPEED" lines; see src/features/sandbox/SANDBOX.md.
import { createServer } from "vite";

const server = await createServer({
  configFile: false,
  root: process.cwd(),
  logLevel: "error",
  appType: "custom",
  server: { middlewareMode: true, hmr: false },
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const mod = await server.ssrLoadModule("/src/features/sandbox/sim/speed.ts");
  await mod.main();
} finally {
  await server.close();
}
