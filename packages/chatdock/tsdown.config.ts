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
    sourcemap: true,
    clean: true,
  },
  {
    // The `chatdock` binary; not part of the importable API, so no types.
    entry: { cli: 'src/cli/index.ts' },
    format: 'esm',
    platform: 'node',
    fixedExtension: false,
    target: 'node22',
    dts: false,
    sourcemap: false,
  },
]);
