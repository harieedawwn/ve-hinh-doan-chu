import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';

export default defineConfig({
  root: 'client',
  plugins: [preact()],
  build: { outDir: '../dist', emptyOutDir: true, target: 'es2022' },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:8787', ws: true } },
  },
});
