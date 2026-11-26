import { defineConfig } from 'vite';

// The admin console (ADR-0032, decision 7): a Preact app of its own, inlined into its own generated
// module by scripts/inline-assets.mjs and loaded only when `admin.console` is on.
export default defineConfig({
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  // The sources say `@jsxImportSource preact`; this makes sure the build agrees.
  resolve: {
    alias: [{ find: /^react\/jsx-(dev-)?runtime$/, replacement: 'preact/jsx-runtime' }],
  },
  build: {
    outDir: '.assets/admin',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    rolldownOptions: { output: { minify: true } },
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/admin-console/main.tsx',
      formats: ['es'],
      fileName: () => 'console.js',
      cssFileName: 'console',
    },
  },
});
