import { defineConfig } from 'vite';

// The iframe app. Written with React's API and built with Preact, which is a tenth of the size:
// the app runs alone in its iframe, so nothing else on the page depends on React. Inlined into the
// package by scripts/inline-assets.mjs.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  resolve: {
    alias: [
      { find: /^react-dom\/client$/, replacement: 'preact/compat/client' },
      { find: /^react-dom$/, replacement: 'preact/compat' },
      { find: /^react\/jsx-(dev-)?runtime$/, replacement: 'preact/jsx-runtime' },
      { find: /^react$/, replacement: 'preact/compat' },
    ],
  },
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
