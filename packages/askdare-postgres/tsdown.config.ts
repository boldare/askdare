import { defineConfig } from 'tsdown';

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: 'esm',
    platform: 'node',
    fixedExtension: false,
    target: 'es2023',
    dts: true,
    sourcemap: false,
    clean: true,
  },
  {
    // The `askdare-postgres` binary; not part of the importable API, so no types.
    entry: { cli: 'src/cli.ts' },
    format: 'esm',
    platform: 'node',
    fixedExtension: false,
    target: 'node22',
    dts: false,
    sourcemap: false,
  },
]);
