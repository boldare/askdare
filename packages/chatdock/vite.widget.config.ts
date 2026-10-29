import { defineConfig } from 'vite';

// The iframe app (React). Inlined into the package by scripts/inline-assets.mjs.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir: '.assets/widget',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/widget-app/main.tsx',
      formats: ['es'],
      fileName: () => 'widget.js',
      cssFileName: 'widget',
    },
  },
});
