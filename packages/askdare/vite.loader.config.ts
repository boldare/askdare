import { defineConfig } from 'vite';

// The host-page loader: one small IIFE with no dependencies (budget: 5.5 KB gzipped, ADR-0033).
export default defineConfig({
  build: {
    outDir: '.assets/loader',
    emptyOutDir: true,
    target: 'es2020',
    // The supported browsers (docs/support.md), for Lightning CSS: without them it expands
    // \`system-ui\` into a long list of fonts (ADR-0033).
    cssTarget: ['chrome111', 'edge111', 'firefox121', 'safari16.4'],
    minify: true,
    sourcemap: false,
    lib: {
      entry: 'src/embed/loader.ts',
      formats: ['iife'],
      name: 'askdareLoader',
      fileName: () => 'loader.js',
    },
  },
});
