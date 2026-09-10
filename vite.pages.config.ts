import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('.', import.meta.url)) } },
  base: process.env.GITHUB_ACTIONS ? '/dispatch-schedule-beta/' : '/',
  plugins: [react()],
  build: {
    outDir: 'gh-pages',
    emptyOutDir: true,
  },
});
