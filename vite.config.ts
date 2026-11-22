import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// The short git hash of this build, shown as the build line (src/core/ui/build.ts). The dev server reads 'dev'.
function buildHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || 'unknown';
  } catch {
    return 'unknown';
  }
}

// base './' so the build works from any path (GitHub Pages, file://, artifact)
export default defineConfig(({ command }) => ({
  base: './',
  plugins: [preact()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  define: { __BUILD__: JSON.stringify(command === 'serve' ? 'dev' : buildHash()) },
}));
