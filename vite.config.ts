import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { offlineShell } from './scripts/build/offlineShell';

// Fail builds if a future refactor pulls privileged desktop code into either
// the rendering thread or the worker. Native SQLite remains test tooling only.
function browserGraph(): Plugin {
  return {
    name: 'hcb-browser-only',
    enforce: 'pre',
    resolveId(source) {
      if (/^(node:|electron(?:$|\/)|better-sqlite3(?:$|\/))/.test(source)) {
        throw new Error(`Desktop runtime dependency in browser graph: ${source}`);
      }
    },
    moduleParsed(module) {
      if (module.id.includes('/src/main/') || module.id.endsWith('/src/preload/index.ts')) {
        throw new Error(`Desktop module in browser graph: ${module.id}`);
      }
    },
  };
}

export default defineConfig({
  root: resolve(__dirname, 'src/renderer'),
  base: './',
  plugins: [react(), browserGraph(), offlineShell()],
  resolve: { alias: {
    '@renderer': resolve(__dirname, 'src/renderer/src'),
    '@shared': resolve(__dirname, 'src/shared'),
    '@browser': resolve(__dirname, 'src/browser'),
  } },
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es', plugins: () => [browserGraph()] },
  server: { host: '127.0.0.1', fs: { allow: [__dirname] } },
  build: { outDir: resolve(__dirname, 'dist'), emptyOutDir: true, target: 'es2022' },
});
