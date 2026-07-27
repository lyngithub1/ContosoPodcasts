import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// Import workspace package source directly via aliases so no separate build
// step is required for @studio/domain and @studio/ssml during development.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@studio/domain': fileURLToPath(new URL('../../packages/domain/src/index.ts', import.meta.url)),
      '@studio/ssml': fileURLToPath(new URL('../../packages/ssml/src/index.ts', import.meta.url)),
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
