import { defineConfig } from 'vite';

// The host-page loader: one small IIFE with no dependencies (budget: under 5 KB gzipped).
export default defineConfig({
  build: {
    outDir: '.assets/loader',
    emptyOutDir: true,
    target: 'es2020',
    minify: true,
    sourcemap: false,
    lib: {
      entry: 'src/embed/loader.ts',
      formats: ['iife'],
      name: 'chatdockLoader',
      fileName: () => 'loader.js',
    },
  },
});
