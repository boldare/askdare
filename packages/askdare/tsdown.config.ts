import { fileURLToPath } from 'node:url';
import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: { index: 'src/index.ts', next: 'src/next/index.ts' },
    format: 'esm',
    // Stable chunk names, so the API snapshot (scripts/api-snapshot.mjs) compares like with like.
    hash: false,
    platform: 'neutral',
    target: 'es2023',
    dts: true,
    // No source maps: they were half the package and would publish the widget's sources twice.
    sourcemap: false,
    clean: true,
  },
  {
    // @boldare/askdare/react (ADR-0011): client components for the user's own bundler.
    entry: { react: 'src/react/index.ts' },
    format: 'esm',
    hash: false,
    platform: 'browser',
    target: 'es2023',
    dts: { tsconfig: 'tsconfig.react.json' },
    tsconfig: 'tsconfig.react.json',
    sourcemap: false,
    // Next.js needs the directive at the top of the file that server components import.
    banner: { js: "'use client';" },
    // The skin imports the public entry, as an ejected copy does; inside the package that is here.
    alias: {
      '@boldare/askdare/react': fileURLToPath(new URL('./src/react/headless.ts', import.meta.url)),
    },
    // marked is bundled, so the XSS tests check exactly the version users run; react is the app's.
    deps: { neverBundle: [/^react($|\/)/], alwaysBundle: ['marked'] },
    // In a chunk of its own: marked has module-level state a bundler can't drop from react.js, and
    // a headless page that never renders Markdown shouldn't ship it (`sideEffects: false`).
    outputOptions: {
      advancedChunks: { groups: [{ name: 'react-marked', test: /node_modules[\\/]marked/ }] },
    },
  },
  {
    // The `askdare` binary; not part of the importable API, so no types.
    entry: { cli: 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    fixedExtension: false,
    target: 'node22',
    dts: false,
    sourcemap: false,
  },
]);
