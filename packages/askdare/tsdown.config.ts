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
