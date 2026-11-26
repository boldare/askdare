import { defineConfig } from 'vite';

// The dashboard's browser app, built with Preact into one classic script and one stylesheet,
// then inlined into the package by scripts/inline-assets.mjs. The console serves both
// (ADR-0032, decision 9); the library never reads them from disk at runtime.
export default defineConfig({
  oxc: { jsx: { runtime: 'automatic', importSource: 'preact' } },
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: '.assets',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    rolldownOptions: { output: { minify: true } },
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/ui/main.tsx',
      formats: ['iife'],
      name: 'askdareAdminDashboardBundle',
      fileName: () => 'dashboard.js',
      cssFileName: 'dashboard',
    },
  },
});
