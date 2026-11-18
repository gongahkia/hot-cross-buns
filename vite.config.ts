import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [react()],
  worker: { format: 'es' },
  // use the same DOM-free character decoder in the page and parser worker.
  resolve: { alias: { 'decode-named-character-reference': require.resolve('decode-named-character-reference') } },
  server: {
    port: 5173,
    strictPort: true,
  },
});
