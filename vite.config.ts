import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

// base './' so the build works from any path (GitHub Pages, file://, artifact)
export default defineConfig({
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
});
