import { defineConfig } from 'vite';

// Relative base so the static build works on any HTTPS host (GitHub Pages sub-path, Netlify, Vercel).
export default defineConfig({
  base: './',
  build: { chunkSizeWarningLimit: 2000 },
});
