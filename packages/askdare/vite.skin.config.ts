import { defineConfig } from 'vite';

// The default look as a stylesheet of its own, for a chat inside a page (ADR-0011): the skin
// without the iframe's document rules. Served by the route as assets/skin.<hash>.css.
export default defineConfig({
  build: {
    outDir: '.assets/skin',
    emptyOutDir: true,
    target: 'es2022',
    minify: true,
    sourcemap: false,
    cssCodeSplit: false,
    lib: {
      entry: 'src/widget-app/skin-css.ts',
      formats: ['es'],
      fileName: () => 'skin.js',
      cssFileName: 'skin',
    },
  },
});
