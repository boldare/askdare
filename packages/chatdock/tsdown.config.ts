import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { index: 'src/index.ts', next: 'src/next/index.ts' },
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  dts: true,
  sourcemap: true,
  clean: true,
});
