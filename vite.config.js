import { defineConfig } from 'vite';

// Relative base so the static build works on any HTTPS host (GitHub Pages sub-path, Netlify, Vercel).
export default defineConfig({
  base: './',
  build: {
    chunkSizeWarningLimit: 2000,
    rollupOptions: {
      output: {
        // Emit the pdf.js worker as .js, not .mjs: many hosts (older nginx mime.types) serve .mjs as
        // application/octet-stream, which browsers refuse to load as a module worker.
        assetFileNames: (asset) =>
          (asset.names?.[0] ?? asset.name ?? '').endsWith('.mjs')
            ? 'assets/[name]-[hash].js'
            : 'assets/[name]-[hash][extname]',
      },
    },
  },
});
