import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  fixedExtension: false,
  target: 'es2023',
  dts: true,
  sourcemap: false,
  clean: true,
});
